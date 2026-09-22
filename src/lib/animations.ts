// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Animation list

/**
 * Turns a rig's raw animation names into the list the Animations card cycles through.
 *
 * Upstream names come in file order, which is roughly alphabetical, so a skill's End sorts before its Loop and Idle lands mid-list. This drops
 * the static `Default` poses, merges each wind-up, middle and wind-down (`X_Begin`, `X_Loop`, `X_End`) into one entry that plays the whole move,
 * and orders the rest the way a unit lives through a battle: Idle, Move, Attack, the skills in number order, dorm actions, anything else, Die,
 * then Start, which leads back into Idle when the cycle wraps. A rig with phases (`A_Idle` and `B_Idle`, or `Idle_A` and `Idle_B`) gets that
 * order once per phase.
 */

/** One entry in the card's list. */
export interface AnimationEntry {
	/** The name shown in the caption, such as `Skill_2` for a merged move or the animation's own name otherwise. */
	label: string;
	/** The animations to play in order, looping the whole run. One name for a plain animation. */
	steps: string[];
}

/** How many times a merged move plays its middle before winding down, so the looping part reads as a loop. */
const MIDDLE_REPEATS = 2;

/** Names the middle of a merged move can go by, most specific first. The bare base name is tried last. */
const MIDDLE_SUFFIXES = ["_Loop", "_Idle"];

/** A wind-up or wind-down animation, with its base name captured. */
const EDGE = /^(.*)_(Begin|End)$/i;

/**
 * The categories in battle order, each with the name words that put an animation in it. A name takes the category of its first word that has
 * one, so `Skill_1_Idle` is a skill and `Attack_Start` an attack. Anything that matches none lands in `OTHER_RANK`.
 */
const CATEGORIES: ReadonlyArray<readonly string[]> = [["idle", "relax"], ["move", "walk", "run"], ["attack", "combat"], ["skill"], ["interact", "sit", "sleep", "special"]];

/** Where a skill sorts. Its entries also sort by skill number and step. */
const SKILL_RANK = CATEGORIES.findIndex((keys) => keys.includes("skill"));

/** Where an animation that matches no category sorts: after the named ones, before Die and Start. */
const OTHER_RANK = CATEGORIES.length;

/** Where a death sorts. */
const DIE_RANK = OTHER_RANK + 1;

/** Where the deploy animation sorts: last, so wrapping round leads from it into Idle as in the game. */
const START_RANK = OTHER_RANK + 2;

/** The steps inside one skill, in the order they play. */
const SKILL_STEPS = ["begin", "start", "idle", "loop", "attack", "end"];

/**
 * Split a name into lowercase words at underscores and where letters meet digits, so `Skill2_End` gives `skill`, `2`, `end`.
 *
 * @param name The animation name.
 * @returns The words.
 */
function words(name: string): string[] {
	return name
		.split(/_|(?<=[a-z])(?=\d)/i)
		.filter(Boolean)
		.map((word) => word.toLowerCase());
}

/**
 * Whether an animation is a static `Default` pose, including upstream's misspellings and phase-marked copies such as `B_Default`.
 *
 * @param name The animation name.
 * @returns True for a default pose.
 */
function isDefault(name: string): boolean {
	return words(name).some((word) => word === "default" || word === "defualt" || word === "defaulet");
}

/**
 * Where an animation sorts among the categories: the category of its first word that has one.
 *
 * @param nameWords The animation's words.
 * @returns The category's rank.
 */
function categoryRank(nameWords: string[]): number {
	for (const word of nameWords) {
		if (word === "die" || word === "dead" || word === "death") {
			return DIE_RANK;
		}
		if (word === "start") {
			return START_RANK;
		}
		const rank = CATEGORIES.findIndex((keys) => keys.some((key) => word.includes(key)));
		if (rank !== -1) {
			return rank;
		}
	}
	return OTHER_RANK;
}

/**
 * The phase an animation belongs to: a lone letter at either end of its name, as in `A_Idle` or `Idle_B`, or empty for none.
 *
 * @param nameWords The animation's words.
 * @returns The phase letter, or an empty string.
 */
function phaseOf(nameWords: string[]): string {
	const first = nameWords[0] ?? "";
	const last = nameWords[nameWords.length - 1] ?? "";
	if (nameWords.length > 1 && /^[a-z]$/.test(first)) {
		return first;
	}
	return nameWords.length > 1 && /^[a-z]$/.test(last) ? last : "";
}

