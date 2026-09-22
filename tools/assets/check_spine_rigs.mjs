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
 *     node tools/assets/check_spine_rigs.mjs [--staging PATH] [--survey] [--geometry] [--animation] [--ik] [--transform] [--clipping]
 *
 * Scans every `.skel` and `.atlas` under `<staging>/assets/spine`. `--staging` defaults to `tools/assets/.staging`. `--survey` also prints
 * how many rigs use each feature, how many each planned stage would draw in full, how many need exactly that stage, and how many operators
 * have at least one rig it draws. `--geometry` also turns every rig's setup pose into triangles with `src/spine/geometry.ts`: every drawing
 * attachment must give a list with finite positions and indices in range. A UV outside [0, 1] is a warning, since a few meshes reach past
 * their stripped image. Every clipped list is checked with `checkClippedFrame`. The drawn bounds are compared with the skeleton's declared
 * bounds by intersection-over-union. A rig with a path constraint is only reported, since those are not applied yet. Every other rig is
 * judged. Below 0.5 it fails unless the drawn box sits inside the declared one, which hidden or other-skin attachments can widen. A rig that
 * declares no bounds, or draws nothing in its setup pose, is counted as unscored. It also checks UV orientation: the packer strips
 * whitespace down to a mesh's hull, so a stripped mesh's hull, mapped to page pixels, should meet every edge of its packed box.
 *
 * `--animation` plays every animation of every rig with `src/spine/animation.ts`. Each is sampled at `ANIMATION_SAMPLES` evenly spaced
 * times from 0 to its duration: reset to the setup pose, apply, update and build triangles. Every position, UV and color must be finite,
 * every color channel must be in [0, 1], the draw order must be a permutation of the slots, and every clipped list must pass
 * `checkClippedFrame`. Every color and two-color key must also show its own color at its time, and every linear color segment a straight
 * blend a quarter of the way along. Every deform offset must be finite, and each deform key, applied on its own to its target at its own
 * time, must give exactly that key's offsets. It prints the frame time (median and p99 for apply, update and triangles), how many two-color
 * timelines drive a slot with no dark color, and how many deform timelines found their attachment in the slot at some sample and how many
 * never did.
 *
 * `--ik` checks every rig with an IK constraint. In the setup pose, with setup mix 1: a one-bone chain whose target is within
 * `IK_SETUP_GAP` of its line must solve back to its setup rotation, and a two-bone chain within `IK_LOOSE_GAP` must sit nearer the solution
 * its bend direction picks than the mirror one. The brief gap-0.5 angle rates are printed too, for information. Then it plays every
 * animation at `ANIMATION_SAMPLES` times: solved rotations and scales must be finite, and a chain at mix 1 without stretch must point at
 * its target (one bone), or end on it or on the line to it (two bones). A chain is left out of the reach check at a sample where a later
 * constraint that touches it (see `touchingLater`) has a mix other than 0. It prints the run time.
 *
 * `--transform` checks every rig with a transform constraint. No constraint may be relative. In the setup pose, for each world constraint
 * with a channel at setup mix 1, the bone's unconstrained setup world value is compared with each reading of the offsets (see `MATH.md`).
 * Of the entries that at least one reading places, the runtime's own solve must place at least `TC_MIN_SETUP` per channel. With the
 * skeleton flipped, at least `TC_MIN_MIRROR` of constrained bones must mirror. Under animation, at `ANIMATION_SAMPLES` times, every
 * constrained bone must be finite, and a world constraint at translate mix 1 must put its bone on the target point, except at a sample
 * where a later constraint that touches it has a mix other than 0. It prints the rates and the run time.
 *
 * `--clipping` checks every rig with a clipping attachment. It surveys the clip polygons in their setup pose (weighted or not, winding,
 * concave, vertex count, and end slots that are the clip slot or come before it). It then builds the setup pose and every animation at
 * `ANIMATION_SAMPLES` times and checks each frame with `checkClippedFrame`. Each frame is also timed with and without clipping, and the
 * `CLIP_COSTLIEST_SHOWN` rigs with the most extra time per frame are printed.
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
const USAGE = "Usage: node tools/assets/check_spine_rigs.mjs [--staging PATH] [--survey] [--geometry] [--animation] [--ik] [--transform] [--clipping]  (scans <staging>/assets/spine)";

/** Lowest intersection-over-union between a rig's drawn and declared setup bounds before `--geometry` fails it. */
const MIN_IOU = 0.5;

/**
 * Rigs whose declared bounds do not fit their own setup pose, so a low IoU is reported, not failed. Each is listed with its evidence.
 * `char_4036_forcer_epoque_20` back declares a box 166 x 150 at y 68 to 218, while its setup pose draws 404 x 509 from y -72 to 437. The
 * IoU is 0.121 with or without IK applied, and its battle twin, which shares the art, scores the same.
 */
const STALE_DECLARED_BOUNDS = new Set(["char_4036_forcer/epoque_20/back/char_4036_forcer_epoque_20.skel"]);

/**
 * Rigs first judged once transform constraints were applied, whose IoU is below `MIN_IOU` with every transform constraint off too (within
 * 0.002), and with clipping on or off (unchanged), so the low IoU comes from neither. A low IoU is reported, not failed. The slots furthest
 * past the declared box: `char_4138_narant` weapon chain `F_Weapon_1_*` (up to 784), `char_4055_bgsnow` `C_Weapon_*` (334),
 * `char_2025_shu` nian_11 `F_Tail_*` (371), `char_4141_marcil` back `B_R_Foot` and `B_R_Hand` (303) and battle `C_Bird1` (263), and
 * `char_4177_brigid` `F_Weapon_L` (19, under a declared box that is wider than the drawing).
 */
const LOW_WITHOUT_TRANSFORM = new Set([
	"char_2025_shu/nian_11/back/char_2025_shu_nian_11.skel",
	"char_4055_bgsnow/base/back/char_4055_bgsnow.skel",
	"char_4138_narant/base/back/char_4138_narant.skel",
	"char_4138_narant/base/battle/char_4138_narant.skel",
	"char_4141_marcil/base/back/char_4141_marcil.skel",
	"char_4141_marcil/base/battle/char_4141_marcil.skel",
	"char_4177_brigid/base/battle/char_4177_brigid.skel"
]);

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

/** Largest difference `--animation` allows between a deform offset and the key value it should equal. */
const DEFORM_TOLERANCE = 1e-6;

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

/** How far, in world units, a setup bone may sit from where a transform constraint's translate puts it and still count as placed. */
const TC_POSITION_TOLERANCE = 0.5;

/** How far, in degrees, a setup bone's angle may sit from a transform constraint's rotate or shear solution and still count as placed. */
const TC_ANGLE_TOLERANCE = 0.5;

/** How far, as a fraction, a setup bone's axis length may sit from a transform constraint's scale solution and still count as placed. */
const TC_SCALE_TOLERANCE = 0.005;

/** Lowest share, per channel, of the placed setup entries that the runtime's solve must also place. */
const TC_MIN_SETUP = 0.9;

/** Lowest share of constrained bones whose world transform under a flipped skeleton must mirror the unflipped one. */
const TC_MIN_MIRROR = 0.99;

/** Largest difference, relative to the value's size (at least 1), between a flipped world value and the mirror of the unflipped one. */
const TC_MIRROR_TOLERANCE = 1e-6;

/** How far, in world units, a clipped vertex may sit outside its clip polygon. */
const CLIP_INSIDE_TOLERANCE = 1e-3;

/** How far, in square world units, a clipped slot's area may sit from the independent overlap area, on top of `CLIP_AREA_RELATIVE`. */
const CLIP_AREA_TOLERANCE = 1e-3;

/** How far, as a fraction of the overlap area, a clipped slot's area may sit from it, on top of `CLIP_AREA_TOLERANCE`. */
const CLIP_AREA_RELATIVE = 1e-4;

/** How many times `--clipping` builds each sampled frame with and without clipping, keeping the fastest of each. */
const CLIP_TIMING_REPEATS = 5;

/** How many rigs `--clipping` names as the costliest to clip. */
const CLIP_COSTLIEST_SHOWN = 3;

/** How far, in world units, a bone at translate mix 1 may sit from its target point under animation. */
const TC_REACH_TOLERANCE = 0.01;

