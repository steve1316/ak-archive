#!/usr/bin/env node
/**
 * The corpus gate for the Spine runtime: parses every staged `.skel` file with `src/spine/binary.ts` and checks what it read.
 *
 * A reader can decode one rig and still misread another, so this runs the whole staged tree. A file fails when the reader throws, when
 * bytes are left over, or when a timeline points at a bone, slot, constraint, skin, attachment or event that does not exist. Key times
 * must never go down, except in attachment, color and deform timelines, where upstream rigs join up to 3 sorted runs of keys end to end
 * (see `FORMAT-3.8.md`). A 4th run still fails.
 *
 * Usage:
 *     node tools/assets/check_spine_rigs.mjs [--staging PATH]
 *
 * Scans every `.skel` under `<staging>/assets/spine`. `--staging` defaults to `tools/assets/.staging`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOLS_DIR, "..", "..");
const DEFAULT_STAGING = path.join(TOOLS_DIR, ".staging");

/** Timeline types whose key times may go back down, because upstream rigs repeat keys in them. Every other type must be non-decreasing. */
const REPEATING_KEY_TYPES = new Set(["attachment", "color", "deform"]);

/** Most sorted runs of key times a `REPEATING_KEY_TYPES` timeline may have. The staged corpus never has more than 3. */
const MAX_KEY_RUNS = 3;

/** Printed when the command line is wrong. */
const USAGE = "Usage: node tools/assets/check_spine_rigs.mjs [--staging PATH]  (scans <staging>/assets/spine)";

/** Attachment types whose vertices a deform timeline can offset. */
const DEFORMABLE_TYPES = new Set(["mesh", "linkedmesh", "boundingbox", "path", "clipping"]);

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Read the staging directory from the command line.
 *
 * @param {string[]} args The arguments after the script name.
 * @returns {string} The staging root, absolute. The staged rigs sit under its `assets/spine`, where `stage_spine.py` writes them.
 */
function parseStaging(args) {
	const index = args.indexOf("--staging");
	if (index === -1) {
		return DEFAULT_STAGING;
	}
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		console.error(USAGE);
		process.exit(1);
	}
	return path.resolve(value);
}

/**
 * List every `.skel` file under a directory, sorted so runs are comparable.
 *
 * @param {string} dir The directory to walk.
 * @returns {string[]} The file paths.
 */
function findSkels(dir) {
	const found = [];
	const walk = (current) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.name.endsWith(".skel")) {
				found.push(full);
			}
		}
	};
	walk(dir);
	return found.sort();
}

/**
 * Count how many floats a deform keyframe may offset for an attachment: 2 per vertex, or 2 per bone influence when weighted.
 *
 * @param {object} attachment A mesh-shaped attachment, with any linked mesh already resolved to its parent.
 * @returns {number} The number of deformable floats.
 */
function deformLength(attachment) {
	const vertices = attachment.vertices;
	return vertices.weighted ? (vertices.values.length / 3) * 2 : vertices.values.length;
}

/**
 * Find the attachment a deform timeline targets, following a linked mesh to its parent mesh.
 *
 * @param {object} data The parsed skeleton.
 * @param {number} skinIndex Index of the skin holding the attachment.
 * @param {number} slotIndex Index of the slot holding the attachment.
 * @param {string} name The attachment's name within the skin.
 * @returns {object | string} The attachment that owns the vertices, or a message saying why it could not be found.
 */
function resolveDeformTarget(data, skinIndex, slotIndex, name) {
	const skin = data.skins[skinIndex];
	if (!skin) {
		return `skin ${skinIndex} out of range (${data.skins.length})`;
	}
	const attachment = skin.attachments.get(slotIndex)?.get(name);
	if (!attachment) {
		return `attachment "${name}" not in skin "${skin.name}" slot ${slotIndex}`;
	}
	if (!DEFORMABLE_TYPES.has(attachment.type)) {
		return `attachment "${name}" is a ${attachment.type}, which cannot deform`;
	}
	if (attachment.type !== "linkedmesh") {
		return attachment;
	}
	const parentSkin = attachment.parentSkin === null ? data.skins[0] : data.skins.find((s) => s.name === attachment.parentSkin);
	const parent = parentSkin?.attachments.get(slotIndex)?.get(attachment.parentName);
	return parent ?? `linked mesh "${name}" parent "${attachment.parentName}" not found`;
}

