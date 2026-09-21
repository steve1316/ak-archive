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

/** One capability a Spine 3.8 rig can use. `region`, `mesh` etc name attachment kinds; `ik`, `transformConstraint`, `pathConstraint` name
 * constraint kinds; `deform`, `drawOrder`, `twoColor`, `blend*` name timeline or slot effects; `transformModeNonNormal` names any bone
 * transform mode other than the default; `events` names custom event firing. */
export type Feature =
	| "region"
	| "mesh"
	| "weightedMesh"
	| "linkedMesh"
	| "clipping"
	| "path"
	| "point"
	| "boundingBox"
	| "ik"
	| "transformConstraint"
	| "pathConstraint"
	| "deform"
	| "drawOrder"
	| "twoColor"
	| "blendAdditive"
	| "blendMultiply"
	| "blendScreen"
	| "transformModeNonNormal"
	| "events";

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
