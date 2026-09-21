// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Spine index

/** Types for the generated `spine-index.json`. Rig file names are bare basenames; the directory comes from the URL builder. */

/** One skeleton and the atlas it renders with. */
export interface SpineRig {
	/** Skeleton basename, without the `.skel` extension. */
	skel: string;
	/** Atlas basename, without the `.atlas` extension. Usually equal to `skel`, but not guaranteed. */
	atlas: string;
	/**
	 * Animation names this skeleton defines.
	 *
	 * Read from the skeleton itself by `tools/assets/add_spine_animations.mjs` rather than assumed, because a rig carries whatever its
	 * artist named, and a tab that plays nothing is worse than an absent tab.
	 */
	anims: string[];
}

/** The rigs published for one form: the battle chibi in both facings, and the dorm chibi. Any of the three may be missing. */
export interface SpineForm {
	/** The battle rig facing the camera, from upstream's `<id>/Front` folder. */
	battle?: SpineRig;
	/** The battle rig facing away, from upstream's `<id>/Back` folder. */
	back?: SpineRig;
	/** The dorm rig, from upstream's `build_<id>/Spine` folder. */
	dorm?: SpineRig;
}

/** Every form published for one operator, keyed by variant key, where `base` is the default costume. */
export type SpineEntry = Record<string, SpineForm>;

/** The generated `spine-index.json`, keyed by operator id. */
export type SpineIndex = Record<string, SpineEntry>;