/**
 * Check that a draw order keyframe moves each slot at most once, in ascending slot order, to a free position in range.
 *
 * @param {object[]} changes The keyframe's slot moves.
 * @param {number} slotCount How many slots the skeleton has.
 * @returns {string | null} A message describing the first problem, or null when the keyframe is valid.
 */
function checkDrawOrder(changes, slotCount) {
	const taken = new Set();
	let previous = -1;
	for (const { slotIndex, offset } of changes) {
		if (slotIndex <= previous) {
			return `slot ${slotIndex} after slot ${previous}`;
		}
		previous = slotIndex;
		const target = slotIndex + offset;
		if (target >= slotCount) {
			return `slot ${slotIndex} moves to ${target}, past ${slotCount} slots`;
		}
		if (taken.has(target)) {
			return `two slots move to position ${target}`;
		}
		taken.add(target);
	}
	return null;
}

/**
 * Check one timeline's references against the skeleton it came from.
 *
 * @param {object} data The parsed skeleton.
 * @param {object} timeline The timeline to check.
 * @param {Map<number, Set<string>>} slotAttachments Every attachment name each slot has, across all skins.
 * @returns {string[]} A message for each problem found.
 */
function checkReferences(data, timeline, slotAttachments) {
	const problems = [];
	const inRange = (label, index, count) => {
		if (!(index >= 0 && index < count)) {
			problems.push(`${label} ${index} out of range (${count})`);
		}
	};
	switch (timeline.type) {
		case "attachment":
			inRange("slot", timeline.slotIndex, data.slots.length);
			for (const name of timeline.names) {
				if (name !== null && !slotAttachments.get(timeline.slotIndex)?.has(name)) {
					problems.push(`attachment "${name}" not in any skin for slot ${timeline.slotIndex}`);
				}
			}
			break;
		case "color":
		case "twoColor":
			inRange("slot", timeline.slotIndex, data.slots.length);
			break;
		case "rotate":
		case "translate":
		case "scale":
		case "shear":
			inRange("bone", timeline.boneIndex, data.bones.length);
			break;
		case "ik":
			inRange("IK constraint", timeline.constraintIndex, data.ik.length);
			for (const bend of timeline.bendDirections) {
				if (bend !== 1 && bend !== -1) {
					problems.push(`bend direction ${bend}`);
				}
			}
			break;
		case "transform":
			inRange("transform constraint", timeline.constraintIndex, data.transform.length);
			break;
		case "pathPosition":
		case "pathSpacing":
		case "pathMix":
			inRange("path constraint", timeline.constraintIndex, data.path.length);
			break;
		case "deform": {
			inRange("slot", timeline.slotIndex, data.slots.length);
			const target = resolveDeformTarget(data, timeline.skinIndex, timeline.slotIndex, timeline.attachmentName);
			if (typeof target === "string") {
				problems.push(target);
				break;
			}
			const length = deformLength(target);
			timeline.values.forEach((values, i) => {
				if (timeline.starts[i] + values.length > length) {
					problems.push(`deform key ${i} covers ${timeline.starts[i]}+${values.length} of ${length} floats`);
				}
			});
			break;
		}
		case "drawOrder":
			for (const changes of timeline.changes) {
				const problem = checkDrawOrder(changes, data.slots.length);
				if (problem) {
					problems.push(`draw order: ${problem}`);
				}
			}
			break;
		case "event":
			for (const key of timeline.events) {
				inRange("event", key.eventIndex, data.events.length);
			}
			break;
		default:
			problems.push(`unknown timeline type ${timeline.type}`);
	}
	return problems;
}

/**
 * Count the non-decreasing runs in a list of key times. A sorted list is 1 run, and each drop starts another.
 *
 * @param {number[]} times The key times, in file order.
 * @returns {number} How many runs the times split into.
 */
