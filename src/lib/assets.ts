// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Asset URLs

/**
 * Every URL the app builds for the asset host.
 *
 * Paths are derived from the operator id and the kind of art rather than looked up, so nothing here needs a table. What does need a table is
 * which assets actually exist: `assets-manifest.json` is written by the A3 pipeline and records presence only, and `virtual:asset-presence`
 * (built by `vite.config.ts`) carries the slice of it the browser reads. A `has*` call returns false when the manifest does not record that asset, and the image then renders the kit's `ArtPlaceholder`. That is the normal path for 21 of the 412
 * operators, who have no portrait upstream and never will.
 */

import { createAssetUrls } from "archive-kit";
import presence from "virtual:asset-presence";

/**
 * The asset host, from `.env`. Never hardcode a URL anywhere else, so the host stays switchable.
 *
 * The `?? ""` is a runtime guard, not a type one. `src/vite-env.d.ts` declares the variable a `string` because `.env` is meant to carry it, but
 * a checkout whose `.env` is missing gets undefined here, and an empty base leaves every URL relative rather than writing "undefined" into it.
 */
export const assets = createAssetUrls(import.meta.env.VITE_ASSET_BASE_URL ?? "");

/** Operators with no published portrait. Every other operator the data names has one. */
const MISSING_PORTRAITS = new Set(presence.missing.portraits);

/** Operators with no published illustration. */
const MISSING_ILLUSTRATIONS = new Set(presence.missing.illustrations);

/** Enemy variants with no published handbook icon. */
const MISSING_ENEMY_ICONS = new Set(presence.missing.enemies);

/** Published module picture keys, as a set so a lookup does not scan the list. */
const MODULE_ART = new Set(presence.moduleArt);

/** Published branch badge keys. */
const MODULE_TYPES = new Set(presence.moduleTypes);

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
	return presence.available && !MISSING_PORTRAITS.has(id);
}

/**
 * Whether an operator's illustration is hosted.
 *
 * @param id The operator id.
 * @returns True only when the manifest records one.
 */
export function hasIllustration(id: string): boolean {
	return presence.available && !MISSING_ILLUSTRATIONS.has(id);
}

/**
 * URL of an enemy's handbook icon, a 158x158 square.
 *
 * `tools/assets/audit_assets.mjs` rebuilds this path shape too - see the note on `portraitUrl` above.
 *
 * @param id The enemy variant id.
 * @returns The absolute URL.
 */
export function enemyIconUrl(id: string): string {
	return assets.url(`enemies/${id}.webp`);
}

/**
 * Whether an enemy's icon is hosted.
 *
 * @param id The enemy variant id.
 * @returns True only when the manifest records one.
 */
export function hasEnemyIcon(id: string): boolean {
	return presence.available && !MISSING_ENEMY_ICONS.has(id);
}

/**
 * A module picture.
 *
 * @param key The module's `art` key.
 * @returns The picture's URL on the asset host.
 */
export function moduleArtUrl(key: string): string {
	return assets.url(`modules/${key}.webp`);
}

/**
 * Whether a module picture was published.
 *
 * @param key The picture key.
 * @returns True when the manifest lists it.
 */
export function hasModuleArt(key: string): boolean {
	return MODULE_ART.has(key);
}

/**
 * A module branch badge.
 *
 * @param key The module's `typeIcon`, such as `swo-x`.
 * @returns The badge's URL on the asset host.
 */
export function moduleTypeUrl(key: string): string {
	return assets.url(`module-types/${key}.webp`);
}

/**
 * Whether a branch badge was published.
 *
 * @param key The badge key.
 * @returns True when the manifest lists it.
 */
export function hasModuleType(key: string): boolean {
	return MODULE_TYPES.has(key);
}
