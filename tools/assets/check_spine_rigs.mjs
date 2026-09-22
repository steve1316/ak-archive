#!/usr/bin/env node
/**
 * The corpus gate for the Spine runtime: parses every staged `.skel` and `.atlas` file with `src/spine/binary.ts` and `src/spine/atlas.ts`,
 * and checks what it read.
 *
 * A reader can decode one rig and still misread another, so this runs the whole staged tree. A `.skel` file fails when the reader throws,
 * when bytes are left over, when a timeline points at a bone, slot, constraint, skin, attachment or event that does not exist, when a
 * linked mesh's parent is not a mesh, or when a region, mesh or linked mesh attachment's texture region is not in the atlas beside it. Key
 * times must never go down, except in attachment, color and deform timelines, where upstream rigs join up to 3 sorted runs of keys end to
 * end (see `FORMAT-3.8.md`). A 4th run still fails. An `.atlas` file fails when the reader throws, when a region's packed box (from its
 * `x`/`y`/`width`/`height`, swapped when `rotate` is 90 or 270) does not fit inside its page's real PNG size, or when a page's declared
 * image size does not match the PNG. The staged corpus never declares one, so that check is a backstop and the region box check is the
 * one that runs on real data.
 *
 * Usage:
 *     node tools/assets/check_spine_rigs.mjs [--staging PATH] [--survey] [--geometry] [--animation]
 *
 * Scans every `.skel` and `.atlas` under `<staging>/assets/spine`. `--staging` defaults to `tools/assets/.staging`. `--survey` also prints
 * how many rigs use each feature and how many each planned stage would draw in full. `--geometry` also turns every rig's setup pose into
 * triangles with `src/spine/geometry.ts`: every drawing attachment must give a list with finite positions and indices in range. A UV
 * outside [0, 1] is a warning, since a few meshes reach past their stripped image. The drawn bounds are compared with the skeleton's
 * declared bounds by intersection-over-union. A rig with a transform or path constraint is only reported, since those are not applied yet.
 * An IK-only or unconstrained rig is judged. Below 0.5 it
 * fails unless the drawn box sits inside the declared one, which hidden or other-skin attachments can widen. A rig that declares no bounds,
 * or draws nothing in its setup pose, is counted as unscored. It also checks UV orientation: the packer strips whitespace down to a mesh's
 * hull, so a stripped mesh's hull, mapped to page pixels, should meet every edge of its packed box.
 *
 * `--animation` plays every animation of every rig with `src/spine/animation.ts`. Each is sampled at `ANIMATION_SAMPLES` evenly spaced
 * times from 0 to its duration: reset to the setup pose, apply, update and build triangles. Every position, UV and color must be finite,
 * every color channel must be in [0, 1], and the draw order must be a permutation of the slots. Every color and two-color key must also
 * show its own color at its time, and every linear color segment a straight blend a quarter of the way along. It prints the frame time
 * (median and p99 for apply, update and triangles) and how many two-color timelines drive a slot with no dark color.
 *
 * `--ik` checks every rig with an IK constraint. In the setup pose, with setup mix 1: a one-bone chain whose target is within
 * `IK_SETUP_GAP` of its line must solve back to its setup rotation, and a two-bone chain within `IK_LOOSE_GAP` must sit nearer the solution
 * its bend direction picks than the mirror one. The brief gap-0.5 angle rates are printed too, for information. Then it plays every
 * animation at `ANIMATION_SAMPLES` times: solved rotations and scales must be finite, and a chain at mix 1 without stretch must point at
 * its target (one bone), or end on it or on the line to it (two bones). It prints the run time.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStaging, shownPath, startVite } from "./spine_tools.mjs";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Timeline types whose key times may go back down, because upstream rigs repeat keys in them. Every other type must be non-decreasing. */
const REPEATING_KEY_TYPES = new Set(["attachment", "color", "deform"]);

/** Most sorted runs of key times a `REPEATING_KEY_TYPES` timeline may have. The staged corpus never has more than 3. */
const MAX_KEY_RUNS = 3;

/** Printed when the command line is wrong. */
const USAGE = "Usage: node tools/assets/check_spine_rigs.mjs [--staging PATH] [--survey] [--geometry] [--animation] [--ik]  (scans <staging>/assets/spine)";

/** Lowest intersection-over-union between a rig's drawn and declared setup bounds before `--geometry` fails it. */
const MIN_IOU = 0.5;

/**
 * Rigs whose declared bounds do not fit their own setup pose, so a low IoU is reported, not failed. Each is listed with its evidence.
 * `char_4036_forcer_epoque_20` back declares a box 166 x 150 at y 68 to 218, while its setup pose draws 404 x 509 from y -72 to 437. The
 * IoU is 0.121 with or without IK applied, and its battle twin, which shares the art, scores the same.
 */
const STALE_DECLARED_BOUNDS = new Set(["char_4036_forcer/epoque_20/back/char_4036_forcer_epoque_20.skel"]);

/** How far, in world units, a drawn box may poke past the declared box and still count as inside it. */
const CONTAINED_SLACK = 1;

/** Intersection-over-union at or above which `--geometry` counts a rig's bounds as a close match. */
const GOOD_IOU = 0.8;

/** How many of the lowest-IoU rigs `--geometry` prints. */
const WORST_SHOWN = 10;

/** How far, in page pixels, a mesh hull's bounding box may sit from an edge of its packed box and still meet it. */
const HULL_EDGE_SLACK = 3;

/** Lowest share of stripped meshes whose hull meets the packed box. A few meshes reach past their box (about 1% of them) in the corpus. */
const MIN_HULL_FIT = 0.95;

/** Lowest hull fit share within one `rotate` group. It is looser than `MIN_HULL_FIT` because a group is smaller and noisier. */
const MIN_HULL_FIT_GROUP = 0.9;

/** Fewest meshes a `rotate` group needs before `MIN_HULL_FIT_GROUP` judges it. */
const MIN_HULL_GROUP_SIZE = 20;

/** Attachment types whose vertices a deform timeline can offset. */
const DEFORMABLE_TYPES = new Set(["mesh", "linkedmesh", "boundingbox", "path", "clipping"]);

/** Attachment types that draw from an atlas region, keyed by their `path` (or their own name when `path` is null). */
const REGION_LIKE_TYPES = new Set(["region", "mesh", "linkedmesh"]);

/** How many evenly spaced times `--animation` samples in each animation, the first at 0 and the last at its duration. */
const ANIMATION_SAMPLES = 8;

/** Largest difference `--animation` allows between a sampled color channel and the key or blend it should equal. */
const COLOR_TOLERANCE = 1e-5;

/** How many failures `--animation` prints per rig before it only counts them. */
const ANIMATION_PROBLEMS_SHOWN = 3;

