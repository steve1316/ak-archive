/**
 * The slice of `assets-manifest.json` the site reads in the browser, built at bundle time by the `virtual:asset-presence` plugin in
 * `vite.config.ts`.
 *
 * The full manifest is about 126 KB and was bundled into the startup script. The browser only asks whether one asset exists, so presence becomes
 * short lists of what is missing, and the sections only the pipeline reads (`skins`, `skillIcons`) are dropped. The lists are taken against the
 * ids the data names, so an id the manifest never mentions counts as missing and its page falls back to a placeholder, as it always did.
 */

/**
 * The ids a presence map does not mark as published, sorted.
 *
 * @param {string[]} ids Every id the data names for this kind.
 * @param {Record<string, boolean> | undefined} flags The manifest section mapping an id to whether its asset exists.
 * @returns {string[]} The ids whose flag is not true.
 */
function missingIds(ids, flags) {
	return ids.filter((id) => flags?.[id] !== true).sort();
}

/**
 * Reduce the asset manifest to what the browser reads.
 *
 * @param {Record<string, any>} manifest The parsed `assets-manifest.json`.
 * @param {{operators: string[], enemies: string[]}} ids Every operator id and enemy variant id the data names.
 * @returns {import("./presence.d.mts").AssetPresence} The slim presence data.
 */
export function slimManifest(manifest, { operators, enemies }) {
	return {
		available: true,
		missing: {
			portraits: missingIds(operators, manifest.portraits),
			illustrations: missingIds(operators, manifest.illustrations),
			enemies: missingIds(enemies, manifest.enemies)
		},
		variants: manifest.variants ?? {},
		moduleArt: manifest.moduleArt ?? [],
		moduleTypes: manifest.moduleTypes ?? []
	};
}

/** What the site sees when no manifest has been built: nothing counts as published, the way a missing manifest always behaved. */
export const EMPTY_PRESENCE = { ...slimManifest({}, { operators: [], enemies: [] }), available: false };
