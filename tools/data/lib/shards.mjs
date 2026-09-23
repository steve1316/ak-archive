/**
 * Operator data shards, by class.
 *
 * GFL shards by numeric id range. Arknights ids are strings such as `char_002_amiya`, and class is the index's main filter axis anyway, so the
 * split is by class instead. Each class has four files: `file` holds the records the index reads, `profiles` holds the same operators'
 * handbook prose (lore only), `details` holds their skills, modules and handbook record, and `moduleLore` holds each module's story text - the
 * operator page loads `file` and `details` together, `profiles` only once the handbook section scrolls into view, and `moduleLore` only when
 * the Modules tab opens. `src/lib/data.ts` must list the same files in the same order.
 *
 * Measured at the pinned commit the classes are uneven - WARRIOR 83 down to MEDIC 38 - so these are not the even ~50 shards first planned. The
 * largest is still about 1 MB, which is the size that matters.
 */
export const SHARDS = [
	{ key: "WARRIOR", file: "operators-guard", profiles: "profiles-guard", details: "details-guard", moduleLore: "module-lore-guard" },
	{ key: "SNIPER", file: "operators-sniper", profiles: "profiles-sniper", details: "details-sniper", moduleLore: "module-lore-sniper" },
	{ key: "CASTER", file: "operators-caster", profiles: "profiles-caster", details: "details-caster", moduleLore: "module-lore-caster" },
	{ key: "SPECIAL", file: "operators-specialist", profiles: "profiles-specialist", details: "details-specialist", moduleLore: "module-lore-specialist" },
	{ key: "SUPPORT", file: "operators-supporter", profiles: "profiles-supporter", details: "details-supporter", moduleLore: "module-lore-supporter" },
	{ key: "TANK", file: "operators-defender", profiles: "profiles-defender", details: "details-defender", moduleLore: "module-lore-defender" },
	{ key: "PIONEER", file: "operators-vanguard", profiles: "profiles-vanguard", details: "details-vanguard", moduleLore: "module-lore-vanguard" },
	{ key: "MEDIC", file: "operators-medic", profiles: "profiles-medic", details: "details-medic", moduleLore: "module-lore-medic" }
];

/**
 * The shard an operator belongs to.
 *
 * @param {string} profession The operator's raw `profession` value.
 * @returns {{key: string, file: string, profiles: string, details: string, moduleLore: string}} The shard.
 * @throws When the class is not one of the eight, which means upstream added one and the table needs updating.
 */
export function shardFor(profession) {
	const shard = SHARDS.find((entry) => entry.key === profession);
	if (!shard) {
		throw new Error(`no shard for class ${profession} - upstream added a class, so tools/data/lib/shards.mjs needs a new entry`);
	}
	return shard;
}
