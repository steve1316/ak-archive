// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Spine rig URLs and index

/**
 * URL and index helpers for Spine rigs. In dev, rig files come through the `vite.config.ts` middleware that serves
 * `tools/assets/.staging/assets/spine/` under `__spine/`. In production they come from the asset host.
 */

import type { EnemySpineIndex, SpineEntry, SpineIndex } from "../types/spine.js";
import type { RigUrls } from "../spine/player.js";
import { assets } from "./assets.js";

export type { RigUrls } from "../spine/player.js";

/** The dev-only root the staging middleware serves rigs from, honouring whatever base the site is configured with. */
export const SPINE_DEV_ROOT = `${import.meta.env.BASE_URL}__spine/`;

/** The dev-only root the staging middleware serves enemy rigs from. */
export const ENEMY_SPINE_DEV_ROOT = `${import.meta.env.BASE_URL}__spine-enemies/`;

/**
 * URL of the generated Spine rig index, resolved through Vite's asset-URL glob rather than a plain JSON import. The file is 500 KB, so it is
 * fetched at runtime by the pages that need it instead of bundled into them.
 */
const SPINE_INDEX_URL = Object.values(import.meta.glob<string>("../data/spine-index.json", { query: "?url", import: "default", eager: true }))[0] ?? "";

/** URL of the generated enemy rig index, fetched at runtime by the enemy page like the operator index. */
const ENEMY_SPINE_INDEX_URL = Object.values(import.meta.glob<string>("../data/enemy-spine-index.json", { query: "?url", import: "default", eager: true }))[0] ?? "";

/** Matches a page form key for an operator's default outfit: a plain elite number, with or without the `plus` suffix. */
const BASE_FORM_PATTERN = /^\d+(plus)?$/i;

/** The index key of an operator's default outfit. */
const BASE_FORM_KEY = "base";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// URL builders

/**
 * Builds the URLs for one staged rig. Matches how `spine-index.json` stores its file basenames and how the staging folder lays them out:
 * `<root><operatorId>/<formKey>/<kind>/`.
 *
 * @param root The root the rig files are served from, normally `spineRoot()`.
 * @param operatorId The upstream operator id, such as `char_172_svrash`.
 * @param formKey The form key, such as `base`.
 * @param kind The art kind: `back`, `battle` or `dorm`.
 * @param rig The index entry's skel and atlas basenames, without extension.
 * @returns The rig's skel, atlas and atlas-page-base URLs.
 */
export function spineRigUrls(root: string, operatorId: string, formKey: string, kind: string, rig: { skel: string; atlas: string }): RigUrls {
	const pageBase = `${root}${operatorId}/${formKey}/${kind}/`;
	return { skel: `${pageBase}${rig.skel}.skel`, atlas: `${pageBase}${rig.atlas}.atlas`, pageBase };
}

/**
 * The root rig files are served from: the staging middleware in dev, the asset host's `spine/` folder in production.
 *
 * @returns The root URL, with a trailing slash.
 */
export function spineRoot(): string {
	return import.meta.env.DEV ? SPINE_DEV_ROOT : assets.url("spine/");
}

/**
 * The root enemy rig files are served from: the staging middleware in dev, the asset host's `spine-enemies/` folder in production.
 *
 * @returns The root URL, with a trailing slash.
 */
export function enemySpineRoot(): string {
	return import.meta.env.DEV ? ENEMY_SPINE_DEV_ROOT : assets.url("spine-enemies/");
}

/**
 * Builds the URLs for one enemy rig, laid out as `<root><enemyId>/`.
 *
 * @param root The root the rig files are served from, normally `enemySpineRoot()`.
 * @param enemyId The enemy variant id, such as `enemy_1506_patrt`.
 * @param rig The index entry's skel and atlas basenames, without extension.
 * @returns The rig's skel, atlas and atlas-page-base URLs.
 */
export function enemyRigUrls(root: string, enemyId: string, rig: { skel: string; atlas: string }): RigUrls {
	const pageBase = `${root}${enemyId}/`;
	return { skel: `${pageBase}${rig.skel}.skel`, atlas: `${pageBase}${rig.atlas}.atlas`, pageBase };
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Index

/**
 * Maps a page form key to the operator's Spine index key. Plain elite keys such as `1`, `2` and `1plus` are the default outfit, which the
 * index calls `base`. Any other key matches an index key ignoring case.
 *
 * @param pageKey The page's form key, as `?skin=` carries it.
 * @param entry The operator's Spine index entry.
 * @returns The index key, or null when the operator has no rigs for that form.
 */
export function spineFormKey(pageKey: string, entry: SpineEntry): string | null {
	if (BASE_FORM_PATTERN.test(pageKey)) {
		return BASE_FORM_KEY in entry ? BASE_FORM_KEY : null;
	}
	const wanted = pageKey.toLowerCase();
	return Object.keys(entry).find((key) => key.toLowerCase() === wanted) ?? null;
}

/**
 * Builds a loader that fetches one index once and shares the request with every later call. A failed fetch is forgotten, so the next call
 * tries again.
 *
 * @param url The index's URL.
 * @param what What to call the index in an error.
 * @returns The loader.
 */
function cachedIndex<T>(url: string, what: string): () => Promise<T> {
	let promise: Promise<T> | null = null;
	return () => {
		promise ??= fetch(url)
			.then((response) => {
				if (!response.ok) {
					throw new Error(`Fetching the ${what} gave ${response.status}`);
				}
				return response.json() as Promise<T>;
			})
			.catch((error: unknown) => {
				promise = null;
				throw error;
			});
		return promise;
	};
}

/** Fetches the operator rig index once and caches it for every later call. */
export const loadSpineIndex = cachedIndex<SpineIndex>(SPINE_INDEX_URL, "rig index");

/** Fetches the enemy rig index once and caches it for every later call. */
export const loadEnemySpineIndex = cachedIndex<EnemySpineIndex>(ENEMY_SPINE_INDEX_URL, "enemy rig index");
