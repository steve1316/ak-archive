// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Talent candidate selection

/**
 * Picking which version of a talent to show.
 *
 * 508 talents carry more than one candidate, which are the same talent gated by elite phase, level and potential. The page moves all three, so
 * the right candidate is the best one currently unlocked rather than the first in the list.
 */

import type { Talent, TalentCandidate } from "../types/operator.js";

/**
 * A number in a talent description, or a parenthesised delta. The delta is upstream's own mark for what potential adds, such as `(+2%)` in
 * `ATK +7% (+2%)`, so it is captured separately and never lined up against the base candidate.
 */
const VALUE_TOKEN = /\(([+-]?\d+(?:\.\d+)?%?)\)|[+-]?\d+(?:\.\d+)?%?/g;

/**
 * Whether a candidate is unlocked at a phase and level.
 *
 * @param candidate The candidate.
 * @param phase The 0-based elite phase on screen.
 * @param level The level on screen.
 * @returns True when the phase and level meet the candidate's unlock condition.
 */
function isUnlocked(candidate: TalentCandidate, phase: number, level: number): boolean {
	if (phase > candidate.unlockPhase) {
		return true;
	}
	return phase === candidate.unlockPhase && level >= candidate.unlockLevel;
}

/**
 * Whether one candidate outranks another as the version to show.
 *
 * Candidates form a grid over two independent axes: the phase and level that unlock them, and the potential rank they need. Lava's talent has
 * four - level 1 and level 55, each at potential 1 and potential 5 - so ranking on potential alone ties the two level-1 variants against the two
 * level-55 ones and picks whichever came first. That is wrong for 398 of the 558 talents in the data.
 *
 * Upstream happens to list candidates in ascending order today, so taking the last unlocked one would agree on all 60264 phase/level/potential
 * combinations in the current dataset. Comparing the keys explicitly does not depend on an ordering upstream never promises.
 *
 * @param candidate The candidate being considered.
 * @param best The best candidate found so far.
 * @returns True when `candidate` should replace `best`.
 */
function outranks(candidate: TalentCandidate, best: TalentCandidate): boolean {
	if (candidate.unlockPhase !== best.unlockPhase) {
		return candidate.unlockPhase > best.unlockPhase;
	}
	if (candidate.unlockLevel !== best.unlockLevel) {
		return candidate.unlockLevel > best.unlockLevel;
	}
	return candidate.requiredPotential > best.requiredPotential;
}

/**
 * The version of a talent to show at the current phase, level and potential.
 *
 * The winner is the unlocked candidate furthest along both axes - unlock phase and level, then potential - rather than the highest potential
 * alone, since two candidates can tie on potential while differing on unlock level. A talent whose every candidate is still locked returns null,
 * which the panel renders greyed with its unlock condition rather than hiding.
 *
 * @param talent The talent.
 * @param phase The 0-based elite phase on screen.
 * @param level The level on screen.
 * @param potential The 1-based potential rank on screen.
 * @returns The candidate to show, or null when none is unlocked yet.
 */
export function candidateFor(talent: Talent, phase: number, level: number, potential: number): TalentCandidate | null {
	let best: TalentCandidate | null = null;
	for (const candidate of talent.candidates) {
		if (candidate.requiredPotential > potential || !isUnlocked(candidate, phase, level)) {
			continue;
		}
		if (!best || outranks(candidate, best)) {
			best = candidate;
		}
	}
	return best;
}

/**
 * The first candidate of a talent, used to name and describe it while it is still locked.
 *
 * @param talent The talent.
 * @returns The lowest-potential candidate, or null when the talent has none.
 */
export function baseCandidate(talent: Talent): TalentCandidate | null {
	return talent.candidates.reduce<TalentCandidate | null>((lowest, candidate) => (!lowest || candidate.requiredPotential < lowest.requiredPotential ? candidate : lowest), null);
}

/** One run of a talent description: plain text, or a value that moved away from the talent's base candidate. */
export interface DescriptionSegment {
	/** The run's text. */
	text: string;
	/** Whether this run is a value the controls changed. */
	changed: boolean;
}

/**
 * Split a talent description into runs, marking the values the current controls changed.
 *
 * Bare numbers are compared in order against the base candidate's bare numbers, so `+12%` beside a base of `+5%` is marked and an unchanged
 * `+20%` is not. A parenthesised delta is always marked. With no baseline nothing is marked, since there is nothing to have changed from.
 *
 * @param description The current candidate's description.
 * @param baseline The base candidate's description, or null when the talent has none.
 * @returns The runs, in order. Joined, they reproduce `description` exactly.
 */
export function changedValueSegments(description: string, baseline: string | null): DescriptionSegment[] {
	const baseValues = baseline === null ? null : [...baseline.matchAll(VALUE_TOKEN)].filter((match) => match[1] === undefined).map((match) => match[0]);
	const segments: DescriptionSegment[] = [];
	let cursor = 0;
	let bareIndex = 0;
	for (const match of description.matchAll(VALUE_TOKEN)) {
		const start = match.index;
		if (start > cursor) {
			segments.push({ text: description.slice(cursor, start), changed: false });
		}
		let changed = false;
		if (baseValues !== null) {
			if (match[1] !== undefined) {
				changed = true;
			} else {
				changed = match[0] !== baseValues[bareIndex];
				bareIndex += 1;
			}
		}
		segments.push({ text: match[0], changed });
		cursor = start + match[0].length;
	}
	if (cursor < description.length) {
		segments.push({ text: description.slice(cursor), changed: false });
	}
	return segments;
}
