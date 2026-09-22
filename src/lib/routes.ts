import { searchIndex } from "./data.js";

/** The number inside an upstream operator id, such as `456` in `char_456_ash`. */
const ID_NUMBER = /^char_(\d+)_/;

/** Upstream ids keyed by their short number. Every operator's number is unique, so the short URL is enough to find it. */
const ID_BY_NUMBER = new Map(searchIndex.map((entry) => [operatorNumber(entry.id), entry.id]));

/** The number inside an upstream enemy id, such as `1023` in `enemy_1023_jmage_2`. Every enemy group's head has its own number. */
const ENEMY_NUMBER = /^enemy_(\d+)_/;

/** A route parameter in its short form: digits only. */
const SHORT_ID = /^\d+$/;

/** The query key that picks a variant on an enemy's page. */
export const VARIANT_PARAM = "variant";

/**
 * The number inside an upstream id, without leading zeros.
 *
 * @param pattern Matches the id's prefix and captures its number, such as `ID_NUMBER`.
 * @param id The upstream id.
 * @returns The number as a string, or the id unchanged when it has no number.
 */
function numberIn(pattern: RegExp, id: string): string {
	const match = pattern.exec(id);
	return match?.[1] === undefined ? id : String(Number(match[1]));
}

/**
 * The short number an operator's URL uses, without leading zeros, so `char_002_amiya` becomes `2`.
 *
 * @param id The upstream operator id.
 * @returns The number as a string, or the id unchanged when it has no number.
 */
export function operatorNumber(id: string): string {
	return numberIn(ID_NUMBER, id);
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
	if (param === undefined || !SHORT_ID.test(param)) {
		return param;
	}
	return ID_BY_NUMBER.get(String(Number(param)));
}

/**
 * The canonical address for an operator page's route parameter: the short number, whatever form the parameter came in.
 *
 * @param param The route parameter, or undefined when the route has none.
 * @param suffix A path under the operator, such as `"/art"`.
 * @returns The canonical route, or undefined for a number no operator has, which the page shows as a 404.
 */
export function canonicalOperatorPath(param: string | undefined, suffix = ""): string | undefined {
	const id = resolveOperatorParam(param);
	return id === undefined ? undefined : operatorPath(id, suffix);
}

/**
 * The short number an enemy group's URL uses, without leading zeros, so `enemy_1023_jmage` becomes `1023`.
 *
 * @param id The upstream enemy id.
 * @returns The number as a string, or the id unchanged when it has no number.
 */
export function enemyNumber(id: string): string {
	return numberIn(ENEMY_NUMBER, id);
}

/**
 * The key a variant goes by in the `?variant=` query: the number its id adds to the head's, such as `2` for `enemy_1007_slime_2`.
 *
 * @param headId The group head's upstream id.
 * @param variantId The variant's upstream id.
 * @returns The key, or null for the head itself or an id that does not extend the head's.
 */
export function variantKey(headId: string, variantId: string): string | null {
	return variantId.startsWith(`${headId}_`) ? variantId.slice(headId.length + 1) : null;
}

/**
 * Turn a `?variant=` key back into a variant id.
 *
 * @param headId The group head's upstream id.
 * @param key The query's value, or null when there is none.
 * @returns The variant's upstream id, or the head's when there is no key.
 */
export function variantFromKey(headId: string, key: string | null): string {
	return key ? `${headId}_${key}` : headId;
}

/**
 * The route for an enemy group's page, such as `/enemy/1007?variant=2` for Originium Slug α.
 *
 * @param headId The group head's upstream id.
 * @param variant A variant to open selected, or undefined for the head.
 * @returns The route, without the site's base path.
 */
export function enemyPath(headId: string, variant?: string): string {
	const key = variant ? variantKey(headId, variant) : null;
	return `${enemyNumberPath(enemyNumber(headId))}${key ? `?${VARIANT_PARAM}=${key}` : ""}`;
}

/**
 * The route for an enemy group's page by its number.
 *
 * @param number The group head's number, without leading zeros.
 * @returns The route, without the site's base path.
 */
function enemyNumberPath(number: string): string {
	return `/enemy/${number}`;
}

/**
 * The canonical address for an enemy page's route parameter: the number without leading zeros. Enemy links have only ever used the number, so
 * anything else names no enemy.
 *
 * @param param The route parameter, or undefined when the route has none.
 * @returns The canonical route, or undefined when the parameter is not a number, which the page shows as a 404.
 */
export function canonicalEnemyPath(param: string | undefined): string | undefined {
	return param !== undefined && SHORT_ID.test(param) ? enemyNumberPath(String(Number(param))) : undefined;
}