/** Setup tip-to-target gap, in world units, under which `--ik` expects a one-bone chain to solve back to its own setup rotation. */
const IK_SETUP_GAP = 0.01;

/** Setup gap under which `--ik` counts a chain as already reaching its target, the looser bound the two-bone bend test uses. */
const IK_LOOSE_GAP = 0.5;

/** Largest difference, in degrees, between a solved rotation and the setup rotation that still counts as reproducing it. */
const IK_ANGLE_TOLERANCE = 0.5;

/** Lowest share of near one-bone chains that must reproduce their setup rotation. */
const IK_MIN_ONE_BONE = 0.99;

/** Lowest share of two-bone chains whose setup pose must sit nearer the solution their bend direction picks than the mirror one. */
const IK_MIN_TWO_BONE = 0.95;

/** Fewest degrees the two mirror solutions' child rotations must differ by. A nearly straight chain has two mirrors too close to tell. */
const IK_MIRROR_SEPARATION = 4;

/** How far, in world units, a solved chain's tip may sit off its target, or off the line to it, and still count as reaching. */
const IK_REACH_TOLERANCE = 0.01;

/** Two local scales whose sizes differ by more than this make a nonuniform parent, where the two-bone solve is not exact. */
const IK_UNIFORM_TOLERANCE = 1e-4;

/** The 8-byte signature every PNG file starts with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

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
 * Check that every linked mesh's parent resolves to a mesh attachment in the same slot. The parent is looked up in the skin the linked mesh
 * names, or in the default skin when it names none.
 *
 * @param {object} data The parsed skeleton.
 * @returns {string[]} A message for each linked mesh whose parent is missing or is not a mesh.
 */
export function checkLinkedMeshes(data) {
	const problems = [];
	for (const skin of data.skins) {
		for (const [slotIndex, attachments] of skin.attachments) {
			for (const [placeholder, attachment] of attachments) {
				if (attachment.type !== "linkedmesh") {
					continue;
				}
				const parentSkinName = attachment.parentSkin ?? "default";
				const parentSkin = attachment.parentSkin === null ? data.skins[0] : data.skins.find((s) => s.name === attachment.parentSkin);
				const parent = parentSkin?.attachments.get(slotIndex)?.get(attachment.parentName);
				if (parent?.type !== "mesh") {
					const found = parent ? `a ${parent.type}` : "not found";
					problems.push(`skin "${skin.name}" slot ${slotIndex} linked mesh "${placeholder}": parent "${attachment.parentName}" in skin "${parentSkinName}" is ${found}`);
				}
			}
		}
	}
	return problems;
}

/**
 * Check a parsed skeleton: its bone parents, its linked mesh parents, and every animation's names, key times and references.
 *
 * @param {object} data The parsed skeleton.
 * @param {Record<string, number>} typeCounts Timeline counts by type, added to in place.
 * @returns {{ problems: string[], repeatingKeys: number }} Every problem found, and how many timelines had key times that went down.
 */
