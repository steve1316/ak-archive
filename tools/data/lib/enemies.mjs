/**
 * Building enemy records from the handbook table and the enemy stat database.
 *
 * Two tables describe an enemy. `enemy_handbook_table` holds what the in-game handbook shows - the name, the handbook index such as `B1`,
 * the level, the lore and the ability list - and flags 49 rows as hidden. `levels/enemydata/enemy_database` holds the numbers, as one to
 * three `level` entries per enemy. Every field there is wrapped as `{m_defined, m_value}`, and a level after the first sets only the fields it
 * marks as defined, so each later level is read on top of level 0 rather than on its own.
 *
 * Upgraded variants carry the base id plus a number, such as `enemy_1007_slime_2` for Originium Slug α, and are grouped under their base so
 * the index shows one card per enemy. Four variants have a hidden base and head their own group.
 */

import { asArray } from "./json.mjs";
import { stripMarkup } from "./text.mjs";

/** A variant id's numbered suffix, such as the `_2` in `enemy_1007_slime_2`. */
const VARIANT_SUFFIX = /_\d+$/;

/** Display names for the level upstream calls `enemyLevel`. EN calls the top level Leader. */
const LEVELS = { NORMAL: "Normal", ELITE: "Elite", BOSS: "Leader" };

/** Display names for `applyWay`, how an enemy attacks. */
const ATTACKS = { MELEE: "Melee", RANGED: "Ranged", ALL: "Melee and Ranged", NONE: "None" };

/** Display names for `damageType`. */
const DAMAGES = { PHYSIC: "Physical", MAGIC: "Arts", HEAL: "Healing", NO_DAMAGE: "None" };

/** Display names for `motion`. */
const MOTIONS = { WALK: "Ground", FLY: "Aerial" };

/** The immunities the page lists, as upstream attribute key and display name. */
const IMMUNITIES = [
	["stunImmune", "Stun"],
	["silenceImmune", "Silence"],
	["sleepImmune", "Sleep"],
	["frozenImmune", "Freeze"],
	["levitateImmune", "Levitate"],
	["fearedImmune", "Fear"]
];

/**
 * Each graded stat, as the output field, where its value comes from and the key in `levelInfoList`. The handbook grades the attack interval
 * rather than the attack speed, so `attackTime` is graded against the table's `attackSpeed` ranges.
 */
const GRADED = [
	["maxHp", "maxHP"],
	["atk", "attack"],
	["def", "def"],
	["magicResistance", "magicRes"],
	["attackTime", "attackSpeed"],
	["moveSpeed", "moveSpeed"],
	["epDamageResistance", "enemyDamageRes"],
	["epResistance", "enemyRes"]
];

/**
 * Read one wrapped field's value.
 *
 * @param {{m_defined: boolean, m_value: unknown}|undefined} field The wrapped field.
 * @returns {unknown} The value, or undefined when the level does not define it.
 */
function defined(field) {
	return field?.m_defined ? field.m_value : undefined;
}

/**
 * Resolve every level of one enemy into plain values, each later level laid over the one before it.
 *
 * @param {Array<{level: number, enemyData: object}>} levels The enemy's entries from `enemy_database`.
 * @returns {Array<object>} One flat record per level, in level order.
 */
function resolveLevels(levels) {
	const resolved = [];
	let previous = null;
	for (const { enemyData } of [...levels].sort((a, b) => a.level - b.level)) {
		const attributes = { ...(previous?.attributes ?? {}) };
		for (const [key, field] of Object.entries(enemyData.attributes ?? {})) {
			const value = defined(field);
			if (value !== undefined) {
				attributes[key] = value;
			} else if (!(key in attributes)) {
				attributes[key] = field.m_value;
			}
		}
		const pick = (key, fallback) => {
			const value = defined(enemyData[key]);
			return value !== undefined ? value : (previous?.[key] ?? fallback);
		};
		const current = {
			attributes,
			name: pick("name", null),
			description: pick("description", null),
			applyWay: pick("applyWay", "NONE"),
			motion: pick("motion", "WALK"),
			enemyTags: asArray(pick("enemyTags", [])),
			lifePointReduce: pick("lifePointReduce", 1),
			rangeRadius: pick("rangeRadius", null)
		};
		resolved.push(current);
		previous = current;
	}
	return resolved;
}

/**
 * The grade the handbook would show for one value.
 *
 * @param {number} value The stat.
 * @param {string} key The stat's key in `levelInfoList`.
 * @param {Array<object>} grades `levelInfoList`, best grade first.
 * @returns {string|null} The grade, such as `A+`, or null when no range holds the value.
 */
function gradeOf(value, key, grades) {
	for (const grade of grades) {
		const range = grade[key];
		if (!range) {
			continue;
		}
		// A max of -1 means the range has no upper bound.
		if (value >= range.min && (range.max === -1 || value < range.max)) {
			return grade.classLevel;
		}
	}
	return null;
}

/**
 * Round away the float noise upstream leaves in values such as a 0.4 move speed.
 *
 * @param {number} value The raw number.
 * @returns {number} The number to at most 3 decimals.
 */
function tidy(value) {
	return Math.round(value * 1000) / 1000;
}

/**
 * Build one level's stats.
 *
 * @param {object} level A resolved level from `resolveLevels`.
 * @param {Array<object>} grades `levelInfoList`.
 * @returns {object} The stats, their grades and the immunities.
 */
