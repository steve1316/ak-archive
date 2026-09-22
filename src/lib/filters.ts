// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Index filter helpers

/** Helpers both index pages use to build their chip rows and apply a chip toggle. */

/** Compares text so digits order by value, putting "12F" before "THRM-EX", and case is ignored. Built once rather than per comparison. */
export const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Add a value to a selection, or drop it when it is already selected.
 *
 * @param selection The values currently selected.
 * @param value The value the chip reported.
 * @returns The new selection.
 */
export function toggled<T>(selection: T[], value: T): T[] {
	return selection.includes(value) ? selection.filter((entry) => entry !== value) : [...selection, value];
}

/**
 * Collect one filter axis's options out of a list of entries.
 *
 * @param entries The entries to read.
 * @param read Pulls one entry's values for this axis. Nulls are dropped, which is how an operator with no nation or no team is handled.
 * @returns The values, unique and sorted.
 */
export function optionsOf<T>(entries: readonly T[], read: (entry: T) => ReadonlyArray<string | null>): string[] {
	const values = new Set<string>();
	for (const entry of entries) {
		for (const value of read(entry)) {
			if (value) {
				values.add(value);
			}
		}
	}
	return [...values].sort(COLLATOR.compare);
}
