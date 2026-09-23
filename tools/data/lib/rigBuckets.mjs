/**
 * Splits the two chibi rig indexes into small bucket files, so a page fetches only the bucket holding the operator or enemy it shows rather than
 * the whole 500 KB index. The build writes the buckets and `src/lib/spine.ts` picks one, both through this module, so the two cannot disagree.
 */

import { enemyNumber, operatorNumber } from "./routePages.mjs";

/** How many buckets each index is split into. The id numbers spread evenly, so each bucket is about an eighth of its index. */
export const RIG_BUCKET_COUNT = 8;

/**
 * The bucket an operator or enemy id belongs to: the number in its id, modulo the bucket count. Every variant of an enemy group shares the
 * head's number, so switching variants never fetches another bucket.
 *
 * @param {string} id The upstream operator or enemy id.
 * @returns {number} The bucket, or 0 for an id with no number.
 */
export function rigBucket(id) {
	const number = Number(id.startsWith("enemy_") ? enemyNumber(id) : operatorNumber(id));
	return Number.isInteger(number) ? number % RIG_BUCKET_COUNT : 0;
}

/**
 * Split a rig index into its buckets.
 *
 * @param {Record<string, unknown>} index The operator or enemy rig index, keyed by id.
 * @returns {Record<string, unknown>[]} One index per bucket, in bucket order, each keeping the full index's key order.
 */
export function splitRigIndex(index) {
	const buckets = Array.from({ length: RIG_BUCKET_COUNT }, () => ({}));
	for (const [id, entry] of Object.entries(index)) {
		buckets[rigBucket(id)][id] = entry;
	}
	return buckets;
}