function countKeyRuns(times) {
	let runs = times.length > 0 ? 1 : 0;
	for (let i = 1; i < times.length; i++) {
		if (times[i] < times[i - 1]) {
			runs++;
		}
	}
	return runs;
}

/**
 * Check every animation in a parsed skeleton: names, key times and references.
 *
 * @param {object} data The parsed skeleton.
 * @param {Record<string, number>} typeCounts Timeline counts by type, added to in place.
 * @returns {{ problems: string[], repeatingKeys: number }} Every problem found, and how many timelines had key times that went down.
 */
export function checkSkeleton(data, typeCounts) {
	const problems = [];
	let repeatingKeys = 0;
	const slotAttachments = new Map();
	for (const skin of data.skins) {
		for (const [slotIndex, attachments] of skin.attachments) {
			const names = slotAttachments.get(slotIndex) ?? new Set();
			for (const name of attachments.keys()) {
				names.add(name);
			}
			slotAttachments.set(slotIndex, names);
		}
	}
	const animationNames = new Set();
	for (const animation of data.animations) {
		if (!animation.name || animationNames.has(animation.name)) {
			problems.push(`animation name "${animation.name}" is empty or repeated`);
		}
		animationNames.add(animation.name);
		animation.timelines.forEach((timeline, index) => {
			typeCounts[timeline.type] = (typeCounts[timeline.type] ?? 0) + 1;
			const where = `animation "${animation.name}" timeline ${index} (${timeline.type})`;
			const times = timeline.times;
			if (times.length === 0 || times.some((time) => !Number.isFinite(time) || time < 0)) {
				problems.push(`${where}: missing or bad key time`);
			}
			const runs = countKeyRuns(times);
			if (runs > 1) {
				if (!REPEATING_KEY_TYPES.has(timeline.type)) {
					problems.push(`${where}: key times go down`);
				} else if (runs > MAX_KEY_RUNS) {
					problems.push(`${where}: key times split into ${runs} sorted runs, more than ${MAX_KEY_RUNS}`);
				} else {
					repeatingKeys++;
				}
			}
			for (const problem of checkReferences(data, timeline, slotAttachments)) {
				problems.push(`${where}: ${problem}`);
			}
		});
	}
	return { problems, repeatingKeys };
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Main

/**
 * Parse and check every staged rig, print each failure and a summary, and exit 1 if anything failed.
 */
async function main() {
	const spineDir = path.join(parseStaging(process.argv.slice(2)), "assets", "spine");
	const files = fs.existsSync(spineDir) ? findSkels(spineDir) : [];
	if (files.length === 0) {
		console.error(`No .skel files under ${spineDir}`);
		process.exit(1);
	}

	const server = await createServer({ root: REPO_ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
	let failed = 0;
	let repeatingKeys = 0;
	let repeatingFiles = 0;
	const typeCounts = {};
	try {
		const { readSkeleton } = await server.ssrLoadModule("/src/spine/binary.ts");
		for (const file of files) {
			const shown = file.startsWith(REPO_ROOT + path.sep) ? path.relative(REPO_ROOT, file) : file;
			let data;
			try {
				data = readSkeleton(new Uint8Array(fs.readFileSync(file)));
			} catch (error) {
				failed++;
				console.log(`${shown} @${error.offset ?? "?"}: ${error.message}`);
				continue;
			}
			const result = checkSkeleton(data, typeCounts);
			if (result.repeatingKeys > 0) {
				repeatingKeys += result.repeatingKeys;
				repeatingFiles++;
			}
			if (result.problems.length > 0) {
				failed++;
				for (const problem of result.problems) {
					console.log(`${shown} @-: ${problem}`);
				}
			}
		}
	} finally {
		await server.close();
	}

	const counts = Object.entries(typeCounts)
		.map(([type, count]) => `${type} ${count}`)
		.join(", ");
	console.log(`Timelines: ${counts}`);
	console.log(`Upstream repeated keys (allowed): ${repeatingKeys} slot or deform timelines in ${repeatingFiles} files`);
	console.log(`${files.length} parsed, ${failed} failed`);
	process.exit(failed > 0 ? 1 : 0);
}

// Run only when called as a script, so a scratch check can import `checkSkeleton` without parsing the corpus.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
