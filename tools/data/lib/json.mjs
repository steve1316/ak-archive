/**
 * Small helpers for reading the upstream tables.
 *
 * The dumps are not uniform: a list that happens to be empty is sometimes serialised as `{}` rather than `[]`, and sometimes as null. That is
 * not rare enough to handle at each call site - `potentialRanks` does it on 3 operators and `buffData` on 103 - so every list read goes through
 * `asArray`. A plain `?? []` does not catch it, because an empty object is neither null nor iterable.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Read a value that should be a list.
 *
 * @param {unknown} value The raw value from a table.
 * @returns {Array} The value when it really is an array, otherwise an empty array.
 */
export function asArray(value) {
	return Array.isArray(value) ? value : [];
}

/**
 * Copy an object with its keys in sorted order, so generated files diff cleanly between runs.
 *
 * @param {Record<string, unknown>} record The object.
 * @returns {Record<string, unknown>} The sorted copy.
 */
export function sortedObject(record) {
	return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Write a JSON file with a trailing newline, creating its directory.
 *
 * @param {string} file The path to write.
 * @param {unknown} value The value to serialise.
 * @returns {number} The bytes written.
 */
export function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const body = `${JSON.stringify(value)}\n`;
	fs.writeFileSync(file, body);
	return Buffer.byteLength(body);
}
