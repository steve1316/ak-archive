// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Client-side stats

/**
 * Stats at an arbitrary phase, level, trust and potential.
 *
 * The importer ships two keyframes per phase and the fully trusted maximum, which is all the index needs. The operator page lets a reader move
 * the phase, level, trust and potential, so the same interpolation runs here. This mirrors `tools/data/lib/stats.mjs` - if one changes, so does
 * the other, and `check.mjs` asserts the three hand-verified fixtures that keep them honest.
 */

import type { Operator, StatValues, TrustBonus } from "../types/operator.js";

/** The stat fields, in the order a stats panel reads them. */
const FIELDS: ReadonlyArray<keyof StatValues> = ["maxHp", "atk", "def", "magicResistance", "cost", "blockCnt", "baseAttackTime", "respawnTime"];

/** The four stats trust can touch. Mirrors `TRUST_FIELDS` in `tools/data/lib/stats.mjs`, which is what fills `stats.trustBonus`. */
const TRUST_FIELDS: ReadonlyArray<keyof TrustBonus> = ["maxHp", "atk", "def", "magicResistance"];

/**
 * An operator's stats at one phase, level, trust and potential.
 *
 * @param operator The operator.
 * @param phase The 0-based elite phase.
 * @param level The level within that phase.
 * @param options Whether trust is full, and the 1-based potential rank.
 * @returns The stats, rounded the way the game displays them.
 */
export function statsAt(operator: Operator, phase: number, level: number, { trust, potential }: { trust: boolean; potential: number }): StatValues {
	// Clamp before indexing rather than falling back after it, so a negative phase lands on the first phase instead of the last one.
	const index = Math.min(Math.max(phase, 0), operator.stats.phases.length - 1);
	const frame = operator.stats.phases[index];
	if (!frame) {
		return operator.stats.trusted;
	}
	const span = frame.maxLevel - 1;
	const t = span <= 0 ? 0 : (Math.min(Math.max(level, 1), frame.maxLevel) - 1) / span;

	const out = {} as StatValues;
	for (const field of FIELDS) {
		out[field] = frame.min[field] + (frame.max[field] - frame.min[field]) * t;
	}

	// Trust only ever touches four of the eight, and the importer guarantees all four are present, so there is nothing to default here.
	if (trust) {
		for (const field of TRUST_FIELDS) {
			out[field] += operator.stats.trustBonus[field];
		}
	}

	// Potential ranks run 2 upward, so rank 1 adds nothing and rank n applies every entry up to and including n.
	for (const rank of operator.potentials.filter((entry) => entry.rank <= potential)) {
		for (const field of FIELDS) {
			out[field] += rank.modifiers[field] ?? 0;
		}
	}

	// The game shows whole numbers for everything but the attack interval, which it shows to two decimals.
	for (const field of FIELDS) {
		out[field] = field === "baseAttackTime" ? Math.round(out[field] * 100) / 100 : Math.round(out[field]);
	}
	return out;
}
