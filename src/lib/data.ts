// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// The data layer

/**
 * The single place the app reads operator data.
 *
 * Shards are fetched on demand so a route pays only for what it renders, and the navbar reads the small search index rather than any shard.
 * The large files ship as plain JSON assets read with `fetch` rather than as dynamic imports, because a browser remembers a failed dynamic
 * import for the rest of the session and it could never be retried without a reload.
 */

import { createDataStore, shardFor } from "archive-kit";
import type { Shard } from "archive-kit";

import searchIndexJson from "../data/search-index.json";
import upstreamJson from "../data/upstream.json";
import type { Enemy, EnemyDetails, EnemySearchEntry } from "../types/enemy.js";
import type { Operator, OperatorDetails, Profile, SearchEntry, UpstreamInfo } from "../types/operator.js";

/**
 * Hosted URLs of the generated shards, keyed by bare file name.
 *
 * The glob has to live in the app rather than in the kit: a Vite macro written inside an installed package globs the package's own folder.
 * `eager` is on so only the URL strings are bundled, which is a few bytes each, not the files themselves.
 */
const DATA_URLS = Object.fromEntries(
	Object.entries(
		import.meta.glob<string>(
			["../data/operators-*.json", "../data/profiles-*.json", "../data/details-*.json", "../data/enemies.json", "../data/enemy-details-*.json", "../data/enemy-search-index.json"],
			{ query: "?url", import: "default", eager: true }
		)
	).map(([path, url]) => [path.replace(/^.*\/|\.json$/g, ""), url])
);

/**
 * The generated shards, in the same order and over the same files as `tools/data/lib/shards.mjs`.
 *
 * The two tables key on different fields, which is the easy thing to get wrong. The importer keys on the raw upstream `profession` - `WARRIOR`,
 * `TANK`, `PIONEER`, `SPECIAL` - because that is what `character_table.json` carries. The app keys on the display name instead, because
 * `search-index.json` carries that and the search index is how a shard is found without loading all eight. The file list and the order must
 * stay identical across both tables. The key field must not.
 */
const SHARDS: ReadonlyArray<Shard<string> & { profiles: string; details: string }> = [
	{ file: "operators-guard", profiles: "profiles-guard", details: "details-guard", holds: (profession) => profession === "Guard" },
	{ file: "operators-sniper", profiles: "profiles-sniper", details: "details-sniper", holds: (profession) => profession === "Sniper" },
	{ file: "operators-caster", profiles: "profiles-caster", details: "details-caster", holds: (profession) => profession === "Caster" },
	{ file: "operators-specialist", profiles: "profiles-specialist", details: "details-specialist", holds: (profession) => profession === "Specialist" },
	{ file: "operators-supporter", profiles: "profiles-supporter", details: "details-supporter", holds: (profession) => profession === "Supporter" },
	{ file: "operators-defender", profiles: "profiles-defender", details: "details-defender", holds: (profession) => profession === "Defender" },
	{ file: "operators-vanguard", profiles: "profiles-vanguard", details: "details-vanguard", holds: (profession) => profession === "Vanguard" },
	{ file: "operators-medic", profiles: "profiles-medic", details: "details-medic", holds: (profession) => profession === "Medic" }
];

/** The store owns fetching and the cache that drops a failed load so a retry actually retries. */
const store = createDataStore({ urls: DATA_URLS });

/** Every operator's id, name, rarity and class. The navbar reads this and never a shard. */
export const searchIndex: SearchEntry[] = searchIndexJson as SearchEntry[];

/** Where the data came from and what it is pinned to. A plain JSON import of a few hundred bytes, so reading it costs a page nothing. */
export const upstream: UpstreamInfo = upstreamJson as UpstreamInfo;

/** Class name by operator id, so a shard can be found without loading all eight. */
const professionById = new Map(searchIndex.map((entry) => [entry.id, entry.profession]));

/**
 * The shard holding one operator.
 *
 * @param id The operator id.
 * @returns The shard, or null when the id is in no shard, which means it is not an operator.
 */
