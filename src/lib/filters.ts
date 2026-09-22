// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Index filter helpers

/** Helpers both index pages use to build their chip rows and apply a chip toggle. */

/** Compares text so digits order by value, putting "12F" before "THRM-EX", and case is ignored. Built once rather than per comparison. */
export const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The year chip for an entry with no known release date. */
export const UNKNOWN_YEAR = "Unknown";

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

/**
 * The year chip an entry falls under.
 *
 * @param releaseDate The entry's `YYYY-MM-DD` release day, or null.
 * @returns The four-digit year, or `UNKNOWN_YEAR`.
 */
export function releaseYear(releaseDate: string | null): string {
	return releaseDate?.slice(0, 4) ?? UNKNOWN_YEAR;
}

/**
 * The year chips for a list of release days: every year that occurs, oldest first, with `UNKNOWN_YEAR` last when any day is missing.
 *
 * @param dates Every entry's release day, or null.
 * @returns The chip labels.
 */
export function yearOptions(dates: ReadonlyArray<string | null>): string[] {
	const years = [...new Set(dates.map(releaseYear))];
	return years.sort((a, b) => (a === UNKNOWN_YEAR ? 1 : b === UNKNOWN_YEAR ? -1 : COLLATOR.compare(a, b)));
}

/**
 * Compare two release days for a sort. Undated entries sort last whichever way the sort runs, and ISO days order correctly as plain strings.
 *
 * @param a One release day, or null.
 * @param b The other release day, or null.
 * @param descending Whether the sort runs newest first.
 * @returns Negative, zero or positive, as `Array.prototype.sort` expects.
 */
export function compareReleaseDates(a: string | null, b: string | null, descending: boolean): number {
	if (a === b) {
		return 0;
	}
	if (a === null) {
		return 1;
	}
	if (b === null) {
		return -1;
	}
	return (a < b ? -1 : 1) * (descending ? -1 : 1);
}
