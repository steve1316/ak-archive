/**
 * Small helpers for reading the upstream tables.
 *
 * The dumps are not uniform: a list that happens to be empty is sometimes serialised as `{}` rather than `[]`, and sometimes as null. That is
 * not rare enough to handle at each call site - `potentialRanks` does it on 3 operators and `buffData` on 103 - so every list read goes through
 * `asArray`. A plain `?? []` does not catch it, because an empty object is neither null nor iterable.
 */

/**
 * Read a value that should be a list.
 *
 * @param {unknown} value The raw value from a table.
 * @returns {Array} The value when it really is an array, otherwise an empty array.
 */
export function asArray(value) {
	return Array.isArray(value) ? value : [];
}
