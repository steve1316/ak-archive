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
import type { Operator, Profile, SearchEntry } from "../types/operator.js";

/**
 * Hosted URLs of the generated shards, keyed by bare file name.
 *
 * The glob has to live in the app rather than in the kit: a Vite macro written inside an installed package globs the package's own folder.
 * `eager` is on so only the URL strings are bundled, which is a few bytes each, not the files themselves.
 */
const DATA_URLS = Object.fromEntries(
	Object.entries(import.meta.glob<string>(["../data/operators-*.json", "../data/profiles-*.json"], { query: "?url", import: "default", eager: true })).map(([path, url]) => [
		path.replace(/^.*\/|\.json$/g, ""),
		url
	])
);

/**
 * The generated shards, in the same order and over the same files as `tools/data/lib/shards.mjs`.
 *
 * The two tables key on different fields, which is the easy thing to get wrong. The importer keys on the raw upstream `profession` - `WARRIOR`,
 * `TANK`, `PIONEER`, `SPECIAL` - because that is what `character_table.json` carries. The app keys on the display name instead, because
 * `search-index.json` carries that and the search index is how a shard is found without loading all eight. The file list and the order must
 * stay identical across both tables. The key field must not.
 */
const SHARDS: ReadonlyArray<Shard<string> & { profiles: string }> = [
	{ file: "operators-guard", profiles: "profiles-guard", holds: (profession) => profession === "Guard" },
	{ file: "operators-sniper", profiles: "profiles-sniper", holds: (profession) => profession === "Sniper" },
	{ file: "operators-caster", profiles: "profiles-caster", holds: (profession) => profession === "Caster" },
	{ file: "operators-specialist", profiles: "profiles-specialist", holds: (profession) => profession === "Specialist" },
	{ file: "operators-supporter", profiles: "profiles-supporter", holds: (profession) => profession === "Supporter" },
	{ file: "operators-defender", profiles: "profiles-defender", holds: (profession) => profession === "Defender" },
	{ file: "operators-vanguard", profiles: "profiles-vanguard", holds: (profession) => profession === "Vanguard" },
	{ file: "operators-medic", profiles: "profiles-medic", holds: (profession) => profession === "Medic" }
];

/** The store owns fetching and the cache that drops a failed load so a retry actually retries. */
const store = createDataStore({ urls: DATA_URLS });

/** Every operator's id, name, rarity and class. The navbar reads this and never a shard. */
export const searchIndex: SearchEntry[] = searchIndexJson as SearchEntry[];

/** Class name by operator id, so a shard can be found without loading all eight. */
const professionById = new Map(searchIndex.map((entry) => [entry.id, entry.profession]));

/**
 * The shard holding one operator.
 *
 * @param id The operator id.
 * @returns The shard, or null when the id is in no shard, which means it is not an operator.
 */
function shardOf(id: string): (Shard<string> & { profiles: string }) | null {
	const profession = professionById.get(id);
	if (!profession) {
		return null;
	}
	return (shardFor(SHARDS, profession) as (Shard<string> & { profiles: string }) | null) ?? null;
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
 * Load one operator's handbook text and base skills.
 *
 * @param id The operator id.
 * @returns The profile, or undefined when no operator has that id.
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
 * Load one operator together with its profile, for the operator page.
 *
 * The shard and the side file are fetched in parallel. Both are cached, so a later call reuses whichever the index already pulled.
 *
 * @param id The operator id.
 * @returns The operator and its profile, or undefined when no operator has that id.
 */
export async function loadOperatorWithProfile(id: string): Promise<{ operator: Operator; profile: Profile } | undefined> {
	const shard = shardOf(id);
	if (!shard) {
		return undefined;
	}
	const [operators, profiles] = await Promise.all([loadShard(shard.file), store.loadFile<Record<string, Profile>>(shard.profiles)]);
	const operator = operators.find((entry) => entry.id === id);
	const profile = profiles[id];
	if (!operator || !profile) {
		return undefined;
	}
	return { operator, profile };
}

/**
 * Load every operator, for the index, which genuinely renders all of them.
 *
 * All eight shards come to about 508 KB. The filter axes the index needs - subclass, nation, tags - are deliberately not in the search index,
 * because that file renders on every route and must stay small.
 *
 * @returns Every operator, in shard order.
 */
export async function loadAllOperators(): Promise<Operator[]> {
	const shards = await Promise.all(SHARDS.map((shard) => loadShard(shard.file)));
	return shards.flat();
}
