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