/**
 * The sort key for one entry: phase, category, a number, the skill step, then the entry's original position as a tie-break. The number is the
 * skill number for a skill and the variant number, such as the `2` in `Idle_2`, for anything else.
 *
 * @param label The entry's label.
 * @param position The entry's position before sorting.
 * @param firstPhase The rig's first phase, which an entry with no phase of its own joins.
 * @returns The key, compared element by element.
 */
function sortKey(label: string, position: number, firstPhase: string): [string, number, number, number, number] {
	const nameWords = words(label);
	const phase = phaseOf(nameWords) || firstPhase;
	const rank = categoryRank(nameWords);
	const numbers = nameWords.filter((word) => /^\d+$/.test(word)).map(Number);
	if (rank !== SKILL_RANK) {
		return [phase, rank, numbers[numbers.length - 1] ?? 0, 0, position];
	}
	const afterSkill = nameWords.slice(nameWords.findIndex((word) => word.includes("skill")) + 1).filter((word) => !/^\d+$/.test(word));
	const step = afterSkill.length > 0 ? Math.max(0, SKILL_STEPS.indexOf(afterSkill[afterSkill.length - 1] ?? "")) : 0;
	return [phase, rank, numbers[0] ?? 0, step, position];
}

/**
 * Compare two sort keys element by element.
 *
 * @param a The first key.
 * @param b The second key.
 * @returns Negative when `a` sorts first, positive when `b` does, 0 when they tie.
 */
function compareKeys(a: readonly (string | number)[], b: readonly (string | number)[]): number {
	for (let i = 0; i < a.length; i++) {
		const [x, y] = [a[i] ?? 0, b[i] ?? 0];
		if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return 0;
}

/**
 * Merge each wind-up, middle and wind-down into one entry. A group needs at least two of the three to merge, so a lone `X_Begin` stays as it is.
 *
 * @param names The animation names, defaults already dropped.
 * @returns The entries, in the order their first animation appeared.
 */
function mergeMoves(names: string[]): AnimationEntry[] {
	const present = new Set(names);
	const byBase = new Map<string, { begin?: string; end?: string }>();
	for (const name of names) {
		const match = EDGE.exec(name);
		if (match?.[1] && match[2]) {
			const edges = byBase.get(match[1]) ?? {};
			edges[match[2].toLowerCase() === "begin" ? "begin" : "end"] = name;
			byBase.set(match[1], edges);
		}
	}
	const merged = new Map<string, AnimationEntry>();
	for (const [base, { begin, end }] of byBase) {
		const middle = [...MIDDLE_SUFFIXES.map((suffix) => `${base}${suffix}`), base].find((name) => present.has(name));
		const parts = [begin, middle, end].filter((part): part is string => part !== undefined);
		if (parts.length < 2) {
			continue;
		}
		const entry = { label: base, steps: [...(begin ? [begin] : []), ...(middle ? Array<string>(MIDDLE_REPEATS).fill(middle) : []), ...(end ? [end] : [])] };
		for (const part of parts) {
			merged.set(part, entry);
		}
	}
	const entries: AnimationEntry[] = [];
	const added = new Set<AnimationEntry>();
	for (const name of names) {
		const entry = merged.get(name) ?? { label: name, steps: [name] };
		if (!added.has(entry)) {
			added.add(entry);
			entries.push(entry);
		}
	}
	return entries;
}

/**
 * Build the card's list from a rig's animation names.
 *
 * @param anims The rig's animation names, in file order.
 * @returns The entries, ordered, with Idle (or Relax on a dorm rig) first whenever the rig has one.
 */
export function animationEntries(anims: readonly string[]): AnimationEntry[] {
	const kept = anims.filter((name) => !isDefault(name));
	const entries = mergeMoves(kept.length > 0 ? kept : [...anims]);
	// An unphased entry joins the first phase, so a lone `Skill_Begin` sits with `Idle_A` rather than ahead of every phase.
	const firstPhase =
		entries
			.map((entry) => phaseOf(words(entry.label)))
			.filter(Boolean)
			.sort()[0] ?? "";
	return entries
		.map((entry, position) => ({ entry, key: sortKey(entry.label, position, firstPhase) }))
		.sort((a, b) => compareKeys(a.key, b.key))
		.map(({ entry }) => entry);
}
