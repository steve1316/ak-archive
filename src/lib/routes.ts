import { searchIndex } from "./data.js";

/** The number inside an upstream operator id, such as `456` in `char_456_ash`. */
const ID_NUMBER = /^char_(\d+)_/;

/** Upstream ids keyed by their short number. Every operator's number is unique, so the short URL is enough to find it. */
const ID_BY_NUMBER = new Map(searchIndex.map((entry) => [operatorNumber(entry.id), entry.id]));

/**
 * The short number an operator's URL uses, without leading zeros, so `char_002_amiya` becomes `2`.
 *
 * @param id The upstream operator id.
 * @returns The number as a string, or the id unchanged when it has no number.
 */
export function operatorNumber(id: string): string {
	const match = ID_NUMBER.exec(id);
	return match?.[1] === undefined ? id : String(Number(match[1]));
}

/**
 * The route for an operator's page, or for a page under it such as the art viewer.
 *
 * @param id The upstream operator id.
 * @param suffix A path to append, such as `"/art"`.
 * @returns The route, without the site's base path.
 */
export function operatorPath(id: string, suffix = ""): string {
	return `/operator/${operatorNumber(id)}${suffix}`;
}

/**
 * Turn the `:id` route parameter back into an upstream id. A short number is looked up. Anything else is taken as a full id, which is how
 * links made before the short form still work.
 *
 * @param param The route parameter, or undefined when the route has none.
 * @returns The upstream id, or undefined for a number no operator has.
 */
export function resolveOperatorParam(param: string | undefined): string | undefined {
	if (param === undefined || !/^\d+$/.test(param)) {
		return param;
	}
	return ID_BY_NUMBER.get(String(Number(param)));
}

/** The prefix every upstream enemy id carries and its URL drops. */
const ENEMY_PREFIX = "enemy_";

/** The query key that picks a variant on an enemy's page. */
export const VARIANT_PARAM = "variant";

/**
 * An enemy id without its `enemy_` prefix, which is how it appears in a URL. Enemy numbers repeat across variants, so unlike an operator
 * the whole id is kept.
 *
 * @param id The upstream enemy id, such as `enemy_1007_slime_2`.
 * @returns The id without its prefix, such as `1007_slime_2`.
 */
export function enemySlug(id: string): string {
	return id.startsWith(ENEMY_PREFIX) ? id.slice(ENEMY_PREFIX.length) : id;
}

/**
 * The route for an enemy group's page.
 *
 * @param id The group head's upstream id.
 * @param variant A variant to open selected, or undefined for the head.
 * @returns The route, without the site's base path.
 */
export function enemyPath(id: string, variant?: string): string {
	return `/enemy/${enemySlug(id)}${variant && variant !== id ? `?${VARIANT_PARAM}=${enemySlug(variant)}` : ""}`;
}

/**
 * Turn an enemy slug from the URL back into an upstream id.
 *
 * @param slug The slug, or undefined when there is none.
 * @returns The upstream id, or undefined when there is no slug.
 */
export function resolveEnemySlug(slug: string | null | undefined): string | undefined {
	return slug ? `${ENEMY_PREFIX}${slug}` : undefined;
}
