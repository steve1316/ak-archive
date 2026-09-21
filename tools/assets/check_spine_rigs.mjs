#!/usr/bin/env node
/**
 * The corpus gate for the Spine runtime: parses every staged `.skel` and `.atlas` file with `src/spine/binary.ts` and `src/spine/atlas.ts`,
 * and checks what it read.
 *
 * A reader can decode one rig and still misread another, so this runs the whole staged tree. A `.skel` file fails when the reader throws,
 * when bytes are left over, when a timeline points at a bone, slot, constraint, skin, attachment or event that does not exist, or when a
 * region, mesh or linked mesh attachment's texture region is not in the atlas beside it. Key times must never go down, except in
 * attachment, color and deform timelines, where upstream rigs join up to 3 sorted runs of keys end to end (see `FORMAT-3.8.md`). A 4th run
 * still fails. An `.atlas` file fails when the reader throws, when a region's packed box (from its `x`/`y`/`width`/`height`, swapped when
 * `rotate` is 90 or 270) does not fit inside its page's real PNG size, or when a page's declared image size does not match the PNG - the
 * staged corpus never declares one, so that check is a backstop and the region box check is the one that runs on real data.
 *
 * Usage:
 *     node tools/assets/check_spine_rigs.mjs [--staging PATH]
 *
 * Scans every `.skel` and `.atlas` under `<staging>/assets/spine`. `--staging` defaults to `tools/assets/.staging`.
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
const USAGE = "Usage: node tools/assets/check_spine_rigs.mjs [--staging PATH] [--survey]  (scans <staging>/assets/spine)";

/** Attachment types whose vertices a deform timeline can offset. */
const DEFORMABLE_TYPES = new Set(["mesh", "linkedmesh", "boundingbox", "path", "clipping"]);

/** Attachment types that draw from an atlas region, keyed by their `path` (or their own name when `path` is null). */
const REGION_LIKE_TYPES = new Set(["region", "mesh", "linkedmesh"]);

/** The 8-byte signature every PNG file starts with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Every feature `src/spine/features.ts` can report, in the same order as its `Feature` union. A JS survey script cannot enumerate a TS
 * union type at runtime, so this list is kept in sync with it by hand. */
const ALL_FEATURES = [
	"region",
	"mesh",
	"weightedMesh",
	"linkedMesh",
	"clipping",
	"path",
	"point",
	"boundingBox",
	"ik",
	"transformConstraint",
	"pathConstraint",
	"deform",
	"drawOrder",
	"twoColor",
	"blendAdditive",
	"blendMultiply",
	"blendScreen",
	"transformModeNonNormal",
	"events"
];

/** Features every stage's runtime can already handle, even at stage 1: they draw nothing, so any stage's placeholder logic treats a rig
 * that uses only these (plus its stage's own set) as fully supported. */
const ALWAYS_SUPPORTED_FEATURES = ["events", "point", "boundingBox"];

/** Features each stage adds on top of the previous stage's set, per the plan in `2026-09-21-a6d-spine-runtime-design.md`. */
const STAGE_ADDS = {
	1: ["region", "transformModeNonNormal"],
	2: ["drawOrder", "twoColor", "blendAdditive", "blendMultiply", "blendScreen"],
	3: ["mesh", "weightedMesh", "linkedMesh", "deform"],
	4: ["clipping", "path", "ik", "transformConstraint", "pathConstraint"]
};

/** Every stage number the survey reports coverage for, in order. */
const STAGES = [1, 2, 3, 4];

/** Each stage's full feature set, cumulative from stage 1 through that stage, for the `--survey` coverage counts. */
const STAGE_FEATURE_SETS = new Map(
	STAGES.map((stage) => {
		const set = new Set(ALWAYS_SUPPORTED_FEATURES);
		for (let s = 1; s <= stage; s++) {
			for (const feature of STAGE_ADDS[s]) {
				set.add(feature);
			}
		}
		return [stage, set];
	})
);

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
 * List every file under a directory with the given extension, sorted so runs are comparable.
 *
 * @param {string} dir The directory to walk.
 * @param {string} extension The file extension to match, including the dot (e.g. `.skel`).
 * @returns {string[]} The file paths.
 */
