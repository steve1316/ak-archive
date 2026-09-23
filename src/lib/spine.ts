// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Spine rig URLs and index

/**
 * URL and index helpers for Spine rigs. In dev, rig files come through the `vite.config.ts` middleware that serves
 * `tools/assets/.staging/assets/spine/` under `__spine/`. In production they come from the asset host.
 */

import { createDataStore } from "archive-kit";
import rigIndexUrls from "virtual:rig-index-urls";

import { RIG_BUCKET_COUNT, rigBucket } from "../../tools/data/lib/rigBuckets.mjs";

import type { EnemySpineIndex, SpineEntry, SpineIndex } from "../types/spine.js";
import type { RigUrls } from "../spine/player.js";
import { assets } from "./assets.js";

export type { RigUrls } from "../spine/player.js";

/** The dev-only root the staging middleware serves rigs from, honouring whatever base the site is configured with. */
export const SPINE_DEV_ROOT = `${import.meta.env.BASE_URL}__spine/`;

/** The dev-only root the staging middleware serves enemy rigs from. */
export const ENEMY_SPINE_DEV_ROOT = `${import.meta.env.BASE_URL}__spine-enemies/`;

/**
 * The store owns fetching an index bucket and the cache that shares one request and drops a failed load so a retry actually retries. The build
 * splits each rig index into buckets of about 60 KB, so a page fetches only the one its operator or enemy is in.
 */
const store = createDataStore({ urls: rigIndexUrls });

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
 * The operator rig index bucket that holds an operator.
 *
 * @param operatorId The upstream operator id.
 * @returns The bucket's file name, for `loadSpineIndexFile`.
 */
export function spineIndexFile(operatorId: string): string {
	return `spine-index-${rigBucket(operatorId)}`;
}

/**
 * The enemy rig index bucket that holds an enemy. Every variant of a group shares its head's bucket.
 *
 * @param enemyId The upstream enemy variant id.
 * @returns The bucket's file name, for `loadEnemySpineIndexFile`.
 */
export function enemySpineIndexFile(enemyId: string): string {
	return `enemy-spine-index-${rigBucket(enemyId)}`;
}

/**
 * Fetches one operator rig index bucket once and caches it for every later call. Stable, since the stage's effect takes the loader as a dependency.
 *
 * @param file The bucket, from `spineIndexFile`.
 * @returns The part of the index that bucket holds.
 */
export function loadSpineIndexFile(file: string): Promise<SpineIndex> {
	return store.loadFile<SpineIndex>(file);
}

/**
 * Fetches one enemy rig index bucket once and caches it for every later call. Stable, for the same reason as `loadSpineIndexFile`.
 *
 * @param file The bucket, from `enemySpineIndexFile`.
 * @returns The part of the index that bucket holds.
 */
export function loadEnemySpineIndexFile(file: string): Promise<EnemySpineIndex> {
	return store.loadFile<EnemySpineIndex>(file);
}

/**
 * Fetches every operator rig index bucket and joins them into the whole index. Only the dev-only Spine lab needs it.
 *
 * @returns The whole index.
 */
export async function loadSpineIndex(): Promise<SpineIndex> {
	const buckets = await Promise.all(Array.from({ length: RIG_BUCKET_COUNT }, (_, bucket) => loadSpineIndexFile(`spine-index-${bucket}`)));
	return Object.assign({}, ...buckets) as SpineIndex;
}
