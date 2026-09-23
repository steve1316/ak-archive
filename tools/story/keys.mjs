/**
 * Story asset keys: the published name of a sprite, and the list of every asset the parsed stories reference.
 *
 * Upstream sprite names carry `#` (face) and `$` (outfit variant), both of which break a URL, so the published name swaps them for `-`.
 * Upstream names use underscores, never dashes, so the swap cannot make two sprites collide. The reference list keeps the raw upstream names,
 * since the asset pipeline has to find each one in the mirror's listing before it can publish it.
 */

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Module constants

/** The kinds of asset a story references, in the order the reference file lists them. */
export const ASSET_KINDS = ["backgrounds", "images", "items", "sprites", "music", "sounds"];

/**
 * Which argument of which command names which kind of asset. `split` breaks one argument into several names, and `when` limits a rule to
 * the commands it applies to, such as an `avgdisplay` that shows a background rather than an effect.
 */
const ASSET_ARGS = [
	{ command: "background", arg: "image", kind: "backgrounds" },
	{ command: "interlude", arg: "name", kind: "backgrounds" },
	{ command: "avgdisplay", arg: "name", kind: "backgrounds", when: (args) => args.style === "bg" },
	{ command: "image", arg: "image", kind: "images" },
	{ command: "cgitem", arg: "image", kind: "images" },
	{ command: "largebg", arg: "imagegroup", kind: "images", split: "/" },
	{ command: "largebg", arg: "cggroup", kind: "images", split: "/" },
	{ command: "gridbg", arg: "imagegroup", kind: "images", split: "/" },
	{ command: "verticalbg", arg: "imagegroup", kind: "images", split: "/" },
	{ command: "imagetween", arg: "image", kind: "images" },
	{ command: "hidecgitem", arg: "image", kind: "images" },
	{ command: "blocker", arg: "image", kind: "images" },
	{ command: "showitem", arg: "image", kind: "items" },
	{ command: "character", arg: "name", kind: "sprites" },
	{ command: "character", arg: "name2", kind: "sprites" },
	{ command: "charslot", arg: "name", kind: "sprites" },
	{ command: "playmusic", arg: "intro", kind: "music" },
	{ command: "playmusic", arg: "key", kind: "music" },
	{ command: "playsound", arg: "key", kind: "sounds" }
];

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Keys and references

/**
 * The published key of a sprite.
 *
 * @param {string} name The upstream sprite name, such as `char_002_amiya_1#7` or `avg_npc_484_1#5$1`.
 * @returns {string} The name lowercased with `#` and `$` turned into `-`, such as `char_002_amiya_1-7`.
 */
export function spriteKey(name) {
	return name.toLowerCase().replace(/[#$]/g, "-");
}

/**
 * An empty reference list.
 *
 * @returns {Record<string, Set<string>>} One empty set per asset kind.
 */
export function emptyAssetRefs() {
	return Object.fromEntries(ASSET_KINDS.map((kind) => [kind, new Set()]));
}

/**
 * Add every asset one story references to the running lists.
 *
 * @param {Array<{t: string, c?: string, a?: Record<string, unknown>}>} steps The story's steps.
 * @param {Record<string, Set<string>>} refs The running lists, updated in place.
 */
export function addAssetRefs(steps, refs) {
	for (const step of steps) {
		if (step.t !== "cmd") {
			continue;
		}
		for (const rule of ASSET_ARGS) {
			if (rule.command !== step.c || (rule.when && !rule.when(step.a))) {
				continue;
			}
			const value = step.a[rule.arg];
			if (typeof value !== "string" || value === "") {
				continue;
			}
			for (const name of rule.split ? value.split(rule.split) : [value]) {
				if (name.trim()) {
					refs[rule.kind].add(name.trim());
				}
			}
		}
	}
}

/**
 * The reference lists as sorted arrays, ready to write.
 *
 * @param {Record<string, Set<string>>} refs The running lists.
 * @returns {Record<string, string[]>} Each kind's names, sorted.
 */
export function serializeAssetRefs(refs) {
	return Object.fromEntries(ASSET_KINDS.map((kind) => [kind, [...refs[kind]].sort()]));
}
