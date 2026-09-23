/**
 * The slice of `assets-manifest.json` the site reads in the browser, built at bundle time by the `virtual:asset-presence` plugin in
 * `vite.config.ts`.
 *
 * The full manifest is about 126 KB and was bundled into the startup script. The browser only asks whether one asset exists, so the near-complete
 * flag maps become short lists of what is missing, and the sections only the pipeline reads (`skins`, `skillIcons`) are dropped.
 */

/** What the site sees when no manifest has been built: nothing counts as published, the way a missing manifest always behaved. */
export const EMPTY_PRESENCE = { available: false, missing: { portraits: [], illustrations: [], enemies: [] }, variants: {}, moduleArt: [], moduleTypes: [] };

/**
 * The ids a presence map marks as not published, sorted.
 *
 * @param {Record<string, boolean> | undefined} flags A manifest section mapping an id to whether its asset exists.
 * @returns {string[]} The ids whose flag is not true.
 */
function missingIds(flags) {
	return Object.entries(flags ?? {})
		.filter(([, present]) => present !== true)
		.map(([id]) => id)
		.sort();
}

/**
 * Reduce the asset manifest to what the browser reads.
 *
 * @param {Record<string, any>} manifest The parsed `assets-manifest.json`.
 * @returns {typeof EMPTY_PRESENCE} The slim presence data, `available` true.
 */
export function slimManifest(manifest) {
	return {
		available: true,
		missing: { portraits: missingIds(manifest.portraits), illustrations: missingIds(manifest.illustrations), enemies: missingIds(manifest.enemies) },
		variants: manifest.variants ?? {},
		moduleArt: manifest.moduleArt ?? [],
		moduleTypes: manifest.moduleTypes ?? []
	};
}