/** The transform constraint channels, with the data mix each is judged at. */
const TC_CHANNELS = ["translate", "rotate", "scale", "shear"];

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
 * @param {string} rigPath The rig's path under the staged spine directory, for `STALE_DECLARED_BOUNDS` and `LOW_WITHOUT_TRANSFORM`.
 * @param {object} clipStats The accumulator `checkClippedFrame` fills.
 * @returns {object} `problems`, every failure found. `uvWarnings`, the slots with a UV outside [0, 1]. `iou`, the bounds IoU, or null when
 *   either box is empty. `verdict` for a low IoU: `"failed"`, `"declaredLarger"`, `"staleBounds"`,
 *   `"lowWithoutTransform"` or `"constrained"`, or null when the IoU is fine or unscored.
 *   `lists` and `triangles`, how much was built. `namedSkin`, whether a named skin was set. `constrained`, whether the rig has a path
 *   constraint, which the setup pose here does not apply. `ik`, whether it has an IK or transform constraint, which it does apply.
 */
function checkRigGeometry(data, atlas, pageSizes, skeletonModule, geometryModule, rigPath, clipStats) {
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
	const clipProblem = checkClippedFrame(skeleton, lists, atlas, pageSizes, geometryModule, clipStats);
	if (clipProblem) {
		problems.push(clipProblem);
	}
	const declared = { minX: data.x, minY: data.y, maxX: data.x + data.width, maxY: data.y + data.height };
	const iou = drawn && data.width > 0 && data.height > 0 ? intersectionOverUnion(drawn, declared) : null;
	const constrained = data.path.length > 0;
	let verdict = null;
	if (iou !== null && iou < MIN_IOU) {
		if (constrained) {
			verdict = "constrained";
		} else if (isInside(drawn, declared)) {
			verdict = "declaredLarger";
		} else if (STALE_DECLARED_BOUNDS.has(rigPath)) {
			verdict = "staleBounds";
		} else if (LOW_WITHOUT_TRANSFORM.has(rigPath)) {
			verdict = "lowWithoutTransform";
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
		ik: data.ik.length + data.transform.length > 0
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
 * Checks the deform timelines of one animation against their keys. Each timeline is applied on its own with its target shown in the slot.
 * At every key time the slot must hold that key's offsets over the target's full length, with 0 outside the key's stored range. Keys are
 * compared only in timelines with one sorted run, and only when no other key shares their time. A target that is a linked mesh passing
 * its deforms on to its parent, or has no vertices, is skipped.
 *
 * @param {object} data The parsed skeleton.
 * @param {object} skeleton The live skeleton. Its pose is left changed.
 * @param {object} animation The animation.
 * @param {object} animationModule The loaded `animation.ts` module.
 * @param {object} stats The accumulator. `deformKeys` counts what was compared.
 * @returns {string | null} A message for the first mismatch, or null when every compared key matches.
 */
function checkDeformKeys(data, skeleton, animation, animationModule, stats) {
	for (const timeline of animation.timelines) {
		if (timeline.type !== "deform") {
			continue;
		}
		const { times, starts, values } = timeline;
		if (times.some((time, index) => index > 0 && time < times[index - 1])) {
			continue;
		}
		const target = data.skins[timeline.skinIndex]?.attachments.get(timeline.slotIndex)?.get(timeline.attachmentName);
		const owner = target ? resolveDeformTarget(data, timeline.skinIndex, timeline.slotIndex, timeline.attachmentName) : null;
		if (!target || typeof owner !== "object" || !owner.vertices || (target.type === "linkedmesh" && target.deform)) {
			continue;
		}
		const length = deformLength(owner);
		const slot = skeleton.slots[timeline.slotIndex];
		const alone = { name: animation.name, duration: animation.duration, timelines: [timeline] };
		for (let index = 0; index < times.length; index++) {
			const time = times[index];
			if (times[index - 1] === time || times[index + 1] === time) {
				continue;
			}
			stats.deformKeys++;
			skeleton.setToSetupPose();
			slot.attachment = target;
			slot.deformLength = 0;
			animationModule.applyAnimation(skeleton, alone, time);
			if (slot.deformLength !== length) {
				return `slot "${slot.data.name}" deform "${timeline.attachmentName}" key ${index} at ${time}: deformLength ${slot.deformLength}, not ${length}`;
			}
			const key = values[index];
			for (let j = 0; j < length; j++) {
				const expected = j >= starts[index] && j < starts[index] + key.length ? key[j - starts[index]] : 0;
				if (Math.abs(slot.deform[j] - expected) > DEFORM_TOLERANCE) {
					return `slot "${slot.data.name}" deform "${timeline.attachmentName}" key ${index} at ${time}: offset ${j} is ${slot.deform[j]}, not ${expected}`;
				}
			}
		}
	}
	return null;
}

/**
 * Checks every slot's live deform offsets are finite.
 *
 * @param {object} skeleton The live skeleton, posed.
 * @returns {string | null} A message for the first slot with a non-finite offset, or null when all are finite.
 */
function checkDeformFinite(skeleton) {
	for (const slot of skeleton.slots) {
		for (let j = 0; j < slot.deformLength; j++) {
			if (!Number.isFinite(slot.deform[j])) {
				return `slot "${slot.data.name}" deform offset ${j} is not finite`;
			}
		}
	}
	return null;
}

/**
 * Plays every animation of one rig at `ANIMATION_SAMPLES` times and checks each frame. The rig shows the skin `defaultSkinName` picks.
 * Only the apply, update and triangle building are timed. A throw counts as a failed sample. Each animation's color keys are then checked
 * with `checkColorKeys`, and its deform keys with `checkDeformKeys`. Each deform timeline counts as found when, at some sample, the slot
 * shows an attachment whose `deformSource` is the timeline's target.
 *
 * @param {object} data The parsed skeleton.
 * @param {object} atlas The parsed atlas beside it.
 * @param {{ width: number, height: number }[]} pageSizes Each atlas page's real PNG size.
 * @param {object} modules The loaded `skeleton.ts`, `geometry.ts` and `animation.ts` modules, as `skeleton`, `geometry` and `animation`.
 * @param {object} stats The accumulator: `animations` and `samples` counts, `frameMicros` (one time per sample), `twoColorWithoutDark`, and
 *   the `colorKeys` and `colorSegments` that `checkColorKeys` counts, `deformTimelines`, `deformFound` and `deformNeverFound`, and the
 *   `deformKeys` that `checkDeformKeys` counts.
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
		const deforms = [];
		for (const timeline of animation.timelines) {
			if (timeline.type === "twoColor" && data.slots[timeline.slotIndex].darkColor === null) {
				stats.twoColorWithoutDark++;
			}
			if (timeline.type === "deform") {
				const target = data.skins[timeline.skinIndex]?.attachments.get(timeline.slotIndex)?.get(timeline.attachmentName);
				deforms.push({ slot: skeleton.slots[timeline.slotIndex], target, found: false });
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
				problem = checkAnimationFrame(skeleton, lists, seen) ?? checkDeformFinite(skeleton);
				for (const deform of deforms) {
					const shown = deform.slot.attachment;
					deform.found ||= shown !== null && deform.target !== undefined && modules.geometry.deformSource(skeleton, deform.slot.index, shown) === deform.target;
				}
				problem ??= checkClippedFrame(skeleton, lists, atlas, pageSizes, modules.geometry, stats.clip);
			} catch (error) {
				problem = `threw ${error.message}`;
				seen.fill(0);
			}
			if (problem !== null) {
				report(`animation "${animation.name}" at ${time.toFixed(4)}: ${problem}`);
			}
		}
		for (const deform of deforms) {
			stats.deformTimelines++;
			if (deform.found) {
				stats.deformFound++;
			} else {
				stats.deformNeverFound++;
			}
		}
		const colorProblem = checkColorKeys(skeleton, animation, modules.animation, stats);
		if (colorProblem !== null) {
			report(`animation "${animation.name}": ${colorProblem}`);
		}
		let deformProblem;
		try {
			deformProblem = checkDeformKeys(data, skeleton, animation, modules.animation, stats);
		} catch (error) {
			deformProblem = `deform keys threw ${error.message}`;
		}
		if (deformProblem !== null) {
			report(`animation "${animation.name}": ${deformProblem}`);
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
			`without a dark color, ${stats.colorKeys} color keys and ${stats.colorSegments} linear color segments compared, ` +
			`${stats.deformTimelines} deform timelines (${stats.deformFound} found their attachment at some sample, ${stats.deformNeverFound} never did), ` +
			`${stats.deformKeys} deform keys compared, ${stats.clip.clippedLists} clipped slots checked (${stats.clip.crossedLists} under a self-crossing clip, ${stats.clip.clippedAway} slots clipped to nothing), ` +
			`${stats.failed} rigs failed, ` +
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
		console.log(`  ${rig.iou.toFixed(3)} ${rig.constrained ? "path          " : rig.ik ? "IK/transform  " : "unconstrained "} ${rig.shown}`);
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
	const lowWithoutTransform = geometry.rigs.filter((rig) => rig.verdict === "lowWithoutTransform");
	console.log(`Geometry: ${lowWithoutTransform.length} judged rigs below IoU ${MIN_IOU} listed in LOW_WITHOUT_TRANSFORM (not failed):`);
	for (const rig of lowWithoutTransform) {
		console.log(`  ${rig.iou.toFixed(3)} ${rig.shown}`);
	}
	const uvWarned = geometry.rigs.filter((rig) => rig.uvWarnings.length > 0);
	const uvSlots = uvWarned.reduce((count, rig) => count + rig.uvWarnings.length, 0);
	console.log(`Geometry: warning, ${uvSlots} slots in ${uvWarned.length} rigs have a UV outside [0, 1] (not failed):`);
	for (const rig of uvWarned) {
		console.log(`  ${rig.shown}: ${rig.uvWarnings.join(", ")}`);
	}
	console.log(`Geometry: ${geometry.namedSkinRigs} rigs drawn with their first named skin`);
	console.log(`Geometry: path constraint rigs (reported only): ${describeSpread(scored.filter((rig) => rig.constrained).map((rig) => rig.iou))}`);
	console.log(`Geometry: IK or transform constraint rigs without a path constraint (judged): ${describeSpread(scored.filter((rig) => !rig.constrained && rig.ik).map((rig) => rig.iou))}`);
	console.log(`Geometry: unconstrained rigs (judged): ${describeSpread(scored.filter((rig) => !rig.constrained && !rig.ik).map((rig) => rig.iou))}`);
	const spread = `min ${quantile(sorted, 0).toFixed(3)}, p10 ${quantile(sorted, 0.1).toFixed(3)}, median ${quantile(sorted, 0.5).toFixed(3)}`;
	console.log(`Geometry: hull fit, ${geometry.hullFit.message}`);
	const judged = scored.filter((rig) => !rig.constrained).length;
	const constrainedNote = `${judged} judged, path constraint rigs reported until those constraints are applied`;
	console.log(
		`Geometry: ${geometry.rigs.length} rigs checked, ${scored.length} scored, ${geometry.rigs.length - scored.length} unscored, ` +
			`${geometry.triangles} triangles drawn, ${geometry.lists} lists built, IoU ${spread}, ${good} rigs with IoU >= ${GOOD_IOU}, ` +
			`${declaredLarger.length} declared larger, ${uvSlots} UV warnings, ${geometry.failed} failed (${constrainedNote}), ` +
			`hull fit ${geometry.hullFit.passed ? "passed" : "FAILED"}, ${geometry.clip.clippedLists} clipped slots checked (${geometry.clip.crossedLists} under a self-crossing clip, ${geometry.clip.clippedAway} slots clipped to nothing)`
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
// Clipping

/**
 * Finds which slots a frame clips, by walking the live draw order: a slot showing a clipping attachment starts a clip unless one is active,
 * and the clip covers every later slot through its end slot. An end slot that is the clip slot, or came earlier, runs to the end.
 *
 * @param {object} skeleton The posed skeleton.
 * @returns {Map<number, object>} The clip slot covering each clipped slot, keyed by the clipped slot's index.
 */
function clippedSlots(skeleton) {
	const covered = new Map();
	let active = null;
	let end = -1;
	for (const slot of skeleton.drawOrder) {
		const attachment = slot.attachment;
		if (attachment?.type === "clipping") {
			if (!active) {
				active = slot;
				end = attachment.endSlotIndex === slot.index ? -1 : attachment.endSlotIndex;
			}
		} else if (active) {
			covered.set(slot.index, active);
		}
		if (active && slot.index === end) {
			active = null;
		}
	}
	return covered;
}

/**
 * Counts a vertex list's vertices: one per x, y pair, or one per run of bone influences when weighted.
 *
 * @param {object} vertices The vertices.
 * @returns {number} The vertex count.
 */
function polygonVertexCount(vertices) {
	if (!vertices.weighted) {
		return vertices.values.length / 2;
	}
	let count = 0;
	for (let b = 0; b < vertices.bones.length; b += vertices.bones[b] + 1) {
		count++;
	}
	return count;
}

/**
 * Places a clipping attachment's polygon in the world with the slot's deform, through `computeWorldVertices`.
 *
 * @param {object} skeleton The posed skeleton.
 * @param {object} slot The slot showing the attachment.
 * @param {object} attachment The clipping attachment.
 * @param {object} geometryModule The loaded `geometry.ts` module.
 * @returns {Float32Array} The polygon, flattened as x0, y0, x1, y1, ...
 */
function worldPolygon(skeleton, slot, attachment, geometryModule) {
	const polygon = new Float32Array(polygonVertexCount(attachment.vertices) * 2);
	geometryModule.computeWorldVertices(skeleton, slot, attachment.vertices, polygon);
	return polygon;
}

/**
 * Works out a polygon's signed area with the shoelace formula, independently of the runtime.
 *
 * @param {ArrayLike<number>} polygon The vertices, flattened as x0, y0, x1, y1, ...
 * @returns {number} The area, positive when the vertices run counterclockwise.
 */
function shoelace(polygon) {
	const count = polygon.length / 2;
	let twice = 0;
	for (let i = 0, j = count - 1; i < count; j = i++) {
		twice += polygon[j * 2] * polygon[i * 2 + 1] - polygon[i * 2] * polygon[j * 2 + 1];
	}
	return twice / 2;
}

/**
 * Checks whether a polygon has corners turning both ways, so it is concave.
 *
 * @param {ArrayLike<number>} polygon The vertices, flattened as x0, y0, x1, y1, ...
 * @returns {boolean} True when some corners turn left and some right.
 */
function isConcave(polygon) {
	const count = polygon.length / 2;
	let left = false;
	let right = false;
	for (let i = 0; i < count; i++) {
		const [a, b, c] = [i * 2, ((i + 1) % count) * 2, ((i + 2) % count) * 2];
		const turn = (polygon[b] - polygon[a]) * (polygon[c + 1] - polygon[b + 1]) - (polygon[b + 1] - polygon[a + 1]) * (polygon[c] - polygon[b]);
		left ||= turn > 0;
		right ||= turn < 0;
	}
	return left && right;
}

/**
 * Checks whether any two edges of a polygon that do not share a corner cross each other.
 *
 * @param {ArrayLike<number>} polygon The vertices, flattened as x0, y0, x1, y1, ...
 * @returns {boolean} True when the polygon crosses itself.
 */
function selfIntersects(polygon) {
	const count = polygon.length / 2;
	const side = (a, b, c) => Math.sign((polygon[b * 2] - polygon[a * 2]) * (polygon[c * 2 + 1] - polygon[a * 2 + 1]) - (polygon[b * 2 + 1] - polygon[a * 2 + 1]) * (polygon[c * 2] - polygon[a * 2]));
	for (let i = 0; i < count; i++) {
		const i2 = (i + 1) % count;
		for (let j = i + 2; j < count; j++) {
			const j2 = (j + 1) % count;
			if (j2 === i) {
				continue;
			}
			if (side(i, i2, j) * side(i, i2, j2) < 0 && side(j, j2, i) * side(j, j2, i2) < 0) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Checks a point lies inside a polygon of either winding, or within `CLIP_INSIDE_TOLERANCE` of its boundary.
 *
 * @param {ArrayLike<number>} polygon The vertices, flattened as x0, y0, x1, y1, ...
 * @param {number} x The point's X.
 * @param {number} y The point's Y.
 * @returns {boolean} True when the point is inside or near enough.
 */
function insideOrNear(polygon, x, y) {
	const count = polygon.length / 2;
	let inside = false;
	for (let i = 0, j = count - 1; i < count; j = i++) {
		const [xi, yi, xj, yj] = [polygon[i * 2], polygon[i * 2 + 1], polygon[j * 2], polygon[j * 2 + 1]];
		const lengthSquared = (xj - xi) ** 2 + (yj - yi) ** 2;
		const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - xi) * (xj - xi) + (y - yi) * (yj - yi)) / lengthSquared));
		if (Math.hypot(x - (xi + along * (xj - xi)), y - (yi + along * (yj - yi))) <= CLIP_INSIDE_TOLERANCE) {
			return true;
		}
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

/**
 * Sums the absolute areas of a triangle list's triangles.
 *
 * @param {ArrayLike<number>} positions The vertex positions, flattened as x0, y0, x1, y1, ...
 * @param {ArrayLike<number>} indices The triangle indices, 3 per triangle.
 * @returns {number} The total area.
 */
function listArea(positions, indices) {
	let area = 0;
	for (let i = 0; i < indices.length; i += 3) {
		const [a, b, c] = [indices[i] * 2, indices[i + 1] * 2, indices[i + 2] * 2];
		area += Math.abs((positions[b] - positions[a]) * (positions[c + 1] - positions[a + 1]) - (positions[c] - positions[a]) * (positions[b + 1] - positions[a + 1])) / 2;
	}
	return area;
}

/**
 * Works out the area where a polygon and a triangle overlap, independently of the runtime. The polygon, which may be concave, is cut by
 * each edge of the triangle in turn (Sutherland-Hodgman with the triangle as the convex window). A concave polygon can come out with
 * zero-width joins between its parts, but those add no area to the shoelace sum.
 *
 * @param {ArrayLike<number>} polygon The polygon's vertices, flattened as x0, y0, x1, y1, ..., either winding.
 * @param {number[]} triangle The triangle's corners as x0, y0, x1, y1, x2, y2, either winding.
 * @returns {number} The overlap area.
 */
function overlapArea(polygon, triangle) {
	const corners = [
		[triangle[0], triangle[1]],
		[triangle[2], triangle[3]],
		[triangle[4], triangle[5]]
	];
	const turn = (corners[1][0] - corners[0][0]) * (corners[2][1] - corners[0][1]) - (corners[1][1] - corners[0][1]) * (corners[2][0] - corners[0][0]);
	if (turn === 0) {
		return 0;
	}
	if (turn < 0) {
		corners.reverse();
	}
	let points = [];
	for (let i = 0; i < polygon.length; i += 2) {
		points.push([polygon[i], polygon[i + 1]]);
	}
	for (let e = 0; e < 3 && points.length > 0; e++) {
		const [ax, ay] = corners[e];
		const [bx, by] = corners[(e + 1) % 3];
		const side = ([x, y]) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
		const next = [];
		for (let i = 0; i < points.length; i++) {
			const current = points[i];
			const previous = points[(i + points.length - 1) % points.length];
			const [dc, dp] = [side(current), side(previous)];
			if (dc >= 0 !== dp >= 0) {
				const t = dp / (dp - dc);
				next.push([previous[0] + (current[0] - previous[0]) * t, previous[1] + (current[1] - previous[1]) * t]);
			}
			if (dc >= 0) {
				next.push(current);
			}
		}
		points = next;
	}
	return Math.abs(shoelace(points.flat()));
}

/**
 * Checks every clipped list of one frame. Each must be finite, and every vertex must be inside its clip polygon (see `insideOrNear`). Its
 * area must match the independent overlap of the clip polygon with each of the slot's unclipped triangles (see `overlapArea`), within
 * `CLIP_AREA_TOLERANCE` plus `CLIP_AREA_RELATIVE` of it, so a clip that loses area fails as well as one that keeps too much. A slot clipped
 * to nothing is held to the same area check. A clip polygon that crosses itself has no clear inside, and the user guide says clipping does
 * not work correctly with one, so its lists are only counted. The unclipped triangles come from `slotTriangles`, which rewrites that slot's
 * pooled list, so the frame's lists must not be used afterwards.
 *
 * @param {object} skeleton The posed skeleton the lists were built from.
 * @param {object[]} lists The frame's triangle lists from `skeletonTriangles`.
 * @param {object} atlas The parsed atlas.
 * @param {{ width: number, height: number }[]} pageSizes Each atlas page's real PNG size.
 * @param {object} geometryModule The loaded `geometry.ts` module.
 * @param {object} stats The accumulator: `clippedLists` counts slots judged, `crossedLists` slots under a self-crossing clip, `clippedAway`
 *   slots clipped to nothing, `mostVertices` keeps the largest clipped vertex count, and `worstGap` the largest area difference.
 * @returns {string | null} A message for the first problem, or null when every clipped list is sound.
 */
export function checkClippedFrame(skeleton, lists, atlas, pageSizes, geometryModule, stats) {
	const covered = clippedSlots(skeleton);
	if (covered.size === 0) {
		return null;
	}
	const polygons = new Map();
	for (const clipSlot of new Set(covered.values())) {
		const polygon = worldPolygon(skeleton, clipSlot, clipSlot.attachment, geometryModule);
		polygons.set(clipSlot, selfIntersects(polygon) ? null : polygon);
	}
	const drawnAreas = new Map();
	for (const list of lists) {
		const clipSlot = covered.get(list.slotIndex);
		if (!clipSlot) {
			continue;
		}
		const polygon = polygons.get(clipSlot);
		const slotName = skeleton.slots[list.slotIndex].data.name;
		stats.mostVertices = Math.max(stats.mostVertices, list.positions.length / 2);
		if (!list.positions.every(Number.isFinite) || !list.uvs.every(Number.isFinite)) {
			return `slot "${slotName}" clipped by "${clipSlot.data.name}": a position or UV is not finite`;
		}
		if (!polygon) {
			continue;
		}
		for (let i = 0; i < list.positions.length; i += 2) {
			if (!insideOrNear(polygon, list.positions[i], list.positions[i + 1])) {
				return `slot "${slotName}" clipped by "${clipSlot.data.name}": vertex (${list.positions[i]}, ${list.positions[i + 1]}) is outside the clip`;
			}
		}
		drawnAreas.set(list.slotIndex, listArea(list.positions, list.indices));
	}
	const drawnSlots = new Set(lists.map((list) => list.slotIndex));
	for (const [index, clipSlot] of covered) {
		const slot = skeleton.slots[index];
		const whole = geometryModule.slotTriangles(skeleton, slot, atlas, pageSizes);
		if (!whole) {
			continue;
		}
		if (!drawnSlots.has(index)) {
			stats.clippedAway++;
		}
		const polygon = polygons.get(clipSlot);
		if (!polygon) {
			stats.crossedLists++;
			continue;
		}
		stats.clippedLists++;
		let expected = 0;
		const { positions, indices } = whole;
		for (let i = 0; i < indices.length; i += 3) {
			const [a, b, c] = [indices[i] * 2, indices[i + 1] * 2, indices[i + 2] * 2];
			expected += overlapArea(polygon, [positions[a], positions[a + 1], positions[b], positions[b + 1], positions[c], positions[c + 1]]);
		}
		const area = drawnAreas.get(index) ?? 0;
		stats.worstGap = Math.max(stats.worstGap, Math.abs(area - expected));
		if (Math.abs(area - expected) > CLIP_AREA_TOLERANCE + CLIP_AREA_RELATIVE * expected) {
			return `slot "${slot.data.name}" clipped by "${clipSlot.data.name}": area ${area} does not match the overlap ${expected}`;
		}
	}
	return null;
}

/**
 * Surveys a rig's clipping attachments in the setup pose, across every skin.
 *
 * @param {object} data The parsed skeleton.
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} geometryModule The loaded `geometry.ts` module.
 * @param {object} stats The accumulator: `clips`, and per `weighted` and `unweighted` group the `count`, `clockwise`, `counterclockwise`,
 *   `flat` and `concave` counts, `sizes` by vertex count range, and `endSelf` and `endBefore` example lists.
 * @param {string} shown The rig's printed path.
 * @returns {number} How many slots hold a clipping attachment in some skin.
 */
function surveyClips(data, skeletonModule, geometryModule, stats, shown) {
	const skeleton = new skeletonModule.Skeleton(data);
	skeleton.setSkin(skeletonModule.defaultSkinName(data));
	skeleton.setToSetupPose();
	skeleton.updateWorldTransform();
	const place = new Map(skeleton.drawOrder.map((slot, index) => [slot.index, index]));
	const clipSlots = new Set();
	for (const skin of data.skins) {
		for (const [slotIndex, attachments] of skin.attachments) {
			for (const attachment of attachments.values()) {
				if (attachment.type !== "clipping") {
					continue;
				}
				clipSlots.add(slotIndex);
				const slot = skeleton.slots[slotIndex];
				const shownAttachment = slot.attachment;
				slot.attachment = attachment;
				const polygon = worldPolygon(skeleton, slot, attachment, geometryModule);
				slot.attachment = shownAttachment;
				const group = stats[attachment.vertices.weighted ? "weighted" : "unweighted"];
				const area = shoelace(polygon);
				stats.clips++;
				group.count++;
				group[area > 0 ? "counterclockwise" : area < 0 ? "clockwise" : "flat"]++;
				group.concave += isConcave(polygon) ? 1 : 0;
				const count = polygon.length / 2;
				const range = count <= 4 ? "3-4" : count <= 8 ? "5-8" : count <= 16 ? "9-16" : count <= 32 ? "17-32" : "33+";
				stats.sizes[range] = (stats.sizes[range] ?? 0) + 1;
				const name = `${shown} "${data.slots[slotIndex].name}"`;
				if (attachment.endSlotIndex === slotIndex) {
					stats.endSelf.push(name);
				} else if (place.get(attachment.endSlotIndex) < place.get(slotIndex)) {
					stats.endBefore.push(`${name} ends at "${data.slots[attachment.endSlotIndex].name}"`);
				}
			}
		}
	}
	return clipSlots.size;
}

/**
 * Builds one frame's triangles with clipping, then without it (each slot on its own through `slotTriangles`), `CLIP_TIMING_REPEATS` times
 * each, and gives the fastest of each.
 *
 * @param {object} skeleton The posed skeleton.
 * @param {object} atlas The parsed atlas.
 * @param {{ width: number, height: number }[]} pageSizes Each atlas page's real PNG size.
 * @param {object} geometryModule The loaded `geometry.ts` module.
 * @returns {{ clipped: number, unclipped: number }} The fastest build times, in microseconds.
 */
function timeClipping(skeleton, atlas, pageSizes, geometryModule) {
	let clipped = Infinity;
	let unclipped = Infinity;
	for (let repeat = 0; repeat < CLIP_TIMING_REPEATS; repeat++) {
		let start = process.hrtime.bigint();
		geometryModule.skeletonTriangles(skeleton, atlas, pageSizes);
		clipped = Math.min(clipped, Number(process.hrtime.bigint() - start) / 1000);
		start = process.hrtime.bigint();
		for (const slot of skeleton.drawOrder) {
			geometryModule.slotTriangles(skeleton, slot, atlas, pageSizes);
		}
		unclipped = Math.min(unclipped, Number(process.hrtime.bigint() - start) / 1000);
	}
	return { clipped, unclipped };
}

/**
 * Checks one rig's clipping: surveys its clip polygons, then builds the setup pose and every animation at `ANIMATION_SAMPLES` times, times
 * each frame with and without clipping, and checks it with `checkClippedFrame`. A throw counts as a failed frame.
 *
 * @param {object} data The parsed skeleton.
 * @param {object} atlas The parsed atlas beside it.
 * @param {{ width: number, height: number }[]} pageSizes Each atlas page's real PNG size.
 * @param {object} modules The loaded `skeleton.ts`, `geometry.ts` and `animation.ts` modules, as `skeleton`, `geometry` and `animation`.
 * @param {object} stats The accumulator `surveyClips` and `checkClippedFrame` fill, plus `frames` and `costs`, one entry per rig with its
 *   extra time per frame.
 * @param {string} shown The rig's printed path.
 * @returns {string[]} The first `ANIMATION_PROBLEMS_SHOWN` problems, then a count of the rest.
 */
function checkRigClipping(data, atlas, pageSizes, modules, stats, shown) {
	const clipSlots = surveyClips(data, modules.skeleton, modules.geometry, stats, shown);
	const skeleton = new modules.skeleton.Skeleton(data);
	skeleton.setSkin(modules.skeleton.defaultSkinName(data));
	const problems = [];
	let hidden = 0;
	let extra = 0;
	let frames = 0;
	const poses = [{ name: "setup pose", animation: null, time: 0 }];
	for (const animation of data.animations) {
		for (let sample = 0; sample < ANIMATION_SAMPLES; sample++) {
			poses.push({ name: `animation "${animation.name}"`, animation, time: (animation.duration * sample) / (ANIMATION_SAMPLES - 1) });
		}
	}
	for (const { name, animation, time } of poses) {
		let problem;
		try {
			skeleton.setToSetupPose();
			if (animation) {
				modules.animation.applyAnimation(skeleton, animation, time);
			}
			skeleton.updateWorldTransform();
			const cost = timeClipping(skeleton, atlas, pageSizes, modules.geometry);
			extra += cost.clipped - cost.unclipped;
			frames++;
			const lists = modules.geometry.skeletonTriangles(skeleton, atlas, pageSizes);
			problem = checkClippedFrame(skeleton, lists, atlas, pageSizes, modules.geometry, stats);
		} catch (error) {
			problem = `threw ${error.message}`;
		}
		if (problem !== null) {
			if (problems.length < ANIMATION_PROBLEMS_SHOWN) {
				problems.push(`${name} at ${time.toFixed(4)}: ${problem}`);
			} else {
				hidden++;
			}
		}
	}
	stats.frames += frames;
	stats.costs.push({ shown, extraMicros: extra / frames, clipSlots });
	if (hidden > 0) {
		problems.push(`and ${hidden} more failures`);
	}
	return problems;
}

/**
 * Prints the `--clipping` report: the clip polygon survey, the costliest rigs to clip, then one summary line.
 *
 * @param {object} stats The accumulator `checkRigClipping` filled, plus `rigs` and `failed` counts and `seconds` of wall time.
 */
function printClipping(stats) {
	const group = (name) => {
		const counts = stats[name];
		return `${name} ${counts.count} (${counts.counterclockwise} counterclockwise, ${counts.clockwise} clockwise, ${counts.flat} flat, ${counts.concave} concave)`;
	};
	const sizes = ["3-4", "5-8", "9-16", "17-32", "33+"].map((range) => `${range}: ${stats.sizes[range] ?? 0}`).join(", ");
	console.log("");
	console.log(`Clipping: ${stats.clips} clipping attachments in the setup pose, ${group("unweighted")}, ${group("weighted")}; vertex counts ${sizes}`);
	console.log(`Clipping: ${stats.endSelf.length} end at their own slot, so they clip to the end of the draw order:`);
	for (const name of stats.endSelf) {
		console.log(`  ${name}`);
	}
	console.log(`Clipping: ${stats.endBefore.length} end at a slot earlier in the setup draw order, so they clip to the end:`);
	for (const name of stats.endBefore) {
		console.log(`  ${name}`);
	}
	console.log(`Clipping: ${CLIP_COSTLIEST_SHOWN} rigs with the most extra time per frame:`);
	for (const cost of [...stats.costs].sort((a, b) => b.extraMicros - a.extraMicros).slice(0, CLIP_COSTLIEST_SHOWN)) {
		console.log(`  +${cost.extraMicros.toFixed(1)} us ${cost.shown} (${cost.clipSlots} clip slots)`);
	}
	console.log(
		`Clipping: ${stats.rigs} rigs, ${stats.frames} frames, ${stats.clippedLists} clipped slots checked, ${stats.crossedLists} under a self-crossing clip (not judged), ${stats.clippedAway} slots clipped to nothing, ` +
			`largest clipped list ${stats.mostVertices} vertices, largest area gap ${stats.worstGap.toExponential(2)}, ${stats.failed} rigs failed, ${stats.seconds.toFixed(1)} s`
	);
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
 * Checks whether one bone is another or one of its ancestors.
 *
 * @param {object} ancestor The possible ancestor.
 * @param {object} bone The bone.
 * @returns {boolean} True when `ancestor` is `bone` or above it.
 */
function isAncestorOrSelf(ancestor, bone) {
	for (let current = bone; current; current = current.parent) {
		if (current === ancestor) {
			return true;
		}
	}
	return false;
}

/**
 * Lists every IK and transform constraint in the order they run: ascending `order`, with ties in file order and IK first.
 *
 * @param {object} skeleton The live skeleton.
 * @returns {{ constraint: object, moves: object[] }[]} Each constraint with the bones it moves directly: an IK chain's first bone, or
 *   every bone of a transform constraint.
 */
function constraintsInOrder(skeleton) {
	const steps = [
		...skeleton.ikConstraints.map((constraint) => ({ constraint, moves: [constraint.bones[0]] })),
		...skeleton.transformConstraints.map((constraint) => ({ constraint, moves: constraint.bones }))
	];
	return steps.sort((first, second) => first.constraint.data.order - second.constraint.data.order);
}

/**
 * Finds, for each constraint, the later IK and transform constraints that touch it: a bone the later one moves is, or is an ancestor of,
 * one of this constraint's bones or its target. Whether one of them actually moves anything depends on its live mixes, see `movedNow`.
 *
 * @param {object} skeleton The live skeleton.
 * @returns {Map<object, object[]>} Each constraint that some later constraint touches, with those later constraints.
 */
function touchingLater(skeleton) {
	const ordered = constraintsInOrder(skeleton);
	const touching = new Map();
	ordered.forEach(({ constraint }, index) => {
		const watched = [...constraint.bones, constraint.target];
		const later = ordered.slice(index + 1).filter((step) => step.moves.some((ancestor) => watched.some((bone) => isAncestorOrSelf(ancestor, bone))));
		if (later.length > 0) {
			touching.set(
				constraint,
				later.map((step) => step.constraint)
			);
		}
	});
	return touching;
}

/**
 * Checks whether a later constraint that touches this one moves anything at the current pose: an IK constraint with a mix other than 0, or
 * a transform constraint with any mix other than 0.
 *
 * @param {Map<object, object[]>} touching The map `touchingLater` gives.
 * @param {object} constraint The constraint whose result is about to be checked.
 * @returns {boolean} True when the reach check should be skipped at this pose.
 */
function movedNow(touching, constraint) {
	const later = touching.get(constraint);
	if (!later) {
		return false;
	}
	return later.some((other) => ("mix" in other ? other.mix !== 0 : other.rotateMix !== 0 || other.translateMix !== 0 || other.scaleMix !== 0 || other.shearMix !== 0));
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
	const touching = touchingLater(skeleton);
	stats.touched += skeleton.ikConstraints.filter((constraint) => touching.has(constraint)).length;
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
				const moved = movedNow(touching, constraint);
				if (moved && constraint.mix === 1 && !constraint.stretch) {
					stats.reach.movedLater++;
				}
				const problem = checkIkChain(constraint, !moved, stats);
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
 *   `reach` counts (`checked`, `inexact`, `movedLater`, `failed`), `samples`, `touched`, `rigs`, `failed` and `seconds`.
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
			`(nonuniform parent or non-normal bone), ${stats.reach.movedLater} skipped as moved by a later active constraint ` +
			`(${stats.touched} IK chains touched by a later constraint), ${stats.reach.failed} chain failures, ` +
			`${stats.failed} rigs failed, setup rates ${ikSetupPasses(stats) ? "passed" : "FAILED"}, ${stats.seconds.toFixed(1)} s`
	);
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Transform constraints

/**
 * Copies a bone's world transform.
 *
 * @param {object} bone The bone, with its world transform up to date.
 * @returns {{ a: number, b: number, c: number, d: number, worldX: number, worldY: number }} The copy.
 */
function worldOf(bone) {
	return { a: bone.a, b: bone.b, c: bone.c, d: bone.d, worldX: bone.worldX, worldY: bone.worldY };
}

/**
 * Gives a world transform's Y axis angle from its X axis, in degrees.
 *
 * @param {{ a: number, b: number, c: number, d: number }} world The world transform.
 * @returns {number} The angle.
 */
function shearAngle(world) {
	return ((Math.atan2(world.d, world.b) - Math.atan2(world.c, world.a)) * 180) / Math.PI;
}

/**
 * Gives a size difference as a fraction of the expected size.
 *
 * @param {number} want The expected size.
 * @param {number} got The actual size.
 * @returns {number} The fraction.
 */
function relativeError(want, got) {
	return Math.abs(got - want) / Math.max(Math.abs(want), 1e-9);
}

/**
 * Measures, for one channel, how far a bone's world transform sits from what a transform constraint at mix 1 gives under each reading of
 * the offsets. Reading 0 is the one the runtime uses. `MATH.md` ("Transform constraints") weighs them against each other.
 *
 * @param {string} channel One of `TC_CHANNELS`.
 * @param {object} data The constraint's data.
 * @param {object} bone The bone's world transform.
 * @param {object} target The target's world transform.
 * @returns {number[]} The error under each reading: world units for translate, degrees for rotate and shear, a fraction for scale.
 */
function readingErrors(channel, data, bone, target) {
	const reflected = target.a * target.d - target.b * target.c < 0 ? -1 : 1;
	switch (channel) {
		case "translate": {
			const pointX = target.a * data.offsetX + target.b * data.offsetY + target.worldX;
			const pointY = target.c * data.offsetX + target.d * data.offsetY + target.worldY;
			return [Math.hypot(bone.worldX - pointX, bone.worldY - pointY), Math.hypot(bone.worldX - target.worldX - data.offsetX, bone.worldY - target.worldY - data.offsetY)];
		}
		case "rotate": {
			const gap = ((Math.atan2(bone.c, bone.a) - Math.atan2(target.c, target.a)) * 180) / Math.PI;
			return [Math.abs(shortTurn(gap - reflected * data.offsetRotation)), Math.abs(shortTurn(gap - data.offsetRotation))];
		}
		case "scale": {
			const targetX = Math.hypot(target.a, target.c);
			const targetY = Math.hypot(target.b, target.d);
			const boneX = Math.hypot(bone.a, bone.c);
			const boneY = Math.hypot(bone.b, bone.d);
			return [
				Math.max(relativeError(targetX + data.offsetScaleX, boneX), relativeError(targetY + data.offsetScaleY, boneY)),
				Math.max(relativeError(targetX * (1 + data.offsetScaleX), boneX), relativeError(targetY * (1 + data.offsetScaleY), boneY))
			];
		}
		default: {
			const gap = shearAngle(bone) - shearAngle(target);
			const offset = data.offsetShearY;
			return [Math.abs(shortTurn(gap - reflected * offset)), Math.abs(shortTurn(gap - offset)), Math.abs(shortTurn(gap + offset))];
		}
	}
}

/**
 * Measures how far apart two world transforms of one bone are in one channel.
 *
 * @param {string} channel One of `TC_CHANNELS`.
 * @param {object} first One world transform.
 * @param {object} second The other.
 * @returns {number} The distance, in the channel's units.
 */
function channelDistance(channel, first, second) {
	switch (channel) {
		case "translate":
			return Math.hypot(first.worldX - second.worldX, first.worldY - second.worldY);
		case "rotate":
			return Math.abs(shortTurn(((Math.atan2(first.c, first.a) - Math.atan2(second.c, second.a)) * 180) / Math.PI));
		case "scale":
			return Math.max(relativeError(Math.hypot(second.a, second.c), Math.hypot(first.a, first.c)), relativeError(Math.hypot(second.b, second.d), Math.hypot(first.b, first.d)));
		default:
			return Math.abs(shortTurn(shearAngle(first) - shearAngle(second)));
	}
}

/**
 * Gives the tolerance a channel is judged against.
 *
 * @param {string} channel One of `TC_CHANNELS`.
 * @returns {number} The tolerance, in the channel's units.
 */
function channelTolerance(channel) {
	return channel === "translate" ? TC_POSITION_TOLERANCE : channel === "scale" ? TC_SCALE_TOLERANCE : TC_ANGLE_TOLERANCE;
}

/**
 * Poses a skeleton's setup pose with every transform constraint off, except one channel of one constraint at mix 1.
 *
 * @param {object} skeleton The live skeleton.
 * @param {object | null} only The constraint to solve, or null for none.
 * @param {string | null} channel The channel to solve.
 */
function solveChannel(skeleton, only, channel) {
	skeleton.setToSetupPose();
	for (const constraint of skeleton.transformConstraints) {
		for (const name of TC_CHANNELS) {
			constraint[`${name}Mix`] = constraint === only && name === channel ? 1 : 0;
		}
	}
	skeleton.updateWorldTransform();
}

/**
 * Runs the setup-pose check on one rig and counts relative constraints. For each world constraint, each bone set by only it, and each
 * channel at setup mix 1, the bone's setup world value with every transform constraint off is compared with each reading. The entry is
 * judged when some reading places the bone. The runtime then solves that channel alone, and the entry passes when the setup bone is
 * within tolerance of the solved bone.
 *
 * @param {object} data The parsed skeleton.
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} stats The accumulator, see `printTransform`.
 */
function checkTransformSetup(data, skeletonModule, stats) {
	const skeleton = new skeletonModule.Skeleton(data);
	const constraints = skeleton.transformConstraints;
	const setBy = new Map();
	for (const constraint of constraints) {
		stats.relative += constraint.data.relative ? 1 : 0;
		for (const bone of constraint.bones) {
			setBy.set(bone, (setBy.get(bone) ?? 0) + 1);
		}
	}
	solveChannel(skeleton, null, null);
	const setup = new Map(skeleton.bones.map((bone) => [bone, worldOf(bone)]));
	for (const constraint of constraints) {
		const constraintData = constraint.data;
		if (constraintData.local || constraintData.relative) {
			continue;
		}
		const bones = constraint.bones.filter((bone) => setBy.get(bone) === 1);
		for (const channel of TC_CHANNELS) {
			if (bones.length === 0 || constraintData[`${channel}Mix`] !== 1) {
				continue;
			}
			solveChannel(skeleton, constraint, channel);
			const tolerance = channelTolerance(channel);
			const counts = stats.setup[channel];
			for (const bone of bones) {
				const placed = readingErrors(channel, constraintData, setup.get(bone), setup.get(constraint.target)).some((error) => error <= tolerance);
				const solved = channelDistance(channel, setup.get(bone), worldOf(bone)) <= tolerance;
				counts.entries++;
				counts.raw += solved ? 1 : 0;
				if (placed) {
					counts.judged++;
					counts.hits += solved ? 1 : 0;
				}
			}
		}
	}
}

/**
 * Checks mirror invariance on one rig's setup pose: with the skeleton's X scale at -1, every constrained bone's world transform must be
 * the unflipped one mirrored across the Y axis.
 *
 * @param {object} data The parsed skeleton.
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} stats The accumulator, whose `mirror` counts are updated.
 */
function checkTransformMirror(data, skeletonModule, stats) {
	const skeleton = new skeletonModule.Skeleton(data);
	const bones = [...new Set(skeleton.transformConstraints.flatMap((constraint) => constraint.bones))];
	skeleton.setToSetupPose();
	skeleton.updateWorldTransform();
	const plain = bones.map(worldOf);
	skeleton.scaleX = -1;
	skeleton.updateWorldTransform();
	bones.forEach((bone, index) => {
		const before = plain[index];
		const mirrored = [-before.a, -before.b, before.c, before.d, -before.worldX, before.worldY];
		const after = [bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY];
		stats.mirror.checked++;
		if (mirrored.every((value, i) => Math.abs(value - after[i]) <= TC_MIRROR_TOLERANCE * Math.max(1, Math.abs(value)))) {
			stats.mirror.hits++;
		} else if (stats.mirror.examples.length < WORST_SHOWN) {
			stats.mirror.examples.push(`${bone.data.name} (${bone.data.transformMode})`);
		}
	});
}

/**
 * Plays every animation of one rig and checks every transform constraint at each sample: constrained bones are finite, and a world
 * constraint at translate mix 1 puts each bone on its target point, unless a later constraint that touches the bone, the target or an
 * ancestor has a mix other than 0 at that sample.
 *
 * @param {object} data The parsed skeleton.
 * @param {object} modules The loaded `skeleton.ts` and `animation.ts` modules, as `skeleton` and `animation`.
 * @param {object} stats The accumulator, see `printTransform`.
 * @returns {string[]} The first `ANIMATION_PROBLEMS_SHOWN` problems, then a count of the rest.
 */
function checkTransformAnimations(data, modules, stats) {
	const skeleton = new modules.skeleton.Skeleton(data);
	const touching = touchingLater(skeleton);
	const problems = [];
	let hidden = 0;
	const report = (problem) => {
		stats.reach.failed++;
		if (problems.length < ANIMATION_PROBLEMS_SHOWN) {
			problems.push(problem);
		} else {
			hidden++;
		}
	};
	for (const animation of data.animations) {
		for (let sample = 0; sample < ANIMATION_SAMPLES; sample++) {
			const time = (animation.duration * sample) / (ANIMATION_SAMPLES - 1);
			skeleton.setToSetupPose();
			modules.animation.applyAnimation(skeleton, animation, time);
			skeleton.updateWorldTransform();
			stats.samples++;
			for (const constraint of skeleton.transformConstraints) {
				const where = `animation "${animation.name}" at ${time.toFixed(4)}: transform "${constraint.data.name}"`;
				const finite = constraint.bones.every((bone) => [bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY].every(Number.isFinite));
				if (!finite) {
					report(`${where} has a bone whose world transform is not finite`);
					continue;
				}
				if (constraint.data.local || constraint.translateMix !== 1) {
					continue;
				}
				if (movedNow(touching, constraint)) {
					stats.reach.movedLater++;
					continue;
				}
				const { target, data: constraintData } = constraint;
				const pointX = target.a * constraintData.offsetX + target.b * constraintData.offsetY + target.worldX;
				const pointY = target.c * constraintData.offsetX + target.d * constraintData.offsetY + target.worldY;
				for (const bone of constraint.bones) {
					stats.reach.checked++;
					const miss = Math.hypot(bone.worldX - pointX, bone.worldY - pointY);
					if (miss > TC_REACH_TOLERANCE) {
						report(`${where} bone "${bone.data.name}" is ${miss.toFixed(4)} from its target point`);
					}
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
 * Judges the `--transform` rates: each channel's setup rate against `TC_MIN_SETUP`, the mirror rate against `TC_MIN_MIRROR`, and no
 * relative constraint.
 *
 * @param {object} stats The accumulator, see `printTransform`.
 * @returns {boolean} True when all pass.
 */
function transformPasses(stats) {
	const setupPasses = TC_CHANNELS.every((channel) => {
		const counts = stats.setup[channel];
		return counts.judged === 0 || counts.hits / counts.judged >= TC_MIN_SETUP;
	});
	const mirrorPasses = stats.mirror.checked === 0 || stats.mirror.hits / stats.mirror.checked >= TC_MIN_MIRROR;
	return setupPasses && mirrorPasses && stats.relative === 0;
}

/**
 * Prints the `--transform` summary lines.
 *
 * @param {object} stats The accumulator: `setup` counts per channel (`entries`, `raw`, `judged`, `hits`), `mirror` (`checked`, `hits`,
 *   `examples`), `relative`, `reach` (`checked`, `movedLater`, `failed`), `samples`, `rigs`, `failed` and `seconds`.
 */
function printTransform(stats) {
	const percent = (hits, total) => `${hits}/${total} (${total === 0 ? "-" : ((hits / total) * 100).toFixed(1)}%)`;
	console.log("");
	for (const channel of TC_CHANNELS) {
		const counts = stats.setup[channel];
		console.log(
			`Transform: ${channel}, setup entries some reading places that the solve places: ${percent(counts.hits, counts.judged)}, need ${TC_MIN_SETUP * 100}% ` +
				`(information: all mix-1 entries ${percent(counts.raw, counts.entries)})`
		);
	}
	const examples = stats.mirror.examples.length > 0 ? `, for example ${stats.mirror.examples.join(", ")}` : "";
	console.log(`Transform: constrained bones that mirror under a flipped skeleton: ${percent(stats.mirror.hits, stats.mirror.checked)}, need ${TC_MIN_MIRROR * 100}%${examples}`);
	console.log(
		`Transform: ${stats.rigs} rigs, ${stats.relative} relative constraints, ${stats.samples} animation samples, ${stats.reach.checked} bone samples ` +
			`checked at translate mix 1, ${stats.reach.movedLater} constraint samples skipped as moved by a later active constraint, ${stats.reach.failed} failures, ` +
			`${stats.failed} rigs failed, rates ${transformPasses(stats) ? "passed" : "FAILED"}, ${stats.seconds.toFixed(1)} s`
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
 * @returns {object} The accumulator: the feature list and stage sets, per-feature usage counts by kind, per-stage rig counts (cumulative and
 *   by the lowest stage each rig needs), a rig total, each operator's base battle rig features keyed by operator id, and each operator's
 *   lowest stage over all its rigs.
 */
function createSurvey(featuresModule) {
	const { FEATURES, STAGE_FEATURES } = featuresModule;
	return {
		features: FEATURES,
		stageFeatures: STAGE_FEATURES,
		featureKindCounts: new Map(FEATURES.map((feature) => [feature, { battle: 0, back: 0, dorm: 0 }])),
		rigStageCounts: new Map([...STAGE_FEATURES.keys()].map((stage) => [stage, 0])),
		rigNeedCounts: new Map([...STAGE_FEATURES.keys()].map((stage) => [stage, 0])),
		rigsSurveyed: 0,
		operatorBaseBattleFeatures: new Map(),
		operatorLowestStage: new Map()
	};
}

/**
 * Folds one parsed rig into a survey accumulator: its feature usage by kind, its stage coverage, and, when it is an operator's base
 * battle rig, its feature set for the per-operator stage counts.
 *
 * @param {object} survey The accumulator from `createSurvey`.
 * @param {{ operatorId: string, formKey: string, kind: string }} rigPath The rig's identity.
 * @param {Set<string>} features The rig's features, from `featuresOf`.
 * @param {number} stage The lowest stage that draws the rig in full, from `rigStage`.
 */
function recordRig(survey, rigPath, features, stage) {
	survey.rigsSurveyed++;
	survey.rigNeedCounts.set(stage, (survey.rigNeedCounts.get(stage) ?? 0) + 1);
	survey.operatorLowestStage.set(rigPath.operatorId, Math.min(stage, survey.operatorLowestStage.get(rigPath.operatorId) ?? Infinity));
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
 * feature set would fully support, how many rigs need exactly that stage, and how many operators have at least one rig it draws.
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
		const anyRig = [...survey.operatorLowestStage.values()].filter((lowest) => lowest <= stage).length;
		console.log(
			`  Stage ${stage}: ${operatorCount}/${operatorFeatures.length} operators, ${survey.rigStageCounts.get(stage)}/${survey.rigsSurveyed} rigs, ` +
				`${survey.rigNeedCounts.get(stage)} rigs need exactly this stage, ${anyRig}/${survey.operatorLowestStage.size} operators have at least one rig it draws`
		);
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
	const wantTransform = process.argv.includes("--transform");
	const wantClipping = process.argv.includes("--clipping");

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
	const geometry = {
		rigs: [],
		lists: 0,
		triangles: 0,
		failed: 0,
		namedSkinRigs: 0,
		hullResults: [],
		hullFit: null,
		clip: { clippedLists: 0, crossedLists: 0, clippedAway: 0, mostVertices: 0, worstGap: 0 }
	};
	const ik = {
		one: { judged: 0, hits: 0, loose: 0, looseHits: 0 },
		two: { judged: 0, hits: 0, loose: 0, looseHits: 0, tooStraight: 0 },
		reach: { checked: 0, inexact: 0, movedLater: 0, failed: 0 },
		samples: 0,
		touched: 0,
		rigs: 0,
		failed: 0,
		seconds: 0
	};
	const transform = {
		setup: Object.fromEntries(TC_CHANNELS.map((channel) => [channel, { entries: 0, raw: 0, judged: 0, hits: 0 }])),
		mirror: { checked: 0, hits: 0, examples: [] },
		relative: 0,
		reach: { checked: 0, movedLater: 0, failed: 0 },
		samples: 0,
		rigs: 0,
		failed: 0,
		seconds: 0
	};
	const animation = {
		rigs: 0,
		animations: 0,
		samples: 0,
		frameMicros: [],
		twoColorWithoutDark: 0,
		colorKeys: 0,
		colorSegments: 0,
		deformTimelines: 0,
		deformFound: 0,
		deformNeverFound: 0,
		deformKeys: 0,
		clip: { clippedLists: 0, crossedLists: 0, clippedAway: 0, mostVertices: 0, worstGap: 0 },
		failed: 0,
		seconds: 0
	};
	const clipping = {
		clips: 0,
		unweighted: { count: 0, counterclockwise: 0, clockwise: 0, flat: 0, concave: 0 },
		weighted: { count: 0, counterclockwise: 0, clockwise: 0, flat: 0, concave: 0 },
		sizes: {},
		endSelf: [],
		endBefore: [],
		clippedLists: 0,
		crossedLists: 0,
		clippedAway: 0,
		worstGap: 0,
		mostVertices: 0,
		frames: 0,
		costs: [],
		rigs: 0,
		failed: 0,
		seconds: 0
	};
	try {
		const { readSkeleton } = await server.ssrLoadModule("/src/spine/binary.ts");
		const { readAtlas } = await server.ssrLoadModule("/src/spine/atlas.ts");
		const featuresModule = wantSurvey ? await server.ssrLoadModule("/src/spine/features.ts") : null;
		survey = featuresModule ? createSurvey(featuresModule) : null;
		const skeletonModule = wantGeometry || wantAnimation || wantIk || wantTransform || wantClipping ? await server.ssrLoadModule("/src/spine/skeleton.ts") : null;
		const geometryModule = wantGeometry || wantAnimation || wantClipping ? await server.ssrLoadModule("/src/spine/geometry.ts") : null;
		const animationModule = wantAnimation || wantIk || wantTransform || wantClipping ? await server.ssrLoadModule("/src/spine/animation.ts") : null;

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
					recordRig(survey, rigPath, featuresModule.featuresOf(data), featuresModule.rigStage(data));
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
					const rig = checkRigGeometry(data, atlas, pageSizes, skeletonModule, geometryModule, path.relative(spineDir, file).split(path.sep).join("/"), geometry.clip);
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
				const hasClip = data.skins.some((skin) => [...skin.attachments.values()].some((attachments) => [...attachments.values()].some((attachment) => attachment.type === "clipping")));
				if (wantClipping && hasClip && pageSizes.length === atlas.pages.length) {
					const start = performance.now();
					const modules = { skeleton: skeletonModule, geometry: geometryModule, animation: animationModule };
					const problems = checkRigClipping(data, atlas, pageSizes, modules, clipping, shown);
					clipping.seconds += (performance.now() - start) / 1000;
					clipping.rigs++;
					if (problems.length > 0) {
						clipping.failed++;
						result.problems.push(...problems.map((problem) => `clipping: ${problem}`));
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
			if (wantTransform && data.transform.length > 0) {
				const start = performance.now();
				checkTransformSetup(data, skeletonModule, transform);
				checkTransformMirror(data, skeletonModule, transform);
				const problems = checkTransformAnimations(data, { skeleton: skeletonModule, animation: animationModule }, transform);
				transform.seconds += (performance.now() - start) / 1000;
				transform.rigs++;
				if (problems.length > 0) {
					transform.failed++;
					result.problems.push(...problems.map((problem) => `transform: ${problem}`));
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
	if (wantTransform) {
		printTransform(transform);
	}
	if (wantClipping) {
		printClipping(clipping);
	}
	const hullFailed = wantGeometry && !geometry.hullFit.passed;
	const ikFailed = wantIk && !ikSetupPasses(ik);
	const transformFailed = wantTransform && !transformPasses(transform);
	process.exit(failed > 0 || atlasFailed > 0 || hullFailed || ikFailed || transformFailed ? 1 : 0);
}

// Run only when called as a script, so a scratch check can import `checkSkeleton` without parsing the corpus.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
