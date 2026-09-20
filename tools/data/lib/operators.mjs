/**
 * Turning `character_table` rows into the records the site ships.
 *
 * Everything the game encodes as an internal enum is resolved here, so nothing below the data layer ever sees `TIER_5` or `WARRIOR`.
 */

import { asArray } from "./json.mjs";
import { POTENTIAL_FIELDS, statBlock } from "./stats.mjs";
import { isPlaceholder, resolveTemplate, stripMarkup } from "./text.mjs";

/** Rows that are not operators at all. There are 639 TRAP and 68 TOKEN rows against 410 real operators. */
const NOT_OPERATORS = new Set(["TOKEN", "TRAP"]);

/**
 * Class display names.
 *
 * Four of the eight are internal names that do not match what the game shows, which is the trap: `WARRIOR` is a Guard, not a Warrior. The other
 * four still need mapping because `SUPPORT` displays as Supporter.
 */
const PROFESSION_NAMES = {
	WARRIOR: "Guard",
	TANK: "Defender",
	PIONEER: "Vanguard",
	SPECIAL: "Specialist",
	SNIPER: "Sniper",
	MEDIC: "Medic",
	CASTER: "Caster",
	SUPPORT: "Supporter"
};

/** Deployment position, as the game words it. */
const POSITION_NAMES = { MELEE: "Melee", RANGED: "Ranged", ALL: "Melee or Ranged", NONE: "None" };

/**
 * The star count behind a `TIER_n` rarity.
 *
 * The enum is 1-based despite older dumps using 0-based integers, so `TIER_6` is a 6-star. Most guidance online is stale on this.
 *
 * @param {string} rarity The raw `rarity` value.
 * @returns {number} The star count, 1 to 6.
 * @throws When the value is not a `TIER_n`, which would mean the enum changed.
 */
export function starsOf(rarity) {
	const match = /^TIER_([1-6])$/.exec(rarity ?? "");
	if (!match) {
		throw new Error(`unexpected rarity ${rarity} - the TIER_n enum changed`);
	}
	return Number(match[1]);
}

/**
 * Every real operator, including the alternate forms that live in their own table.
 *
 * Amiya's Guard and Medic forms are not rows in `character_table` at all - they sit under `patchChars` in `char_patch_table`, with the same
 * schema - so a filter over `character_table` alone silently loses them.
 *
 * @param {object} characterTable The `character_table` contents.
 * @param {object} patchTable The `char_patch_table` contents.
 * @returns {Array<[string, object]>} Operator id and row pairs, in upstream order.
 */
export function selectOperators(characterTable, patchTable) {
	const base = Object.entries(characterTable).filter(([, row]) => !NOT_OPERATORS.has(row.profession) && row.isNotObtainable === false);
	return [...base, ...Object.entries(patchTable.patchChars ?? {})];
}

/**
 * The operator's trait, with its placeholders filled in and its markup stripped.
 *
 * The text ships as a template such as `ATK increases up to +{atk:0%}`, and the values sit in the trait candidate's own blackboard. A trait can
 * have several candidates, which are potential-gated upgrades of the same sentence, so the first is the one every operator actually has.
 *
 * @param {object} row The operator's `character_table` row.
 * @returns {string} The readable trait.
 */
function traitDescription(row) {
	const candidate = asArray(row.trait?.candidates)[0];
	const text = candidate?.overrideDescripton ?? row.description;
	return stripMarkup(resolveTemplate(text, asArray(candidate?.blackboard)));
}

/**
 * The 0-based elite phase behind a `PHASE_n` unlock condition.
 *
 * It throws rather than falling back to 0, the way `starsOf` does. A silent 0 would ship an unrecognised phase as "unlocked from E0", so the
 * page would show a talent the operator does not have yet and the gate's 0-to-2 assertion could never catch it.
 *
 * @param {string|undefined} phase The raw unlock condition's `phase`.
 * @returns {number} The phase, 0 to 2.
 * @throws When the value is not a `PHASE_n`, which would mean the enum changed.
 */
export function phaseOf(phase) {
	const match = /^PHASE_([0-2])$/.exec(phase ?? "");
	if (!match) {
		throw new Error(`unexpected phase ${phase} - the PHASE_n enum changed`);
	}
	return Number(match[1]);
}

