/**
 * Deriving Global release dates. Pure functions only - `tools/data/dates.mjs` does the fetching.
 *
 * An operator's date is the earlier of its first featured Global banner and its debut event's Global start. Pool-style banners that list dozens of
 * operators are kept: a pool only lists operators already out, so it can never pull a date earlier than the real release. An enemy's date is the
 * earliest dated stage it appears in, where a stage is dated by its main story chapter or by the event its zone belongs to.
 */

/** Global's launch day. */
export const EN_LAUNCH = "2020-01-16";

/** The last main story chapter Global shipped at launch. The wiki's episode pages for these carry no Global date. */
export const LAST_LAUNCH_CHAPTER = 4;

/** Operators whose wiki name differs from their EN `name`. Keyed by id so the two patch Amiyas, which share the name `Amiya`, resolve apart. */
export const ID_ALIASES = {
	char_4000_jnight: "Justice Knight",
	char_4182_oblvns: "Togawa Sakiko",
	char_4183_mortis: "Wakaba Mutsumi",
	char_4184_dolris: "Misumi Uika",
	char_4185_amoris: "Yūtenji Nyamu",
	char_4186_tmoris: "Yahata Umiri",
	char_1001_amiya2: "Amiya (Guard)",
	char_1037_amiya3: "Amiya (Medic)"
};

/**
 * The day part of a wiki timestamp such as `2020-01-16 11:00:00`.
 *
 * @param {string | undefined} text The timestamp.
 * @returns {string | null} The `YYYY-MM-DD` day, or null when the text is empty or malformed.
 */
export function dayOfWikiTime(text) {
	return /^\d{4}-\d{2}-\d{2}/.exec(text ?? "")?.[0] ?? null;
}

/**
 * The UTC day of a Unix timestamp in seconds.
 *
 * @param {number} seconds The timestamp.
 * @returns {string} The `YYYY-MM-DD` day.
 */
export function dayOfUnix(seconds) {
	return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * The earlier of two days, where either may be missing.
 *
 * @param {string | null | undefined} a One day.
 * @param {string | null | undefined} b The other.
 * @returns {string | null} The earlier day, or null when both are missing.
 */
export function earliest(a, b) {
	if (!a) {
		return b ?? null;
	}
	if (!b) {
		return a;
	}
	return a < b ? a : b;
}

/**
 * Date every operator from the wiki's Cargo rows.
 *
 * @param {Map<string, string>} names Operator id to the name the wiki uses, after `ID_ALIASES`.
 * @param {Array<Record<string, string>>} banners `Banners` rows with `operators`, `startTimeGlobal` and `upcoming`.
 * @param {Array<Record<string, string>>} wikiOperators `Operators` rows with `name` and `event`.
 * @param {Array<Record<string, string>>} events Global `EventServerDetails` rows with `event` and `startTime`.
 * @returns {{dates: Record<string, string>, unmatched: string[], undated: string[]}} Dates by id, plus the ids the wiki does not know and the
 * ids it knows but cannot date.
 */
export function operatorDates(names, banners, wikiOperators, events) {
	const eventDay = new Map();
	for (const row of events) {
		const key = (row.event ?? "").toLowerCase();
		eventDay.set(key, earliest(eventDay.get(key), dayOfWikiTime(row.startTime)));
	}

	const bannerDay = new Map();
	for (const row of banners) {
		const day = dayOfWikiTime(row.startTimeGlobal);
		if (row.upcoming === "1" || !day) {
			continue;
		}
		for (const name of (row.operators ?? "").split(",")) {
			const trimmed = name.trim();
			if (trimmed) {
				bannerDay.set(trimmed, earliest(bannerDay.get(trimmed), day));
			}
		}
	}

	const debut = new Map(wikiOperators.map((row) => [row.name, (row.event ?? "").toLowerCase()]));
	const dates = {};
	const unmatched = [];
	const undated = [];
	for (const [id, name] of names) {
		if (!debut.has(name)) {
			unmatched.push(`${id} (${name})`);
			continue;
		}
		const day = earliest(bannerDay.get(name), eventDay.get(debut.get(name)));
		if (day) {
			dates[id] = day;
		} else {
			undated.push(`${id} (${name})`);
		}
	}
	return { dates, unmatched, undated };
}
