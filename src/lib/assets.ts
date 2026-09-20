// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Asset URLs

/**
 * Every URL the app builds for the asset host.
 *
 * Paths are derived from the operator id and the kind of art rather than looked up, so nothing here needs a table. What does need a table is
 * which assets actually exist: `assets-manifest.json` is written by the A3 pipeline and records presence only. Until A3 runs there is no
 * manifest, every `has*` call returns false, and every image renders the kit's `ArtPlaceholder`. When the manifest lands the same calls start
 * returning true with no page changes - which matters because 21 of the 412 operators have no portrait upstream and never will.
 */

import { createAssetUrls } from "archive-kit";

/**
 * The asset host, from `.env`. Never hardcode a URL anywhere else, so the host stays switchable.
 *
 * The `?? ""` is a runtime guard, not a type one. `src/vite-env.d.ts` declares the variable a `string` because `.env` is meant to carry it, but
 * a checkout whose `.env` is missing gets undefined here, and an empty base leaves every URL relative rather than writing "undefined" into it.
 */
export const assets = createAssetUrls(import.meta.env.VITE_ASSET_BASE_URL ?? "");

/** What the manifest holds: for each kind of art, which operator ids have one. Only the two kinds the app asks about are declared. */
type AssetManifest = Partial<Record<"portraits" | "illustrations", Record<string, boolean>>>;

/**
 * Presence of each asset kind, keyed by operator id.
 *
 * Empty until A3 writes `src/data/assets-manifest.json`. The glob tolerates no match, which is what lets this ship before the file exists.
 */
const MANIFEST: AssetManifest = Object.values(import.meta.glob<AssetManifest>("../data/assets-manifest.json", { import: "default", eager: true }))[0] ?? {};

/**
 * URL of an operator's portrait, the 180x360 image the index card and the page hero use.
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
 * @returns True only when the manifest records one. False for everyone until A3 runs.
 */
export function hasPortrait(id: string): boolean {
	return MANIFEST.portraits?.[id] === true;
}

/**
 * Whether an operator's illustration is hosted.
 *
 * @param id The operator id.
 * @returns True only when the manifest records one. False for everyone until A3 runs.
 */
export function hasIllustration(id: string): boolean {
	return MANIFEST.illustrations?.[id] === true;
}