/**
 * One operator's talents, each keeping every candidate the game can actually show.
 *
 * A talent is not one record. 508 of them carry several candidates, which are the same talent upgraded by elite phase or by potential, and
 * Amiya's first candidate is a locked placeholder - so taking `candidates[0]` would ship question marks as her talent. Every usable candidate
 * ships with its unlock condition instead, and the page picks the right one from the phase, level and potential on screen.
 *
 * Talent text on Global arrives already resolved - no candidate contains a `{placeholder}` - so `resolveTemplate` is a no-op here and is applied
 * only so a future upstream change cannot leak a raw template past the gate.
 *
 * @param {object} row The operator's `character_table` row.
 * @returns {Array<object>} The talents in the game's order, with hidden and placeholder candidates dropped.
 */
function buildTalents(row) {
	return asArray(row.talents)
		.map((talent) => ({
			// Amiya carries the only locked talent candidate at the pinned sha.
			candidates: asArray(talent.candidates)
				.filter((candidate) => candidate && !candidate.isHideTalent && !isPlaceholder(candidate.name))
				.map((candidate) => ({
					name: stripMarkup(candidate.name),
					description: stripMarkup(resolveTemplate(candidate.description, asArray(candidate.blackboard))),
					unlockPhase: phaseOf(candidate.unlockCondition?.phase),
					unlockLevel: candidate.unlockCondition?.level ?? 1,
					requiredPotential: (candidate.requiredPotentialRank ?? 0) + 1
				}))
		}))
		.filter((talent) => talent.candidates.length > 0);
}

/**
 * One operator's potential ranks, with the stat change each one makes.
 *
 * `potentialRanks` starts at rank 2, because rank 1 is the operator as recruited. A rank is either a `BUFF` carrying attribute modifiers or a
 * `CUSTOM` one that only improves a talent and carries no `buff` at all - most operators have one such rank, some have none, and alternate forms
 * have several. Every rank is kept with an empty `modifiers` for the `CUSTOM` ones, so the page can print what they do rather than showing a gap.
 *
 * @param {object} row The operator's `character_table` row.
 * @returns {Array<object>} The ranks, each carrying its 1-based rank number.
 */
function buildPotentials(row) {
	return asArray(row.potentialRanks).map((rank, index) => {
		const modifiers = {};
		for (const modifier of asArray(rank.buff?.attributes?.attributeModifiers)) {
			const field = POTENTIAL_FIELDS[modifier.attributeType];
			if (field) {
				modifiers[field] = (modifiers[field] ?? 0) + modifier.value;
			}
		}
		return { rank: index + 2, type: rank.type, description: stripMarkup(rank.description), modifiers };
	});
}

/**
 * Build one operator's record.
 *
 * @param {string} id The operator id, such as `char_002_amiya`.
 * @param {object} row The operator's `character_table` row.
 * @param {object} context Lookups: `subProfDict` from `uniequip_table` and `handbook_team_table` for faction names.
 * @returns {object} The record the site ships.
 */
export function buildOperator(id, row, { subProfDict, teams }) {
	const teamName = (key) => (key && teams[key]?.powerName) || null;
	return {
		id,
		name: row.name,
		rarity: starsOf(row.rarity),
		profession: PROFESSION_NAMES[row.profession] ?? row.profession,
		professionKey: row.profession,
		subProfession: subProfDict[row.subProfessionId]?.subProfessionName ?? row.subProfessionId,
		subProfessionKey: row.subProfessionId,
		position: POSITION_NAMES[row.position] ?? row.position,
		// One operator ships a blank string in its tag list, which would render as an empty filter chip. Drop blank tags and normalize
		// padding, so a padded duplicate never renders as a second, visually identical filter chip.
		tags: asArray(row.tagList)
			.filter((tag) => typeof tag === "string" && tag.trim())
			.map((tag) => tag.trim()),
		nation: teamName(row.nationId),
		group: teamName(row.groupId),
		team: teamName(row.teamId),
		description: traitDescription(row) || null,
		talents: buildTalents(row),
		potentials: buildPotentials(row),
		stats: statBlock(row)
	};
}