function buildLevel(level, grades) {
	const a = level.attributes;
	// The attack interval is the base attack time scaled by attack speed, where 100 is normal speed.
	const attackTime = tidy(a.baseAttackTime / ((a.attackSpeed || 100) / 100));
	const stats = {
		maxHp: a.maxHp,
		atk: a.atk,
		def: a.def,
		magicResistance: tidy(a.magicResistance),
		attackTime,
		moveSpeed: tidy(a.moveSpeed),
		epDamageResistance: tidy(a.epDamageResistance ?? 0),
		epResistance: tidy(a.epResistance ?? 0),
		weight: a.massLevel,
		lifePoints: level.lifePointReduce,
		range: level.rangeRadius === null ? null : tidy(level.rangeRadius)
	};
	const graded = Object.fromEntries(GRADED.map(([field, key]) => [field, gradeOf(stats[field], key, grades)]));
	const immunities = IMMUNITIES.filter(([key]) => a[key] === true).map(([, name]) => name);
	return { stats, grades: graded, immunities };
}

/**
 * Read the handbook's ability list.
 *
 * @param {unknown} abilityList The row's `abilityList`, which is `{}` when the enemy has none.
 * @returns {Array<{text: string, format: string}>} Each line, with `format` one of `title`, `normal` or `note`.
 */
function buildAbilities(abilityList) {
	return asArray(abilityList)
		.map((line) => ({ text: stripMarkup(line.text), format: line.textFormat === "TITLE" ? "title" : line.textFormat === "SILENCE" ? "note" : "normal" }))
		.filter((line) => line.text !== "");
}

/**
 * Pick the enemies the handbook shows and group each variant under its base.
 *
 * @param {{enemyData: Record<string, object>}} handbook `enemy_handbook_table`.
 * @returns {Array<Array<object>>} One array of handbook rows per group, head first, then its variants in id order.
 */
export function selectEnemies(handbook) {
	const visible = Object.values(handbook.enemyData).filter((row) => !row.hideInHandbook);
	const visibleIds = new Set(visible.map((row) => row.enemyId));
	const groups = new Map();
	for (const row of visible) {
		const base = row.enemyId.replace(VARIANT_SUFFIX, "");
		const head = base !== row.enemyId && visibleIds.has(base) ? base : row.enemyId;
		if (!groups.has(head)) {
			groups.set(head, []);
		}
		groups.get(head).push(row);
	}
	const collator = new Intl.Collator(undefined, { numeric: true });
	return [...groups.entries()].map(([head, rows]) => rows.sort((a, b) => (a.enemyId === head ? -1 : b.enemyId === head ? 1 : collator.compare(a.enemyId, b.enemyId))));
}

/**
 * Build one variant: its identity, text and stats.
 *
 * @param {object} row The variant's handbook row.
 * @param {Array<{level: number, enemyData: object}>} dbLevels The variant's entries from `enemy_database`.
 * @param {Record<string, {raceName: string}>} races `raceData`, by race id.
 * @param {Array<object>} grades `levelInfoList`.
 * @returns {object} The variant.
 * @throws When the variant has no stats, which means the two tables disagree about who exists.
 */
export function buildVariant(row, dbLevels, races, grades) {
	if (!dbLevels?.length) {
		throw new Error(`${row.enemyId} is in the handbook but not in enemy_database`);
	}
	const levels = resolveLevels(dbLevels);
	const base = levels[0];
	return {
		id: row.enemyId,
		name: row.name,
		index: row.enemyIndex,
		sortId: row.sortId,
		level: LEVELS[row.enemyLevel] ?? row.enemyLevel,
		races: base.enemyTags.map((tag) => races[tag]?.raceName ?? tag),
		attack: ATTACKS[base.applyWay] ?? base.applyWay,
		damage: asArray(row.damageType).map((type) => DAMAGES[type] ?? type),
		motion: MOTIONS[base.motion] ?? base.motion,
		description: base.description ? stripMarkup(base.description) : null,
		lore: stripMarkup(row.description),
		abilities: buildAbilities(row.abilityList),
		levels: levels.map((level) => buildLevel(level, grades))
	};
}

/**
 * Split a group of built variants into the index record and the details the page loads.
 *
 * The index record's filter fields are the union over every variant, so filtering by Aerial still finds a base whose α variant flies.
 *
 * @param {Array<object>} variants The group's variants from `buildVariant`, head first.
 * @returns {{record: object, details: Record<string, object>}} The index record, and each variant's details by id.
 */
export function buildEnemyGroup(variants) {
	const head = variants[0];
	const union = (read) => [...new Set(variants.flatMap(read))];
	const record = {
		id: head.id,
		name: head.name,
		index: head.index,
		sortId: head.sortId,
		level: head.level,
		levels: union((variant) => [variant.level]),
		races: union((variant) => variant.races),
		attacks: union((variant) => [variant.attack]),
		damages: union((variant) => variant.damage),
		motions: union((variant) => [variant.motion]),
		variants: variants.map((variant) => ({ id: variant.id, name: variant.name, index: variant.index }))
	};
	const details = Object.fromEntries(variants.map(({ id, name, index, sortId, ...rest }) => [id, rest]));
	return { record, details };
}