function findFiles(dir, extension) {
	const found = [];
	const walk = (current) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.name.endsWith(extension)) {
				found.push(full);
			}
		}
	};
	walk(dir);
	return found.sort();
}

/**
 * Reads a PNG's pixel dimensions straight from its IHDR chunk, without decoding the image. The IHDR chunk always comes first, right after
 * the 8-byte PNG signature, with width and height as big-endian 4-byte ints at offsets 16 and 20.
 *
 * @param {Buffer} buffer The whole PNG file.
 * @returns {{ width: number, height: number }} The image's real pixel size.
 */
function readPngSize(buffer) {
	for (let i = 0; i < PNG_SIGNATURE.length; i++) {
		if (buffer[i] !== PNG_SIGNATURE[i]) {
			throw new Error("not a PNG file (bad signature)");
		}
	}
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Check every region, mesh and linked mesh attachment in a parsed skeleton against the atlas beside it.
 *
 * @param {object} data The parsed skeleton.
 * @param {Set<string>} regionNames Every region name the sibling atlas declares, across all its pages.
 * @returns {string[]} A message for each attachment whose texture region is not in the atlas.
 */
export function checkAttachmentRegions(data, regionNames) {
	const problems = [];
	for (const skin of data.skins) {
		for (const [slotIndex, attachments] of skin.attachments) {
			for (const [placeholder, attachment] of attachments) {
				if (!REGION_LIKE_TYPES.has(attachment.type)) {
					continue;
				}
				const regionName = attachment.path ?? attachment.name;
				if (!regionNames.has(regionName)) {
					problems.push(`skin "${skin.name}" slot ${slotIndex} attachment "${placeholder}" (${attachment.type}): region "${regionName}" not in atlas`);
				}
			}
		}
	}
	return problems;
}

/**
 * Check every region on one atlas page against its real PNG size: a region's packed box, taken from `x`/`y` and its `width`/`height`
 * (swapped when `rotate` is 90 or 270, since a rotated region occupies a box with its edges swapped on the page), must lie entirely
 * inside the PNG. This is the check that actually runs on the staged corpus, unlike a declared page size, which no staged atlas has.
 *
 * @param {object} page A parsed atlas page.
 * @param {{ width: number, height: number }} pngSize The page's real PNG pixel size, read from its IHDR chunk.
 * @returns {{ problems: string[], maxRight: number, maxBottom: number }} A message for each region whose box overflows the PNG, and the
 *   furthest right and bottom edge reached by any region on this page (0 when the page has no regions).
 */
export function checkRegionBounds(page, pngSize) {
	const problems = [];
	let maxRight = 0;
	let maxBottom = 0;
	for (const region of page.regions) {
		const swapped = region.rotate === 90 || region.rotate === 270;
		const boxWidth = swapped ? region.height : region.width;
		const boxHeight = swapped ? region.width : region.height;
		const right = region.x + boxWidth;
		const bottom = region.y + boxHeight;
		maxRight = Math.max(maxRight, right);
		maxBottom = Math.max(maxBottom, bottom);
		if (region.x < 0 || region.y < 0 || right > pngSize.width || bottom > pngSize.height) {
			problems.push(`region "${region.name}" box (x=${region.x}, y=${region.y}, w=${boxWidth}, h=${boxHeight}) overflows PNG ${pngSize.width}x${pngSize.height}`);
		}
	}
	return { problems, maxRight, maxBottom };
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
// Survey

/**
 * Split a staged skeleton path into the operator, form and kind it belongs to, per the published layout
 * `<spineDir>/<operatorId>/<formKey>/<kind>/<file>` that `spine_names.py` writes.
 *
 * @param {string} file The skeleton file's path.
 * @param {string} spineDir The `assets/spine` root the file was found under.
 * @returns {{ operatorId: string, formKey: string, kind: string } | null} The rig's identity, or null if the path is not 3 directories
 *   deep under `spineDir`.
 */
function parseRigPath(file, spineDir) {
	const parts = path.relative(spineDir, path.dirname(file)).split(path.sep);
	if (parts.length !== 3) {
		return null;
	}
	const [operatorId, formKey, kind] = parts;
	return { operatorId, formKey, kind };
}

/**
 * Checks whether every feature in a set is covered by a stage's cumulative feature set.
 *
 * @param {Set<string>} features The features a rig uses.
 * @param {number} stage The stage number to check against, 1 to 4.
 * @returns {boolean} True if the stage's runtime would draw the rig in full.
 */
function isFullySupported(features, stage) {
	const supported = STAGE_FEATURE_SETS.get(stage);
	for (const feature of features) {
		if (!supported.has(feature)) {
			return false;
		}
	}
	return true;
}

/**
 * Creates an empty survey accumulator for `--survey`.
 *
 * @returns {object} The accumulator: per-feature usage counts by kind, per-stage rig counts, a rig total, and each operator's base battle
 *   rig features, keyed by operator id.
 */
function createSurvey() {
	return {
		featureKindCounts: new Map(ALL_FEATURES.map((feature) => [feature, { battle: 0, back: 0, dorm: 0 }])),
		rigStageCounts: new Map(STAGES.map((stage) => [stage, 0])),
		rigsSurveyed: 0,
		operatorBaseBattleFeatures: new Map()
	};
}

/**
 * Folds one parsed rig into a survey accumulator: its feature usage by kind, its stage coverage, and, when it is an operator's base
 * battle rig, its feature set for the per-operator stage counts.
 *
 * @param {object} survey The accumulator from `createSurvey`.
 * @param {{ operatorId: string, formKey: string, kind: string }} rigPath The rig's identity.
 * @param {Set<string>} features The rig's features, from `featuresOf`.
 */
function recordRig(survey, rigPath, features) {
	survey.rigsSurveyed++;
	for (const feature of features) {
		survey.featureKindCounts.get(feature)[rigPath.kind]++;
	}
	for (const stage of STAGES) {
		if (isFullySupported(features, stage)) {
			survey.rigStageCounts.set(stage, survey.rigStageCounts.get(stage) + 1);
		}
	}
	if (rigPath.formKey === "base" && rigPath.kind === "battle") {
		survey.operatorBaseBattleFeatures.set(rigPath.operatorId, features);
	}
}

/**
 * Prints the `--survey` report: per-feature usage by kind, then how many operators (by base battle rig) and rigs each stage's planned
 * feature set would fully support.
 *
 * @param {object} survey The filled accumulator from `createSurvey`.
 */
function printSurvey(survey) {
	console.log("");
	console.log("Feature survey (rigs using each feature, by kind):");
	for (const feature of ALL_FEATURES) {
		const counts = survey.featureKindCounts.get(feature);
		const total = counts.battle + counts.back + counts.dorm;
		console.log(`  ${feature}: ${total} (battle ${counts.battle}, back ${counts.back}, dorm ${counts.dorm})`);
	}

	const operatorFeatures = [...survey.operatorBaseBattleFeatures.values()];
	console.log("");
	console.log(`Stage coverage (${survey.rigsSurveyed} rigs surveyed, ${operatorFeatures.length} operators with a base battle rig):`);
	for (const stage of STAGES) {
		const operatorCount = operatorFeatures.filter((features) => isFullySupported(features, stage)).length;
		console.log(`  Stage ${stage}: ${operatorCount}/${operatorFeatures.length} operators, ${survey.rigStageCounts.get(stage)}/${survey.rigsSurveyed} rigs`);
	}
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Main

/**
 * Read a file path's key for pairing a skeleton with the atlas beside it: the full path with its extension dropped, since both share a
 * directory and a base name in the staged corpus.
 *
 * @param {string} file The file path.
 * @returns {string} The path without its extension.
 */
function pairingKey(file) {
	return file.slice(0, -path.extname(file).length);
}

/**
 * Parse and check every staged rig and atlas, print each failure and a summary, and exit 1 if anything failed.
 */
async function main() {
	const spineDir = path.join(parseStaging(process.argv.slice(2)), "assets", "spine");
	const skelFiles = fs.existsSync(spineDir) ? findFiles(spineDir, ".skel") : [];
	const atlasFiles = fs.existsSync(spineDir) ? findFiles(spineDir, ".atlas") : [];
	if (skelFiles.length === 0 && atlasFiles.length === 0) {
		console.error(`No .skel or .atlas files under ${spineDir}`);
		process.exit(1);
	}
	const survey = process.argv.includes("--survey") ? createSurvey() : null;

	const server = await createServer({ root: REPO_ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
	let failed = 0;
	let repeatingKeys = 0;
	let repeatingFiles = 0;
	let atlasFailed = 0;
	let pagesChecked = 0;
	let pagesWithDeclaredSize = 0;
	let maxFillFraction = 0;
	const typeCounts = {};
	const atlasByKey = new Map();
	try {
		const { readSkeleton } = await server.ssrLoadModule("/src/spine/binary.ts");
		const { readAtlas } = await server.ssrLoadModule("/src/spine/atlas.ts");
		const featuresOf = survey ? (await server.ssrLoadModule("/src/spine/features.ts")).featuresOf : null;

		for (const file of atlasFiles) {
			const shown = file.startsWith(REPO_ROOT + path.sep) ? path.relative(REPO_ROOT, file) : file;
			const dir = path.dirname(file);
			let atlas;
			try {
				atlas = readAtlas(fs.readFileSync(file, "utf-8"));
			} catch (error) {
				atlasFailed++;
				console.log(`${shown} @${error.line ?? "?"}: ${error.message}`);
				continue;
			}
			atlasByKey.set(pairingKey(file), atlas);

			let pageProblem = false;
			for (const page of atlas.pages) {
				pagesChecked++;
				const pngPath = path.join(dir, page.name);
				let size;
				try {
					size = readPngSize(fs.readFileSync(pngPath));
				} catch (error) {
					pageProblem = true;
					console.log(`${shown} @-: page "${page.name}": ${error.message}`);
					continue;
				}
				// A page size is only checked against its PNG when the atlas actually declared one: the staged corpus never does, so
				// this branch is a backstop that stays unexercised here (see FORMAT-3.8.md). The region bounds check below is the one
				// that actually runs on real data.
				if (page.width > 0 && page.height > 0) {
					pagesWithDeclaredSize++;
					if (page.width !== size.width || page.height !== size.height) {
						pageProblem = true;
						console.log(`${shown} @-: page "${page.name}" declares ${page.width}x${page.height}, PNG is ${size.width}x${size.height}`);
					}
				}

				const bounds = checkRegionBounds(page, size);
				if (bounds.problems.length > 0) {
					pageProblem = true;
					for (const problem of bounds.problems) {
						console.log(`${shown} @-: page "${page.name}" ${problem}`);
					}
				}
				if (page.regions.length > 0) {
					maxFillFraction = Math.max(maxFillFraction, bounds.maxRight / size.width, bounds.maxBottom / size.height);
				}
			}
			if (pageProblem) {
				atlasFailed++;
			}
		}

		for (const file of skelFiles) {
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
			if (survey) {
				const rigPath = parseRigPath(file, spineDir);
				if (rigPath) {
					recordRig(survey, rigPath, featuresOf(data));
				}
			}
			const atlas = atlasByKey.get(pairingKey(file));
			if (atlas) {
				const regionNames = new Set();
				for (const page of atlas.pages) {
					for (const region of page.regions) {
						regionNames.add(region.name);
					}
				}
				result.problems.push(...checkAttachmentRegions(data, regionNames));
			} else {
				result.problems.push(`no atlas beside this skeleton (expected ${path.basename(pairingKey(file))}.atlas)`);
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
	console.log(`${skelFiles.length} skeletons parsed, ${failed} failed`);
	console.log(`${atlasFiles.length} atlases parsed, ${pagesChecked} pages (${pagesWithDeclaredSize} with a declared size), ${atlasFailed} atlas(es) failed`);
	console.log(`Largest packed extent across the corpus: ${(maxFillFraction * 100).toFixed(2)}% of a page's real PNG size`);
	if (survey) {
		printSurvey(survey);
	}
	process.exit(failed > 0 || atlasFailed > 0 ? 1 : 0);
}

// Run only when called as a script, so a scratch check can import `checkSkeleton` without parsing the corpus.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
