// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Spine rig URLs and index

/**
 * URL and index helpers for Spine rigs. In dev, rig files come through the `vite.config.ts` middleware that serves
 * `tools/assets/.staging/assets/spine/` under `__spine/`. In production they come from the asset host.
 */

import type { SpineEntry, SpineIndex } from "../types/spine.js";
import type { RigUrls } from "../spine/player.js";
import { assets } from "./assets.js";

export type { RigUrls } from "../spine/player.js";

/** The dev-only root the staging middleware serves rigs from, honouring whatever base the site is configured with. */
export const SPINE_DEV_ROOT = `${import.meta.env.BASE_URL}__spine/`;

/**
 * URL of the generated Spine rig index, resolved through Vite's asset-URL glob rather than a plain JSON import. The file is 500 KB, so it is
 * fetched at runtime by the pages that need it instead of bundled into them.
 */
const SPINE_INDEX_URL = Object.values(import.meta.glob<string>("../data/spine-index.json", { query: "?url", import: "default", eager: true }))[0] ?? "";

/** Matches a page form key for an operator's default outfit: a plain elite number, with or without the `plus` suffix. */
const BASE_FORM_PATTERN = /^\d+(plus)?$/i;

/** The index key of an operator's default outfit. */
const BASE_FORM_KEY = "base";

/** The index fetch, shared by every caller. Cleared on failure so a later call can try again. */
let spineIndexPromise: Promise<SpineIndex> | null = null;

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
 * Fetches the Spine rig index once and caches it for every later call.
 *
 * @returns The index.
 */
export function loadSpineIndex(): Promise<SpineIndex> {
	spineIndexPromise ??= fetch(SPINE_INDEX_URL)
		.then((response) => {
			if (!response.ok) {
				throw new Error(`Fetching the rig index gave ${response.status}`);
			}
			return response.json() as Promise<SpineIndex>;
		})
		.catch((error: unknown) => {
			spineIndexPromise = null;
			throw error;
		});
	return spineIndexPromise;
}
