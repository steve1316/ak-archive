// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Asset URLs

/**
 * Every URL the app builds for the asset host.
 *
 * Paths are derived from the operator id and the kind of art rather than looked up, so nothing here needs a table. What does need a table is
 * which assets actually exist: `assets-manifest.json` is written by the A3 pipeline and records presence only. A `has*` call returns false when
 * the manifest does not record that asset, and the image then renders the kit's `ArtPlaceholder`. That is the normal path for 21 of the 412
 * operators, who have no portrait upstream and never will.
 */

import { createAssetUrls } from "archive-kit";

/**
 * The asset host, from `.env`. Never hardcode a URL anywhere else, so the host stays switchable.
 *
 * The `?? ""` is a runtime guard, not a type one. `src/vite-env.d.ts` declares the variable a `string` because `.env` is meant to carry it, but
 * a checkout whose `.env` is missing gets undefined here, and an empty base leaves every URL relative rather than writing "undefined" into it.
 */
export const assets = createAssetUrls(import.meta.env.VITE_ASSET_BASE_URL ?? "");

/** What the A3 pipeline records: which operators have canonical art, and which extra variants exist for a later phase. */
type AssetManifest = {
	/** Operator ids with a canonical portrait. Absent or false means the site renders a placeholder. */
	portraits?: Record<string, boolean>;
	/** Operator ids with a canonical illustration. */
	illustrations?: Record<string, boolean>;
	/** Variant keys per operator, for the phase that imports `skin_table.json`. Unused by the site today. */
	skins?: Record<string, string[]>;
};

/**
 * Presence of each asset kind, keyed by operator id.
 *
 * Read from `src/data/assets-manifest.json`. The glob tolerates no match, so the site still builds when the pipeline has not written one.
 */
const MANIFEST: AssetManifest = Object.values(import.meta.glob<AssetManifest>("../data/assets-manifest.json", { import: "default", eager: true }))[0] ?? {};

/**
 * URL of an operator's portrait, the 180x360 image the index card and the page hero use.
 *
 * `tools/assets/audit_assets.mjs` rebuilds this path shape by hand, since it cannot import this file - change one, update the other too.
 *
 * @param id The operator id.
 * @returns The absolute URL.
 */
export function portraitUrl(id: string): string {
	return assets.url(`portraits/${id}.webp`);
}

/**
 * URL of an operator's avatar, the 180x180 square the game's own roster uses.
 *
 * @param id The operator id.
 * @returns The absolute URL.
 */
export function avatarUrl(id: string): string {
	return assets.url(`avatars/${id}.webp`);
}

/**
 * URL of an operator's full illustration, which the art viewer shows.
 *
 * `tools/assets/audit_assets.mjs` rebuilds this path shape too - see the note on `portraitUrl` above.
 *
 * @param id The operator id.
 * @param skin The skin suffix, or undefined for the default art.
 * @returns The absolute URL.
 */
export function illustrationUrl(id: string, skin?: string): string {
	return assets.url(`illustrations/${id}${skin ? `_${skin}` : ""}.webp`);
}

/**
 * URL of a class icon.
 *
 * `tools/assets/audit_assets.mjs` rebuilds this path shape too - see the note on `portraitUrl` above.
 *
 * @param profession The display class name, such as `Guard`.
 * @returns The absolute URL.
 */
export function classIconUrl(profession: string): string {
	return assets.url(`classes/${profession.toLowerCase()}.webp`);
}

/**
 * Whether an operator's portrait is hosted.
 *
 * @param id The operator id.
 * @returns True only when the manifest records one.
 */
export function hasPortrait(id: string): boolean {
	return MANIFEST.portraits?.[id] === true;
}

/**
 * Whether an operator's illustration is hosted.
 *
 * @param id The operator id.
 * @returns True only when the manifest records one.
 */
export function hasIllustration(id: string): boolean {
	return MANIFEST.illustrations?.[id] === true;
}
