// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Feature survey

/**
 * Names the Spine features a parsed skeleton can use, and reports which ones a given skeleton actually uses.
 *
 * The runtime is built in stages, and each stage supports a growing set of these features. `SUPPORTED` names what the current stage can
 * draw. A rig that uses a feature outside `SUPPORTED` keeps the placeholder instead of rendering wrong.
 */

import type { SkeletonData } from "./types.js";

/**
 * Every capability a Spine 3.8 rig can use, in survey order. `region`, `mesh` and the like name attachment kinds. `ik`,
 * `transformConstraint` and `pathConstraint` name constraint kinds. `deform`, `drawOrder`, `twoColor` and the `blend*` names are timeline
 * or slot effects. `transformModeNonNormal` is any bone transform mode other than the default, and `events` is custom event firing.
 */
export const FEATURES = [
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
] as const;

/** One capability a Spine 3.8 rig can use, from `FEATURES`. */
export type Feature = (typeof FEATURES)[number];

/** Features any stage can handle, since they draw nothing. */
const ALWAYS_SUPPORTED: readonly Feature[] = ["events", "point", "boundingBox"];

/** Features each planned stage adds on top of the stage before it. */
const STAGE_ADDS: readonly (readonly Feature[])[] = [
	["region", "mesh", "weightedMesh", "linkedMesh", "transformModeNonNormal"],
	["drawOrder", "twoColor", "blendAdditive", "blendMultiply", "blendScreen"],
	["deform", "ik", "transformConstraint", "clipping"],
	["path", "pathConstraint"]
];

/** Each planned stage's full feature set, keyed by stage number from 1: `ALWAYS_SUPPORTED` plus everything stages 1 through it add. */
export const STAGE_FEATURES: ReadonlyMap<number, ReadonlySet<Feature>> = new Map(STAGE_ADDS.map((_, index) => [index + 1, new Set([...ALWAYS_SUPPORTED, ...STAGE_ADDS.slice(0, index + 1).flat()])]));

/** The features this stage's runtime can draw. Empty at stage 0, since nothing renders yet. Later stages add to it. */
export const SUPPORTED: ReadonlySet<Feature> = new Set();

/**
 * Finds every feature a skeleton uses.
 *
 * A feature counts when the skeleton contains it anywhere: an attachment kind used by any skin, a constraint list that is non-empty, a
 * timeline type used by any animation, a slot's dark color or blend mode, or a bone's transform mode.
 *
 * @param data The parsed skeleton.
 * @returns Every feature the skeleton uses.
 */
export function featuresOf(data: SkeletonData): Set<Feature> {
	const features = new Set<Feature>();

	for (const bone of data.bones) {
		if (bone.transformMode !== "normal") {
			features.add("transformModeNonNormal");
		}
	}

	for (const slot of data.slots) {
		if (slot.darkColor !== null) {
			features.add("twoColor");
		}
		if (slot.blendMode === "additive") {
			features.add("blendAdditive");
		} else if (slot.blendMode === "multiply") {
			features.add("blendMultiply");
		} else if (slot.blendMode === "screen") {
			features.add("blendScreen");
		}
	}

	if (data.ik.length > 0) {
		features.add("ik");
	}
	if (data.transform.length > 0) {
		features.add("transformConstraint");
	}
	if (data.path.length > 0) {
		features.add("pathConstraint");
	}
	if (data.events.length > 0) {
		features.add("events");
	}

	for (const skin of data.skins) {
		for (const attachments of skin.attachments.values()) {
			for (const attachment of attachments.values()) {
				switch (attachment.type) {
					case "region":
						features.add("region");
						break;
					case "mesh":
						features.add(attachment.vertices.weighted ? "weightedMesh" : "mesh");
						break;
					case "linkedmesh":
						features.add("linkedMesh");
						break;
					case "path":
						features.add("path");
						break;
					case "point":
						features.add("point");
						break;
					case "boundingbox":
						features.add("boundingBox");
						break;
					case "clipping":
						features.add("clipping");
						break;
				}
			}
		}
	}

	for (const animation of data.animations) {
		for (const timeline of animation.timelines) {
			switch (timeline.type) {
				case "deform":
					features.add("deform");
					break;
				case "drawOrder":
					features.add("drawOrder");
					break;
				case "twoColor":
					features.add("twoColor");
					break;
				case "event":
					features.add("events");
					break;
			}
		}
	}

	return features;
}

/**
 * Checks whether every feature a skeleton uses is in `SUPPORTED`.
 *
 * @param data The parsed skeleton.
 * @returns True if the current stage's runtime can draw this skeleton in full.
 */
export function isSupported(data: SkeletonData): boolean {
	for (const feature of featuresOf(data)) {
		if (!SUPPORTED.has(feature)) {
			return false;
		}
	}
	return true;
}
