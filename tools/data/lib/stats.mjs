/**
 * Turning the game's sparse stat keyframes into the numbers a page can print.
 *
 * Each phase carries exactly two keyframes, level 1 and the phase's max, so every level in between is a linear interpolation. Trust and
 * potential are separate bonuses applied on top, not part of the curve. This is the likeliest place for a silently wrong number, which is why
 * `check.mjs` asserts hand-verified totals for three operators.
 */

import { asArray } from "./json.mjs";

/** The stat fields carried through to the site, in the order a stats panel reads them. */
const FIELDS = ["maxHp", "atk", "def", "magicResistance", "cost", "blockCnt", "baseAttackTime", "respawnTime"];

/** Trust bonuses only ever touch these four. */
const TRUST_FIELDS = ["maxHp", "atk", "def", "magicResistance"];

/** Potential modifiers name their target with the game's own enum, which maps onto the fields above. */
const POTENTIAL_FIELDS = {
	MAX_HP: "maxHp",
	ATK: "atk",
	DEF: "def",
	MAGIC_RESISTANCE: "magicResistance",
	COST: "cost",
	RESPAWN_TIME: "respawnTime",
	BLOCK_CNT: "blockCnt",
	ATTACK_SPEED: null
};

/**
 * Interpolate between two keyframes.
 *
 * @param {object} lo The lower keyframe.
 * @param {object} hi The upper keyframe.
 * @param {number} level The level to read at.
 * @returns {Record<string, number>} The stats at that level.
 */
function between(lo, hi, level) {
	const span = hi.level - lo.level;
	const t = span === 0 ? 0 : (level - lo.level) / span;
	const out = {};
	for (const field of FIELDS) {
		const a = lo.data[field];
		const b = hi.data[field];
		out[field] = typeof a === "number" && typeof b === "number" ? a + (b - a) * t : a;
	}
	return out;
}

/**
 * The trust bonus at a trust percentage.
 *
 * The bonus is per-stat and irregular rather than a flat percentage - Ch'en gets nothing on HP but +50 ATK and +50 DEF, where Kal'tsit gets
 * +400 HP and no ATK. The keyframes run 0 to 50, and the last frame is the full bonus at trust 100.
 *
 * @param {object[]} frames The operator's `favorKeyFrames`.
 * @param {number} trust Trust percentage, 0 to 100.
 * @returns {Record<string, number>} The bonus for each trust-affected stat.
 */
function trustBonus(frames, trust) {
	const out = Object.fromEntries(TRUST_FIELDS.map((field) => [field, 0]));
	if (frames.length === 0) {
		return out;
	}
	const lo = frames[0];
	const hi = frames[frames.length - 1];
	const target = (Math.min(Math.max(trust, 0), 100) / 100) * hi.level;
	const span = hi.level - lo.level;
	const t = span === 0 ? 0 : (target - lo.level) / span;
	for (const field of TRUST_FIELDS) {
		out[field] = lo.data[field] + (hi.data[field] - lo.data[field]) * t;
	}
	return out;
}

/**
 * Stats for one operator at a phase, level, trust and potential.
 *
 * @param {object} operator The operator's `character_table` row.
 * @param {number} phase Which elite phase, 0 based.
 * @param {number} level The level within that phase.
 * @param {{trust?: number, potential?: number}} [options] Trust percentage and potential rank, both at their maximum-useful default.
 * @returns {Record<string, number>} The stats, rounded the way the game displays them.
 */
export function statsAt(operator, phase, level, { trust = 100, potential = 1 } = {}) {
	const frames = operator.phases[phase].attributesKeyFrames;
	const out = between(frames[0], frames[frames.length - 1], level);

	const bonus = trustBonus(asArray(operator.favorKeyFrames), trust);
	for (const field of TRUST_FIELDS) {
		out[field] += bonus[field];
	}

	// `potentialRanks` holds ranks 2 upward. A rank is either a BUFF carrying attribute modifiers or a CUSTOM one that only improves a talent
	// and carries no `buff` at all, so the modifiers are read defensively rather than assumed present.
	for (const rank of asArray(operator.potentialRanks).slice(0, Math.max(potential - 1, 0))) {
		for (const modifier of asArray(rank.buff?.attributes?.attributeModifiers)) {
			const field = POTENTIAL_FIELDS[modifier.attributeType];
			if (field) {
				out[field] += modifier.value;
			}
		}
	}

	// The game shows whole numbers for everything but the attack interval, which it shows to two decimals.
	for (const field of FIELDS) {
		out[field] = field === "baseAttackTime" ? Math.round(out[field] * 100) / 100 : Math.round(out[field]);
	}
	return out;
}

/**
 * The stats a page needs: each phase at level 1 and at its max, plus the fully trusted maximum.
 *
 * @param {object} operator The operator's `character_table` row.
 * @returns {object} Per-phase ranges and the max-level totals.
 */
export function statBlock(operator) {
	const phases = operator.phases.map((phase, index) => ({
		maxLevel: phase.maxLevel,
		min: statsAt(operator, index, 1, { trust: 0 }),
		max: statsAt(operator, index, phase.maxLevel, { trust: 0 })
	}));
	const top = operator.phases.length - 1;
	return {
		phases,
		/** What a wiki calls the operator's max stats: final phase, max level, full trust, potential 1. */
		trusted: statsAt(operator, top, operator.phases[top].maxLevel, { trust: 100, potential: 1 })
	};
}