function shardOf(id: string): (Shard<string> & { profiles: string; details: string }) | null {
	const profession = professionById.get(id);
	if (!profession) {
		return null;
	}
	return shardFor(SHARDS, profession) as (Shard<string> & { profiles: string; details: string }) | null;
}

/**
 * Load every operator in one class shard.
 *
 * @param file The shard's file name.
 * @returns The shard's operators.
 */
function loadShard(file: string): Promise<Operator[]> {
	return store.loadFile<Operator[]>(file);
}

/**
 * Load one operator, fetching only the shard that holds it.
 *
 * @param id The operator id.
 * @returns The operator, or undefined when no operator has that id.
 */
export async function loadOperator(id: string): Promise<Operator | undefined> {
	const shard = shardOf(id);
	if (!shard) {
		return undefined;
	}
	const operators = await loadShard(shard.file);
	return operators.find((operator) => operator.id === id);
}

/**
 * Load one operator's handbook prose.
 *
 * Called by `HandbookSection` rather than by the page, so the side file is fetched only once the handbook is on screen. A missing entry is not
 * an error here: the panel shows it as a handbook with nothing in it.
 *
 * @param id The operator id.
 * @returns The profile, or undefined when the id is in no shard or has no entry in the side file.
 */
export async function loadProfile(id: string): Promise<Profile | undefined> {
	const shard = shardOf(id);
	if (!shard) {
		return undefined;
	}
	const profiles = await store.loadFile<Record<string, Profile>>(shard.profiles);
	return profiles[id];
}

/**
 * Load one operator's skills and handbook record.
 *
 * The operator page fetches this alongside `loadOperator`, so the two requests start together, unlike `loadProfile`, which waits for the
 * handbook section to scroll into view.
 *
 * @param id The operator id.
 * @returns The details, or undefined when the id is in no shard or has no entry in the details file.
 */
export async function loadOperatorDetails(id: string): Promise<OperatorDetails | undefined> {
	const shard = shardOf(id);
	if (!shard) {
		return undefined;
	}
	const details = await store.loadFile<Record<string, OperatorDetails>>(shard.details);
	return details[id];
}

/**
 * Load every operator, for the index, which genuinely renders all of them.
 *
 * All eight shards come to 1122 KB raw and 116 KB gzipped, both measured from the production build at the pinned sha, now that skills and the
 * handbook record live in the details files instead. The filter axes the index needs - subclass, nation, tags - are deliberately not in the
 * search index, because that file renders on every route and must stay small.
 *
 * @returns Every operator, in shard order.
 */
export async function loadAllOperators(): Promise<Operator[]> {
	const shards = await Promise.all(SHARDS.map((shard) => loadShard(shard.file)));
	return shards.flat();
}

/**
 * Load every enemy group, for the index. One 307 KB file, 38 KB gzipped, which the enemy page also reads to find a variant's group.
 *
 * @returns Every enemy group, in handbook order.
 */
export function loadAllEnemies(): Promise<Enemy[]> {
	return store.loadFile<Enemy[]>("enemies");
}

/**
 * Load the group holding one enemy variant, with every variant's details.
 *
 * The details are split into one file per level, named from the group head's level, so this finds the group first and then fetches only that
 * group's file.
 *
 * @param id Any variant's upstream id, head or not.
 * @returns The group and its variants' details by id, or undefined when no group holds that id.
 */
export async function loadEnemyGroup(id: string): Promise<{ enemy: Enemy; details: Record<string, EnemyDetails> } | undefined> {
	const enemies = await loadAllEnemies();
	const enemy = enemies.find((entry) => entry.variants.some((variant) => variant.id === id));
	if (!enemy) {
		return undefined;
	}
	const details = await store.loadFile<Record<string, EnemyDetails>>(`enemy-details-${enemy.level.toLowerCase()}`);
	return { enemy, details };
}

/**
 * Load the navbar's enemy search entries. Kept out of the bundle, since at 101 KB it is three times the operator index, and fetched after the
 * first paint instead.
 *
 * @returns One entry per enemy variant.
 */
export function loadEnemySearchIndex(): Promise<EnemySearchEntry[]> {
	return store.loadFile<EnemySearchEntry[]>("enemy-search-index");
}
