// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Enemy types

/** The shapes `tools/data/lib/enemies.mjs` writes. Variants such as Originium Slug α sit under their base enemy as one group. */

/** One variant as the index lists it, enough to name its chip and find its details. */
export interface EnemyVariantRef {
	/** Upstream id, such as `enemy_1007_slime_2`. */
	id: string;
	/** Display name, such as `Originium Slug α`. */
	name: string;
	/** The handbook index the game prints, such as `B2`. */
	index: string;
}

/** One enemy group as the index card and filters read it. Written to `enemies.json`. */
export interface Enemy {
	/** Upstream id of the group's head, the base enemy, such as `enemy_1007_slime`. */
	id: string;
	/** The head's display name. */
	name: string;
	/** The head's handbook index, such as `B1`. */
	index: string;
	/** The game's handbook order. Lower comes first. */
	sortId: number;
	/** The head's level: `Normal`, `Elite` or `Leader`. Also picks the details file the group's variants live in. */
	level: string;
	/** Every level across the group's variants, for filtering. */
	levels: string[];
	/** Every race across the group's variants, such as `Sarkaz`. */
	races: string[];
	/** Every attack pattern across the group's variants, such as `Melee`. */
	attacks: string[];
	/** Every damage type across the group's variants, such as `Arts`. */
	damages: string[];
	/** Every movement type across the group's variants: `Ground` or `Aerial`. */
	motions: string[];
	/** The group's variants, head first. */
	variants: EnemyVariantRef[];
	/** Global release day of the group's earliest variant as `YYYY-MM-DD`, or null when no variant is dated. */
	releaseDate: string | null;
}

/** One line of the handbook's ability list. */
export interface EnemyAbilityLine {
	/** The text, markup already stripped. */
	text: string;
	/** How the game styles it: a stance heading, a plain line, or a dimmed note. */
	format: "title" | "normal" | "note";
}

/** One level's numbers. Level 1 and up only change what upstream sets for them, so the rest match level 0. */
export interface EnemyStats {
	/** Max HP. */
	maxHp: number;
	/** Attack. */
	atk: number;
	/** Defense. */
	def: number;
	/** Arts resistance, 0 to 100. */
	magicResistance: number;
	/** Seconds between attacks, after attack speed. */
	attackTime: number;
	/** Movement speed in tiles per second. */
	moveSpeed: number;
	/** Elemental damage resistance, 0 to 100. */
	epDamageResistance: number;
	/** Elemental resistance, 0 to 100. */
	epResistance: number;
	/** Weight, which decides how far a shift pushes the enemy. */
	weight: number;
	/** Life points lost when the enemy reaches the objective. */
	lifePoints: number;
	/** Attack range in tiles, or null for an enemy with no ranged attack. */
	range: number | null;
}

/** The handbook's letter grade for each graded stat, such as `A+`. */
export type EnemyGrades = Record<"maxHp" | "atk" | "def" | "magicResistance" | "attackTime" | "moveSpeed" | "epDamageResistance" | "epResistance", string>;

/** One level of a variant. */
export interface EnemyLevel {
	/** The numbers. */
	stats: EnemyStats;
	/** The handbook grades for those numbers. */
	grades: EnemyGrades;
	/** Status effects the enemy ignores at this level, such as `Stun`. */
	immunities: string[];
}

/** One variant's page content. Written to `enemy-details-<level>.json`, keyed by variant id. */
export interface EnemyDetails {
	/** This variant's level: `Normal`, `Elite` or `Leader`. */
	level: string;
	/** This variant's races. */
	races: string[];
	/** How it attacks, such as `Ranged`. */
	attack: string;
	/** What damage it deals. */
	damage: string[];
	/** `Ground` or `Aerial`. */
	motion: string;
	/** The short tactical line the game shows in battle, or null when upstream has none. */
	description: string | null;
	/** This variant's Global release day as `YYYY-MM-DD`, or null when unknown. */
	releaseDate: string | null;
	/** Where this variant first appeared on Global: an event, a main story chapter, or `Game launch`. Null when it has no release date. */
	debut: string | null;
	/** The handbook's lore paragraph. */
	lore: string;
	/** The handbook's ability list, in order. */
	abilities: EnemyAbilityLine[];
	/** The stat levels, level 0 first. Most enemies have one, some two or three. */
	levels: EnemyLevel[];
}

/** One navbar search entry. Written to `enemy-search-index.json`, one per variant. */
export interface EnemySearchEntry {
	/** Upstream id of the variant. */
	id: string;
	/** The variant's display name. */
	name: string;
	/** The group's head id, present only when this entry is not the head itself. */
	group?: string;
}
