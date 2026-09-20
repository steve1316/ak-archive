/**
 * Turning `character_table` rows into the records the site ships.
 *
 * Everything the game encodes as an internal enum is resolved here, so nothing below the data layer ever sees `TIER_5` or `WARRIOR`.
 */

import { asArray } from "./json.mjs";
import { statBlock } from "./stats.mjs";
import { resolveTemplate, stripMarkup } from "./text.mjs";

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
		tags: asArray(row.tagList),
		nation: teamName(row.nationId),
		group: teamName(row.groupId),
		team: teamName(row.teamId),
		description: traitDescription(row) || null,
		stats: statBlock(row)
	};
}
