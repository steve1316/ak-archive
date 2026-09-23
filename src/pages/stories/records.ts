// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Operator Records

/**
 * The Operator Records tab's logic: which operators have record stories, the letter each is filed under, the search and filters, and which art
 * shows behind the selected operator. It imports only types, so `tools/data/test/story-records.test.mjs` runs it under Node's type stripping.
 */

import type { SearchEntry } from "../../types/operator.js";
import type { StoryIndex } from "../../types/story.js";

/** A base variant key: a plain elite number, with or without `plus`, such as `2` or Amiya's `1plus`. Anything else is an outfit. */
const BASE_VARIANT = /^\d+(plus)?$/i;

/** An operator on the Operator Records tab. */
export interface RecordOperator {
	/** The upstream operator id. */
	id: string;
	/** The display name. */
	name: string;
	/** The letter or digit the name is filed under, or `#` when it has none. */
	letter: string;
	/** Star count, 1 to 6, or 0 when the operator is not in the search index. */
	rarity: number;
	/** The class name, such as `Caster`, or empty when the operator is not in the search index. */
	profession: string;
	/** The operator's record sets, in the game's order. */
	sets: StoryIndex["records"][number]["sets"];
}

/** What the reader has narrowed the list to. Empty sets filter nothing. */
export interface RecordFilter {
	/** Text the name must contain. */
	query: string;
	/** Classes to keep. */
	classes: ReadonlySet<string>;
	/** Star counts to keep. */
	rarities: ReadonlySet<number>;
}

/**
 * A name with its accents dropped and lowercased, so searching `eyja` finds `Ëyjafjalla`.
 *
 * @param name The name.
 * @returns The plain form.
 */
function plain(name: string): string {
	return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The letter an operator is filed under: the first letter or digit of their name, uppercased, with accents dropped, so `'Justice Knight'`
 * files under J and 12F under 1.
 *
 * @param name The operator's name.
 * @returns The letter, or `#` for a name with no letter or digit.
 */
export function letterOf(name: string): string {
	return (
		plain(name)
			.match(/[\p{L}\p{N}]/u)?.[0]
			?.toUpperCase() ?? "#"
	);
}

/**
 * Every operator with at least one record set, by letter and then by name.
 *
 * @param records The story index's record sets by operator.
 * @param searchIndex The operators' names, classes and rarities.
 * @returns The operators.
 */
export function recordOperators(records: StoryIndex["records"], searchIndex: SearchEntry[]): RecordOperator[] {
	const byId = new Map(searchIndex.map((entry) => [entry.id, entry]));
	return records
		.filter((record) => record.sets.length > 0)
		.map((record) => {
			const entry = byId.get(record.operator);
			const name = entry?.name ?? record.operator;
			return { id: record.operator, name, letter: letterOf(name), rarity: entry?.rarity ?? 0, profession: entry?.profession ?? "", sets: record.sets };
		})
		.sort((a, b) => a.letter.localeCompare(b.letter) || a.name.localeCompare(b.name));
}

/**
 * The operators that match the reader's search and filters, in the same order.
 *
 * @param operators The operators.
 * @param filter The search text, classes and star counts to keep.
 * @returns The matching operators.
 */
export function filterOperators(operators: RecordOperator[], filter: RecordFilter): RecordOperator[] {
	const query = plain(filter.query.trim());
	return operators.filter(
		(operator) =>
			(!query || plain(operator.name).includes(query)) &&
			(filter.classes.size === 0 || filter.classes.has(operator.profession)) &&
			(filter.rarities.size === 0 || filter.rarities.has(operator.rarity))
	);
}

/**
 * Which illustration shows behind the selected operator: a random outfit, else a random elite art, else the base art.
 *
 * @param keys The operator's published illustration variant keys.
 * @param random A number from 0 up to 1, such as `Math.random`.
 * @returns The variant key, or null for the base art.
 */
export function pickSkinKey(keys: string[], random: () => number): string | null {
	const outfits = keys.filter((key) => !BASE_VARIANT.test(key));
	const pool = outfits.length > 0 ? outfits : keys;
	return pool[Math.floor(random() * pool.length)] ?? null;
}