export function checkSkeleton(data, typeCounts) {
	const problems = checkLinkedMeshes(data);
	// Only the root has no parent, and every other bone's parent comes before it.
	data.bones.forEach((bone, index) => {
		const parent = bone.parentIndex;
		if (index === 0 ? parent !== null : parent === null || parent < 0 || parent >= index) {
			problems.push(`bone ${index} "${bone.name}" has parent ${parent}`);
		}
	});
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
// Geometry

/**
 * Computes the intersection-over-union of two axis-aligned boxes.
 *
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} first The first box.
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} second The second box.
 * @returns {number} The overlap area over the union area, 0 when the union is empty.
 */
function intersectionOverUnion(first, second) {
	const area = (box) => Math.max(0, box.maxX - box.minX) * Math.max(0, box.maxY - box.minY);
	const overlap = area({
		minX: Math.max(first.minX, second.minX),
		minY: Math.max(first.minY, second.minY),
		maxX: Math.min(first.maxX, second.maxX),
		maxY: Math.min(first.maxY, second.maxY)
	});
	const union = area(first) + area(second) - overlap;
	return union > 0 ? overlap / union : 0;
}

/**
 * Checks whether one box lies inside another, allowing `CONTAINED_SLACK` on every side.
 *
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} inner The box that should be inside.
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} outer The box that should hold it.
 * @returns {boolean} True when `inner` fits inside `outer`.
 */
function isInside(inner, outer) {
	return inner.minX >= outer.minX - CONTAINED_SLACK && inner.minY >= outer.minY - CONTAINED_SLACK && inner.maxX <= outer.maxX + CONTAINED_SLACK && inner.maxY <= outer.maxY + CONTAINED_SLACK;
}

/**
 * Checks one triangle list's numbers: finite positions and UVs, and every index below the vertex count. UV range is checked separately.
 *
 * @param {object} list A `TriangleList` from `geometry.ts`.
 * @returns {string | null} A message for the first problem, or null when the list is sound.
 */
function checkTriangleList(list) {
	const vertexCount = list.positions.length / 2;
	if (list.uvs.length !== list.positions.length) {
		return `${list.uvs.length / 2} UVs for ${vertexCount} vertices`;
	}
	if (!list.positions.every(Number.isFinite) || !list.uvs.every(Number.isFinite)) {
		return "a position or UV is not finite";
	}
	if (list.indices.length % 3 !== 0 || list.indices.some((index) => index >= vertexCount)) {
		return `an index is out of range (${vertexCount} vertices, ${list.indices.length} indices)`;
	}
	return null;
}

/**
 * Poses one rig in its setup pose and checks the triangles `geometry.ts` builds for it. The rig shows the skin `defaultSkinName` picks, its
 * first named skin when it has more than one, since some rigs keep setup attachments only there.
 *
 * @param {object} data The parsed skeleton.
 * @param {object} atlas The parsed atlas beside it.
 * @param {{ width: number, height: number }[]} pageSizes Each atlas page's real PNG size.
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} geometryModule The loaded `geometry.ts` module.
 * @param {string} rigPath The rig's path under the staged spine directory, for `STALE_DECLARED_BOUNDS`.
 * @returns {object} `problems`, every failure found. `uvWarnings`, the slots with a UV outside [0, 1]. `iou`, the bounds IoU, or null when
 *   either box is empty. `verdict` for a low IoU: `"failed"`, `"declaredLarger"`, `"staleBounds"` or `"constrained"`, or null when the IoU is fine or unscored.
 *   `lists` and `triangles`, how much was built. `namedSkin`, whether a named skin was set. `constrained`, whether the rig has a transform
 *   or path constraint, which the setup pose here does not apply. `ik`, whether it has an IK constraint, which it does apply.
 */
function checkRigGeometry(data, atlas, pageSizes, skeletonModule, geometryModule, rigPath) {
	const skeleton = new skeletonModule.Skeleton(data);
	const skinName = skeletonModule.defaultSkinName(data);
	const namedSkin = skinName !== null && skinName !== skeletonModule.DEFAULT_SKIN_NAME;
	skeleton.setSkin(skinName);
	skeleton.setToSetupPose();
	skeleton.updateWorldTransform();

	const problems = [];
	const uvWarnings = [];
	for (const slot of skeleton.slots) {
		if (slot.attachment && REGION_LIKE_TYPES.has(slot.attachment.type) && !geometryModule.slotTriangles(skeleton, slot, atlas, pageSizes)) {
			problems.push(`slot "${slot.data.name}" ${slot.attachment.type} "${slot.attachment.name}" draws nothing (region or linked parent missing)`);
		}
	}
	const lists = geometryModule.skeletonTriangles(skeleton, atlas, pageSizes);
	let triangles = 0;
	for (const list of lists) {
		triangles += list.indices.length / 3;
		const slotName = skeleton.slots[list.slotIndex].data.name;
		const problem = checkTriangleList(list);
		if (problem) {
			problems.push(`slot "${slotName}": ${problem}`);
		}
		if (list.uvs.some((value) => value < 0 || value > 1)) {
			uvWarnings.push(slotName);
		}
	}

	const drawn = geometryModule.bounds(lists);
	const declared = { minX: data.x, minY: data.y, maxX: data.x + data.width, maxY: data.y + data.height };
	const iou = drawn && data.width > 0 && data.height > 0 ? intersectionOverUnion(drawn, declared) : null;
	const constrained = data.transform.length + data.path.length > 0;
	let verdict = null;
	if (iou !== null && iou < MIN_IOU) {
		if (constrained) {
			verdict = "constrained";
		} else if (isInside(drawn, declared)) {
			verdict = "declaredLarger";
		} else if (STALE_DECLARED_BOUNDS.has(rigPath)) {
			verdict = "staleBounds";
		} else {
			verdict = "failed";
			problems.push(`bounds IoU ${iou.toFixed(3)} is below ${MIN_IOU}`);
		}
	}
	const hullFits = checkHullFits(data, skeleton, atlas, pageSizes, geometryModule);
	return {
		problems,
		uvWarnings,
		iou,
		verdict,
		hullFits,
		lists: lists.length,
		triangles,
		namedSkin,
		constrained,
		ik: data.ik.length > 0
	};
}

/**
 * Checks, for every mesh in every skin on a whitespace-stripped region, whether its hull meets the packed box's edges on the page. The UVs
 * come from `slotTriangles` itself, so the check sees the runtime's own mapping. A linked mesh uses its parent's hull.
 *
 * @param {object} data The parsed skeleton.
 * @param {object} skeleton The posed skeleton built from `data`.
 * @param {object} atlas The parsed atlas.
 * @param {{ width: number, height: number }[]} pageSizes Each atlas page's real PNG size.
 * @param {object} geometryModule The loaded `geometry.ts` module.
 * @returns {{ rotate: number, fits: boolean }[]} One entry per stripped mesh: its region's `rotate` and whether its hull meets the box.
 */
function checkHullFits(data, skeleton, atlas, pageSizes, geometryModule) {
	const results = [];
	for (const skin of data.skins) {
		for (const [slotIndex, attachments] of skin.attachments) {
			const slot = skeleton.slots[slotIndex];
			for (const attachment of attachments.values()) {
				if (attachment.type !== "mesh" && attachment.type !== "linkedmesh") {
					continue;
				}
				const found = geometryModule.findRegion(atlas, attachment.path ?? attachment.name);
				const mesh = geometryModule.resolveMesh(skeleton, slotIndex, attachment);
				const region = found?.region;
				if (!region || !mesh || (region.width >= region.originalWidth && region.height >= region.originalHeight)) {
					continue;
				}
				const shownAttachment = slot.attachment;
				slot.attachment = attachment;
				const list = geometryModule.slotTriangles(skeleton, slot, atlas, pageSizes);
				slot.attachment = shownAttachment;
				if (!list) {
					continue;
				}
				const page = pageSizes[found.page];
				let minX = Infinity;
				let minY = Infinity;
				let maxX = -Infinity;
				let maxY = -Infinity;
				for (let i = 0; i < mesh.hullCount * 2; i += 2) {
					minX = Math.min(minX, list.uvs[i] * page.width);
					maxX = Math.max(maxX, list.uvs[i] * page.width);
					minY = Math.min(minY, list.uvs[i + 1] * page.height);
					maxY = Math.max(maxY, list.uvs[i + 1] * page.height);
				}
				const swapped = region.rotate === 90 || region.rotate === 270;
				const boxRight = region.x + (swapped ? region.height : region.width);
				const boxBottom = region.y + (swapped ? region.width : region.height);
				const edges = [minX - region.x, boxRight - maxX, minY - region.y, boxBottom - maxY];
				results.push({ rotate: region.rotate, fits: edges.every((gap) => Math.abs(gap) <= HULL_EDGE_SLACK) });
			}
		}
	}
	return results;
}

/**
 * Checks one color is finite with every channel in [0, 1].
 *
 * @param {{ r: number, g: number, b: number, a: number }} color The color.
 * @returns {boolean} True when the color is sound.
 */
function isUnitColor(color) {
	return [color.r, color.g, color.b, color.a].every((channel) => channel >= 0 && channel <= 1);
}

/**
 * Checks a posed skeleton and its triangle lists after one animation sample.
 *
 * @param {object} skeleton The live skeleton, posed.
 * @param {object[]} lists The triangle lists built for it.
 * @param {Uint8Array} seen Scratch with one entry per slot, all 0. It is left all 0.
 * @returns {string | null} A message for the first problem, or null when the frame is sound.
 */
function checkAnimationFrame(skeleton, lists, seen) {
	const { slots, drawOrder } = skeleton;
	let problem = drawOrder.length === slots.length ? null : `draw order has ${drawOrder.length} slots, not ${slots.length}`;
	for (let i = 0; i < drawOrder.length && problem === null; i++) {
		const slot = drawOrder[i];
		if (!slot || slots[slot.index] !== slot || seen[slot.index] === 1) {
			problem = `draw order is not a permutation of the slots (place ${i})`;
		} else {
			seen[slot.index] = 1;
		}
	}
	seen.fill(0);
	for (let i = 0; i < slots.length && problem === null; i++) {
		const slot = slots[i];
		if (!isUnitColor(slot.color) || (slot.darkColor && !isUnitColor(slot.darkColor))) {
			problem = `slot "${slot.data.name}" has a color channel outside [0, 1]`;
		}
	}
	for (let i = 0; i < lists.length && problem === null; i++) {
		const list = lists[i];
		const listProblem = checkTriangleList(list);
		if (listProblem) {
			problem = `slot "${slots[list.slotIndex].data.name}": ${listProblem}`;
		} else if (!isUnitColor(list.color) || (list.darkColor && !isUnitColor(list.darkColor))) {
			problem = `slot "${slots[list.slotIndex].data.name}": a triangle color channel is outside [0, 1]`;
		}
	}
	return problem;
}

/**
 * Checks two colors match within `COLOR_TOLERANCE`. The expected color is clamped to [0, 1] first, as the runtime clamps.
 *
 * @param {{ r: number, g: number, b: number, a: number }} expected The color the slot should hold.
 * @param {{ r: number, g: number, b: number, a: number }} actual The slot's color.
 * @param {boolean} withAlpha True to compare alpha too.
 * @returns {boolean} True when every compared channel matches.
 */
function colorMatches(expected, actual, withAlpha) {
	const channels = withAlpha ? ["r", "g", "b", "a"] : ["r", "g", "b"];
	return channels.every((channel) => Math.abs(Math.min(1, Math.max(0, expected[channel])) - actual[channel]) <= COLOR_TOLERANCE);
}

/**
 * Blends two colors in a straight line, independently of the runtime.
 *
 * @param {{ r: number, g: number, b: number, a: number }} from The color at fraction 0.
 * @param {{ r: number, g: number, b: number, a: number }} to The color at fraction 1.
 * @param {number} fraction How far from `from` toward `to`.
 * @returns {{ r: number, g: number, b: number, a: number }} The blended color.
 */
function lerpColor(from, to, fraction) {
	const at = (channel) => from[channel] + (to[channel] - from[channel]) * fraction;
	return { r: at("r"), g: at("g"), b: at("b"), a: at("a") };
}

/**
 * Checks the color and two-color timelines of one animation against their keys, so a blend run backwards cannot pass. Each timeline is
 * applied on its own. At every key time the slot must hold that key's color, and a quarter of the way along every linear segment it must
 * hold a straight blend of the two keys. The dark color's alpha is not compared, since it is unused. Keys are compared only in timelines
 * with one sorted run, and only when no other key shares their time, because otherwise another key wins at that time.
 *
 * @param {object} skeleton The live skeleton. Its slot colors are left changed.
 * @param {object} animation The animation.
 * @param {object} animationModule The loaded `animation.ts` module.
 * @param {object} stats The accumulator. `colorKeys` and `colorSegments` count what was compared.
 * @returns {string | null} A message for the first mismatch, or null when every compared color matches.
 */
function checkColorKeys(skeleton, animation, animationModule, stats) {
	for (const timeline of animation.timelines) {
		if (timeline.type !== "color" && timeline.type !== "twoColor") {
			continue;
		}
		const { times, curves } = timeline;
		if (times.some((time, index) => index > 0 && time < times[index - 1])) {
			continue;
		}
		const slot = skeleton.slots[timeline.slotIndex];
		const lights = timeline.type === "color" ? timeline.colors : timeline.lights;
		const darks = timeline.type === "twoColor" && slot.darkColor ? timeline.darks : null;
		const alone = { name: animation.name, duration: animation.duration, timelines: [timeline] };
		const holds = (time, light, dark) => {
			animationModule.applyAnimation(skeleton, alone, time);
			return colorMatches(light, slot.color, true) && (!dark || colorMatches(dark, slot.darkColor, false));
		};
		for (let index = 0; index < times.length; index++) {
			const time = times[index];
			if (times[index - 1] !== time && times[index + 1] !== time) {
				stats.colorKeys++;
				if (!holds(time, lights[index], darks?.[index])) {
					return `slot "${slot.data.name}" ${timeline.type} key ${index} at ${time}: color does not equal the key`;
				}
			}
			const next = times[index + 1];
			if (index + 1 < times.length && next > time && curves[index] === "linear") {
				stats.colorSegments++;
				const dark = darks ? lerpColor(darks[index], darks[index + 1], 0.25) : null;
				if (!holds(time + (next - time) * 0.25, lerpColor(lights[index], lights[index + 1], 0.25), dark)) {
					return `slot "${slot.data.name}" ${timeline.type} key ${index}: color a quarter of the way to the next key is not a straight blend`;
				}
			}
		}
	}
	return null;
}

/**
 * Plays every animation of one rig at `ANIMATION_SAMPLES` times and checks each frame. The rig shows the skin `defaultSkinName` picks.
 * Only the apply, update and triangle building are timed. A throw counts as a failed sample. Each animation's color keys are then checked
 * with `checkColorKeys`.
 *
 * @param {object} data The parsed skeleton.
 * @param {object} atlas The parsed atlas beside it.
 * @param {{ width: number, height: number }[]} pageSizes Each atlas page's real PNG size.
 * @param {object} modules The loaded `skeleton.ts`, `geometry.ts` and `animation.ts` modules, as `skeleton`, `geometry` and `animation`.
 * @param {object} stats The accumulator: `animations` and `samples` counts, `frameMicros` (one time per sample), `twoColorWithoutDark`, and
 *   the `colorKeys` and `colorSegments` that `checkColorKeys` counts.
 * @returns {string[]} The first `ANIMATION_PROBLEMS_SHOWN` problems, then a count of the rest.
 */
function checkRigAnimations(data, atlas, pageSizes, modules, stats) {
	const skeleton = new modules.skeleton.Skeleton(data);
	skeleton.setSkin(modules.skeleton.defaultSkinName(data));
	const seen = new Uint8Array(skeleton.slots.length);
	const problems = [];
	let hidden = 0;
	const report = (message) => {
		if (problems.length < ANIMATION_PROBLEMS_SHOWN) {
			problems.push(message);
		} else {
			hidden++;
		}
	};
	for (const animation of data.animations) {
		stats.animations++;
		for (const timeline of animation.timelines) {
			if (timeline.type === "twoColor" && data.slots[timeline.slotIndex].darkColor === null) {
				stats.twoColorWithoutDark++;
			}
		}
		for (let sample = 0; sample < ANIMATION_SAMPLES; sample++) {
			const time = (animation.duration * sample) / (ANIMATION_SAMPLES - 1);
			stats.samples++;
			let problem;
			try {
				const start = process.hrtime.bigint();
				skeleton.setToSetupPose();
				modules.animation.applyAnimation(skeleton, animation, time);
				skeleton.updateWorldTransform();
				const lists = modules.geometry.skeletonTriangles(skeleton, atlas, pageSizes);
				stats.frameMicros.push(Number(process.hrtime.bigint() - start) / 1000);
				problem = checkAnimationFrame(skeleton, lists, seen);
			} catch (error) {
				problem = `threw ${error.message}`;
				seen.fill(0);
			}
			if (problem !== null) {
				report(`animation "${animation.name}" at ${time.toFixed(4)}: ${problem}`);
			}
		}
		const colorProblem = checkColorKeys(skeleton, animation, modules.animation, stats);
		if (colorProblem !== null) {
			report(`animation "${animation.name}": ${colorProblem}`);
		}
	}
	if (hidden > 0) {
		problems.push(`and ${hidden} more failures`);
	}
	return problems;
}

/**
 * Prints the `--animation` summary line.
 *
 * @param {object} stats The accumulator `checkRigAnimations` filled, plus `rigs` and `failed` counts and `seconds` of wall time.
 */
function printAnimation(stats) {
	const sorted = Float64Array.from(stats.frameMicros).sort();
	console.log(
		`Animation: ${stats.rigs} rigs, ${stats.animations} animations, ${stats.samples} samples, frame median ${quantile(sorted, 0.5).toFixed(1)} us, ` +
			`p99 ${quantile(sorted, 0.99).toFixed(1)} us, max ${quantile(sorted, 1).toFixed(1)} us, ${stats.twoColorWithoutDark} two-color timelines on slots ` +
			`without a dark color, ${stats.colorKeys} color keys and ${stats.colorSegments} linear color segments compared, ${stats.failed} rigs failed, ` +
			`${stats.seconds.toFixed(1)} s`
	);
}

/**
 * Picks the value at a fraction of the way through a sorted list.
 *
 * @param {number[]} sorted The values, ascending.
 * @param {number} fraction 0 for the lowest, 1 for the highest.
 * @returns {number} The value at that rank, or NaN for an empty list.
 */
function quantile(sorted, fraction) {
	return sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

/**
 * Describes the spread of a list of IoU values.
 *
 * @param {number[]} sorted The values, ascending.
 * @returns {string} The count, min, p10 and median, and how many fall below `MIN_IOU`.
 */
function describeSpread(sorted) {
	const low = sorted.filter((iou) => iou < MIN_IOU).length;
	return `${sorted.length} rigs, min ${quantile(sorted, 0).toFixed(3)}, p10 ${quantile(sorted, 0.1).toFixed(3)}, median ${quantile(sorted, 0.5).toFixed(3)}, ${low} below ${MIN_IOU}`;
}

/**
 * Prints the `--geometry` report: the lowest-IoU rigs, the declared-larger rigs, the UV warnings, the IoU spread for rigs with and without
 * constraints, then one summary line.
 *
 * @param {object} geometry The accumulator filled while scanning.
 */
function printGeometry(geometry) {
	const scored = geometry.rigs.filter((rig) => rig.iou !== null).sort((a, b) => a.iou - b.iou);
	const sorted = scored.map((rig) => rig.iou);
	const good = sorted.filter((iou) => iou >= GOOD_IOU).length;
	console.log("");
	console.log(`Geometry: ${WORST_SHOWN} lowest bounds IoU:`);
	for (const rig of scored.slice(0, WORST_SHOWN)) {
		console.log(`  ${rig.iou.toFixed(3)} ${rig.constrained ? "transform/path" : rig.ik ? "IK only       " : "unconstrained "} ${rig.shown}`);
	}
	const declaredLarger = geometry.rigs.filter((rig) => rig.verdict === "declaredLarger");
	console.log(`Geometry: ${declaredLarger.length} judged rigs below IoU ${MIN_IOU} drawn inside a larger declared box (not failed):`);
	for (const rig of declaredLarger) {
		console.log(`  ${rig.iou.toFixed(3)} ${rig.shown}`);
	}
	const stale = geometry.rigs.filter((rig) => rig.verdict === "staleBounds");
	console.log(`Geometry: ${stale.length} judged rigs below IoU ${MIN_IOU} listed in STALE_DECLARED_BOUNDS (not failed):`);
	for (const rig of stale) {
		console.log(`  ${rig.iou.toFixed(3)} ${rig.shown}`);
	}
	const uvWarned = geometry.rigs.filter((rig) => rig.uvWarnings.length > 0);
	const uvSlots = uvWarned.reduce((count, rig) => count + rig.uvWarnings.length, 0);
	console.log(`Geometry: warning, ${uvSlots} slots in ${uvWarned.length} rigs have a UV outside [0, 1] (not failed):`);
	for (const rig of uvWarned) {
		console.log(`  ${rig.shown}: ${rig.uvWarnings.join(", ")}`);
	}
	console.log(`Geometry: ${geometry.namedSkinRigs} rigs drawn with their first named skin`);
	console.log(`Geometry: transform or path constraint rigs (reported only): ${describeSpread(scored.filter((rig) => rig.constrained).map((rig) => rig.iou))}`);
	console.log(`Geometry: IK-only rigs (judged): ${describeSpread(scored.filter((rig) => !rig.constrained && rig.ik).map((rig) => rig.iou))}`);
	console.log(`Geometry: unconstrained rigs (judged): ${describeSpread(scored.filter((rig) => !rig.constrained && !rig.ik).map((rig) => rig.iou))}`);
	const spread = `min ${quantile(sorted, 0).toFixed(3)}, p10 ${quantile(sorted, 0.1).toFixed(3)}, median ${quantile(sorted, 0.5).toFixed(3)}`;
	console.log(`Geometry: hull fit, ${geometry.hullFit.message}`);
	const judged = scored.filter((rig) => !rig.constrained).length;
	const constrainedNote = `${judged} judged, transform and path constraint rigs reported until those constraints are applied`;
	console.log(
		`Geometry: ${geometry.rigs.length} rigs checked, ${scored.length} scored, ${geometry.rigs.length - scored.length} unscored, ` +
			`${geometry.triangles} triangles drawn, ${geometry.lists} lists built, IoU ${spread}, ${good} rigs with IoU >= ${GOOD_IOU}, ` +
			`${declaredLarger.length} declared larger, ${uvSlots} UV warnings, ${geometry.failed} failed (${constrainedNote}), ` +
			`hull fit ${geometry.hullFit.passed ? "passed" : "FAILED"}`
	);
}

/**
 * Judges the corpus-wide hull fit: the overall share against `MIN_HULL_FIT`, and each `rotate` group of at least `MIN_HULL_GROUP_SIZE`
 * meshes against `MIN_HULL_FIT_GROUP`.
 *
 * @param {{ rotate: number, fits: boolean }[]} results Every stripped mesh's hull fit.
 * @returns {{ passed: boolean, message: string }} Whether the fit passes, and a line giving the overall and per-rotate rates.
 */
function judgeHullFit(results) {
	const rate = (list) => (list.length === 0 ? 1 : list.filter((result) => result.fits).length / list.length);
	const describe = (list) => `${list.filter((result) => result.fits).length}/${list.length} (${(rate(list) * 100).toFixed(1)}%)`;
	let passed = rate(results) >= MIN_HULL_FIT;
	const groups = [0, 90, 180, 270].map((rotate) => {
		const group = results.filter((result) => result.rotate === rotate);
		const judged = group.length >= MIN_HULL_GROUP_SIZE;
		if (judged && rate(group) < MIN_HULL_FIT_GROUP) {
			passed = false;
		}
		return `rotate ${rotate} ${describe(group)}${judged ? "" : " not judged"}`;
	});
	return { passed, message: `${describe(results)} of stripped meshes meet their packed box, ${groups.join(", ")}` };
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// IK

/**
 * Wraps an angle difference into [-180, 180).
 *
 * @param {number} degrees The difference, in degrees.
 * @returns {number} The same turn, in [-180, 180).
 */
function shortTurn(degrees) {
	return degrees - 360 * Math.floor((degrees + 180) / 360);
}

/**
 * Measures how far a chain's end is from its target in the current pose, in world units. For one bone it is the target's distance from
 * the bone's X axis line, or infinity when the target is behind the bone. For two bones it is the child's tip to the target.
 *
 * @param {object} constraint A live IK constraint, with world transforms up to date.
 * @returns {number} The gap.
 */
function ikGap(constraint) {
	const { bones, target } = constraint;
	const last = bones[bones.length - 1];
	if (bones.length === 1) {
		const length = Math.hypot(last.a, last.c);
		const dx = target.worldX - last.worldX;
		const dy = target.worldY - last.worldY;
		if (length === 0 || dx * last.a + dy * last.c <= 0) {
			return Infinity;
		}
		return Math.abs(dx * last.c - dy * last.a) / length;
	}
	const tipX = last.a * last.data.length + last.worldX;
	const tipY = last.c * last.data.length + last.worldY;
	return Math.hypot(tipX - target.worldX, tipY - target.worldY);
}

/**
 * Solves one constraint alone on the setup pose and reads the chain's applied rotations.
 *
 * @param {object} skeleton The skeleton, just reset to the setup pose.
 * @param {object} constraint The constraint to solve. Every other constraint is held at mix 0.
 * @param {number} bendDirection The bend direction to solve with.
 * @returns {number[]} The applied rotation of each chain bone.
 */
function solveAlone(skeleton, constraint, bendDirection) {
	for (const other of skeleton.ikConstraints) {
		other.mix = other === constraint ? 1 : 0;
	}
	constraint.bendDirection = bendDirection;
	skeleton.updateWorldTransform();
	return constraint.bones.map((bone) => bone.appliedRotation);
}

/**
 * Runs the setup-pose self-consistency checks on one rig's chains with setup mix 1 and adds to the counts.
 *
 * @param {object} data The parsed skeleton.
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} stats The accumulator: `one` and `two` counts, see `printIk`.
 */
function checkIkSetup(data, skeletonModule, stats) {
	const skeleton = new skeletonModule.Skeleton(data);
	skeleton.setToSetupPose();
	for (const constraint of skeleton.ikConstraints) {
		constraint.mix = 0;
	}
	skeleton.updateWorldTransform();
	const gaps = skeleton.ikConstraints.map(ikGap);
	skeleton.ikConstraints.forEach((constraint, index) => {
		const gap = gaps[index];
		if (constraint.data.mix !== 1 || gap >= IK_LOOSE_GAP) {
			return;
		}
		const setup = constraint.bones.map((bone) => bone.rotation);
		const bend = constraint.data.bendDirection;
		const solved = solveAlone(skeleton, constraint, bend);
		const reproduces = solved.every((rotation, bone) => Math.abs(shortTurn(rotation - setup[bone])) < IK_ANGLE_TOLERANCE);
		const kind = constraint.bones.length === 1 ? stats.one : stats.two;
		kind.loose++;
		kind.looseHits += reproduces ? 1 : 0;
		if (constraint.bones.length === 1) {
			if (gap < IK_SETUP_GAP) {
				stats.one.judged++;
				stats.one.hits += reproduces ? 1 : 0;
			}
			return;
		}
		const mirror = solveAlone(skeleton, constraint, -bend);
		if (Math.abs(shortTurn(solved[1] - mirror[1])) < IK_MIRROR_SEPARATION) {
			stats.two.tooStraight++;
			return;
		}
		const distance = (rotations) => rotations.reduce((sum, rotation, bone) => sum + Math.abs(shortTurn(rotation - setup[bone])), 0);
		stats.two.judged++;
		stats.two.hits += distance(solved) < distance(mirror) ? 1 : 0;
	});
}

/**
 * Finds the constraints whose result a later constraint can move: a later one's first bone is an ancestor of, or is, one of this chain's
 * bones or its target. Their end position is not checked under animation.
 *
 * @param {object} skeleton The live skeleton.
 * @returns {Set<object>} The constraints to leave out of the reach check.
 */
function movedLater(skeleton) {
	const ordered = [...skeleton.ikConstraints].sort((first, second) => first.data.order - second.data.order);
	const isAncestorOrSelf = (ancestor, bone) => {
		for (let current = bone; current; current = current.parent) {
			if (current === ancestor) {
				return true;
			}
		}
		return false;
	};
	const moved = new Set();
	ordered.forEach((constraint, index) => {
		const watched = [...constraint.bones, constraint.target];
		if (ordered.slice(index + 1).some((later) => watched.some((bone) => isAncestorOrSelf(later.bones[0], bone)))) {
			moved.add(constraint);
		}
	});
	return moved;
}

/**
 * Checks one posed chain: finite applied values, and at mix 1 without stretch, that it reaches its target or lies on the line to it.
 *
 * @param {object} constraint A live IK constraint, with world transforms up to date.
 * @param {boolean} checkReach False to check only the finite values.
 * @param {object} stats The accumulator, whose `reach` counts are updated.
 * @returns {string | null} A message for the first problem, or null.
 */
function checkIkChain(constraint, checkReach, stats) {
	for (const bone of constraint.bones) {
		if (![bone.appliedRotation, bone.appliedScaleX, bone.appliedScaleY, bone.a, bone.c, bone.worldX, bone.worldY].every(Number.isFinite)) {
			return `IK "${constraint.data.name}" bone "${bone.data.name}" has a value that is not finite`;
		}
	}
	if (!checkReach || constraint.mix !== 1 || constraint.stretch) {
		return null;
	}
	const { bones, target } = constraint;
	const first = bones[0];
	const dx = target.worldX - first.worldX;
	const dy = target.worldY - first.worldY;
	const distance = Math.hypot(dx, dy);
	if (distance < IK_REACH_TOLERANCE) {
		return null;
	}
	if (bones.length === 1) {
		stats.reach.checked++;
		if (ikGap(constraint) > IK_REACH_TOLERANCE) {
			return `IK "${constraint.data.name}" does not point at its target (off by ${ikGap(constraint).toFixed(4)})`;
		}
		return null;
	}
	const child = bones[1];
	const nonuniform = Math.abs(Math.abs(first.appliedScaleX) - Math.abs(first.appliedScaleY)) > IK_UNIFORM_TOLERANCE;
	if (nonuniform || bones.some((bone) => bone.data.transformMode !== "normal")) {
		stats.reach.inexact++;
		return null;
	}
	stats.reach.checked++;
	const tipX = child.a * child.data.length + child.worldX;
	const tipY = child.c * child.data.length + child.worldY;
	const offLine = Math.abs((tipX - first.worldX) * dy - (tipY - first.worldY) * dx) / distance;
	const upper = Math.hypot(child.worldX - first.worldX, child.worldY - first.worldY);
	const lower = Math.hypot(tipX - child.worldX, tipY - child.worldY);
	const reachable = constraint.softness === 0 && distance > Math.abs(upper - lower) + IK_REACH_TOLERANCE && distance < upper + lower - IK_REACH_TOLERANCE;
	const miss = Math.hypot(tipX - target.worldX, tipY - target.worldY);
	if (offLine > IK_REACH_TOLERANCE || (reachable && miss > IK_REACH_TOLERANCE)) {
		return `IK "${constraint.data.name}" tip is ${miss.toFixed(4)} from its target and ${offLine.toFixed(4)} off the line to it`;
	}
	return null;
}

/**
 * Plays every animation of one IK rig and checks every chain at each sample.
 *
 * @param {object} data The parsed skeleton.
 * @param {object} modules The loaded `skeleton.ts` and `animation.ts` modules, as `skeleton` and `animation`.
 * @param {object} stats The accumulator, see `printIk`.
 * @returns {string[]} The first `ANIMATION_PROBLEMS_SHOWN` problems, then a count of the rest.
 */
function checkIkAnimations(data, modules, stats) {
	const skeleton = new modules.skeleton.Skeleton(data);
	const moved = movedLater(skeleton);
	stats.movedLater += moved.size;
	const problems = [];
	let hidden = 0;
	for (const animation of data.animations) {
		for (let sample = 0; sample < ANIMATION_SAMPLES; sample++) {
			const time = (animation.duration * sample) / (ANIMATION_SAMPLES - 1);
			skeleton.setToSetupPose();
			modules.animation.applyAnimation(skeleton, animation, time);
			skeleton.updateWorldTransform();
			stats.samples++;
			for (const constraint of skeleton.ikConstraints) {
				const problem = checkIkChain(constraint, !moved.has(constraint), stats);
				if (problem === null) {
					continue;
				}
				stats.reach.failed++;
				if (problems.length < ANIMATION_PROBLEMS_SHOWN) {
					problems.push(`animation "${animation.name}" at ${time.toFixed(4)}: ${problem}`);
				} else {
					hidden++;
				}
			}
		}
	}
	if (hidden > 0) {
		problems.push(`and ${hidden} more failures`);
	}
	return problems;
}

/**
 * Judges the setup-pose rates against `IK_MIN_ONE_BONE` and `IK_MIN_TWO_BONE`.
 *
 * @param {object} stats The accumulator, see `printIk`.
 * @returns {boolean} True when both rates pass.
 */
function ikSetupPasses(stats) {
	const rate = (kind) => (kind.judged === 0 ? 1 : kind.hits / kind.judged);
	return rate(stats.one) >= IK_MIN_ONE_BONE && rate(stats.two) >= IK_MIN_TWO_BONE;
}

/**
 * Prints the `--ik` summary lines.
 *
 * @param {object} stats The accumulator: `one` and `two` setup counts (`judged`, `hits`, `loose`, `looseHits`, and `tooStraight` for two),
 *   `reach` counts (`checked`, `inexact`, `failed`), `samples`, `movedLater`, `rigs`, `failed` and `seconds`.
 */
function printIk(stats) {
	const percent = (hits, total) => `${hits}/${total} (${total === 0 ? "-" : ((hits / total) * 100).toFixed(1)}%)`;
	console.log("");
	console.log(`IK: one-bone chains with setup gap < ${IK_SETUP_GAP} solving to their setup rotation: ${percent(stats.one.hits, stats.one.judged)}, need ${IK_MIN_ONE_BONE * 100}%`);
	console.log(
		`IK: two-bone chains with setup gap < ${IK_LOOSE_GAP} nearer their bend's solution than the mirror: ${percent(stats.two.hits, stats.two.judged)}, ` +
			`need ${IK_MIN_TWO_BONE * 100}% (${stats.two.tooStraight} too straight to tell)`
	);
	console.log(
		`IK: information, setup gap < ${IK_LOOSE_GAP} with every rotation within ${IK_ANGLE_TOLERANCE} degrees: one-bone ${percent(stats.one.looseHits, stats.one.loose)}, ` +
			`two-bone ${percent(stats.two.looseHits, stats.two.loose)}`
	);
	console.log(
		`IK: ${stats.rigs} rigs, ${stats.samples} animation samples, ${stats.reach.checked} chain samples checked for reach, ${stats.reach.inexact} skipped ` +
			`(nonuniform parent or non-normal bone), ${stats.movedLater} chains moved by a later constraint, ${stats.reach.failed} chain failures, ` +
			`${stats.failed} rigs failed, setup rates ${ikSetupPasses(stats) ? "passed" : "FAILED"}, ${stats.seconds.toFixed(1)} s`
	);
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
 * @param {ReadonlySet<string>} supported The stage's full feature set, from `STAGE_FEATURES` in `features.ts`.
 * @returns {boolean} True if the stage's runtime would draw the rig in full.
 */
function isFullySupported(features, supported) {
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
 * @param {{ FEATURES: readonly string[], STAGE_FEATURES: ReadonlyMap<number, ReadonlySet<string>> }} featuresModule The loaded
 *   `features.ts`, which owns the feature list and the planned stage sets.
 * @returns {object} The accumulator: the feature list and stage sets, per-feature usage counts by kind, per-stage rig counts, a rig total,
 *   and each operator's base battle rig features, keyed by operator id.
 */
function createSurvey(featuresModule) {
	const { FEATURES, STAGE_FEATURES } = featuresModule;
	return {
		features: FEATURES,
		stageFeatures: STAGE_FEATURES,
		featureKindCounts: new Map(FEATURES.map((feature) => [feature, { battle: 0, back: 0, dorm: 0 }])),
		rigStageCounts: new Map([...STAGE_FEATURES.keys()].map((stage) => [stage, 0])),
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
	for (const [stage, supported] of survey.stageFeatures) {
		if (isFullySupported(features, supported)) {
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
	for (const feature of survey.features) {
		const counts = survey.featureKindCounts.get(feature);
		const total = counts.battle + counts.back + counts.dorm;
		console.log(`  ${feature}: ${total} (battle ${counts.battle}, back ${counts.back}, dorm ${counts.dorm})`);
	}

	const operatorFeatures = [...survey.operatorBaseBattleFeatures.values()];
	console.log("");
	console.log(`Stage coverage (${survey.rigsSurveyed} rigs surveyed, ${operatorFeatures.length} operators with a base battle rig):`);
	for (const [stage, supported] of survey.stageFeatures) {
		const operatorCount = operatorFeatures.filter((features) => isFullySupported(features, supported)).length;
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
	const spineDir = path.join(parseStaging(process.argv.slice(2), USAGE), "assets", "spine");
	const skelFiles = fs.existsSync(spineDir) ? findFiles(spineDir, ".skel") : [];
	const atlasFiles = fs.existsSync(spineDir) ? findFiles(spineDir, ".atlas") : [];
	if (skelFiles.length === 0 && atlasFiles.length === 0) {
		console.error(`No .skel or .atlas files under ${spineDir}`);
		process.exit(1);
	}
	const wantSurvey = process.argv.includes("--survey");
	const wantGeometry = process.argv.includes("--geometry");
	const wantAnimation = process.argv.includes("--animation");
	const wantIk = process.argv.includes("--ik");

	const server = await startVite();
	let survey = null;
	let failed = 0;
	let repeatingKeys = 0;
	let repeatingFiles = 0;
	let atlasFailed = 0;
	let pagesChecked = 0;
	let pagesWithDeclaredSize = 0;
	let maxFillFraction = 0;
	const typeCounts = {};
	const atlasByKey = new Map();
	const pageSizesByKey = new Map();
	const geometry = { rigs: [], lists: 0, triangles: 0, failed: 0, namedSkinRigs: 0, hullResults: [], hullFit: null };
	const ik = {
		one: { judged: 0, hits: 0, loose: 0, looseHits: 0 },
		two: { judged: 0, hits: 0, loose: 0, looseHits: 0, tooStraight: 0 },
		reach: { checked: 0, inexact: 0, failed: 0 },
		samples: 0,
		movedLater: 0,
		rigs: 0,
		failed: 0,
		seconds: 0
	};
	const animation = { rigs: 0, animations: 0, samples: 0, frameMicros: [], twoColorWithoutDark: 0, colorKeys: 0, colorSegments: 0, failed: 0, seconds: 0 };
	try {
		const { readSkeleton } = await server.ssrLoadModule("/src/spine/binary.ts");
		const { readAtlas } = await server.ssrLoadModule("/src/spine/atlas.ts");
		const featuresModule = wantSurvey ? await server.ssrLoadModule("/src/spine/features.ts") : null;
		survey = featuresModule ? createSurvey(featuresModule) : null;
		const skeletonModule = wantGeometry || wantAnimation || wantIk ? await server.ssrLoadModule("/src/spine/skeleton.ts") : null;
		const geometryModule = wantGeometry || wantAnimation ? await server.ssrLoadModule("/src/spine/geometry.ts") : null;
		const animationModule = wantAnimation || wantIk ? await server.ssrLoadModule("/src/spine/animation.ts") : null;

		for (const file of atlasFiles) {
			const shown = shownPath(file);
			const dir = path.dirname(file);
			let atlas;
			try {
				atlas = readAtlas(fs.readFileSync(file, "utf-8"));
			} catch (error) {
				atlasFailed++;
				console.log(`${shown}: ${error.message}`);
				continue;
			}
			atlasByKey.set(pairingKey(file), atlas);

			let pageProblem = false;
			const pageSizes = [];
			pageSizesByKey.set(pairingKey(file), pageSizes);
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
				pageSizes.push(size);
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
			const shown = shownPath(file);
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
					recordRig(survey, rigPath, featuresModule.featuresOf(data));
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
				const pageSizes = pageSizesByKey.get(pairingKey(file));
				if (wantGeometry && pageSizes.length === atlas.pages.length) {
					const rig = checkRigGeometry(data, atlas, pageSizes, skeletonModule, geometryModule, path.relative(spineDir, file).split(path.sep).join("/"));
					geometry.rigs.push({ shown, iou: rig.iou, constrained: rig.constrained, ik: rig.ik, verdict: rig.verdict, uvWarnings: rig.uvWarnings });
					geometry.lists += rig.lists;
					geometry.triangles += rig.triangles;
					geometry.namedSkinRigs += rig.namedSkin ? 1 : 0;
					geometry.hullResults.push(...rig.hullFits);
					if (rig.problems.length > 0) {
						geometry.failed++;
						result.problems.push(...rig.problems.map((problem) => `geometry: ${problem}`));
					}
				}
				if (wantAnimation && pageSizes.length === atlas.pages.length) {
					const start = performance.now();
					const modules = { skeleton: skeletonModule, geometry: geometryModule, animation: animationModule };
					const problems = checkRigAnimations(data, atlas, pageSizes, modules, animation);
					animation.seconds += (performance.now() - start) / 1000;
					animation.rigs++;
					if (problems.length > 0) {
						animation.failed++;
						result.problems.push(...problems.map((problem) => `animation: ${problem}`));
					}
				}
			} else {
				result.problems.push(`no atlas beside this skeleton (expected ${path.basename(pairingKey(file))}.atlas)`);
			}
			if (wantIk && data.ik.length > 0) {
				const start = performance.now();
				checkIkSetup(data, skeletonModule, ik);
				const problems = checkIkAnimations(data, { skeleton: skeletonModule, animation: animationModule }, ik);
				ik.seconds += (performance.now() - start) / 1000;
				ik.rigs++;
				if (problems.length > 0) {
					ik.failed++;
					result.problems.push(...problems.map((problem) => `ik: ${problem}`));
				}
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
	if (wantGeometry) {
		geometry.hullFit = judgeHullFit(geometry.hullResults);
		printGeometry(geometry);
	}
	if (wantAnimation) {
		printAnimation(animation);
	}
	if (wantIk) {
		printIk(ik);
	}
	const hullFailed = wantGeometry && !geometry.hullFit.passed;
	const ikFailed = wantIk && !ikSetupPasses(ik);
	process.exit(failed > 0 || atlasFailed > 0 || hullFailed || ikFailed ? 1 : 0);
}

// Run only when called as a script, so a scratch check can import `checkSkeleton` without parsing the corpus.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
