/**
 * Deriving Global release dates. Pure functions only - `tools/data/dates.mjs` does the fetching.
 *
 * An operator's date is the earlier of its first featured Global banner and its debut event's Global start. Pool-style banners that list dozens of
 * operators are kept: a pool only lists operators already out, so it can never pull a date earlier than the real release. An enemy's date is the
 * earliest dated stage it appears in, where a stage is dated by its main story chapter or by the event its zone belongs to.
 */

/** Global's launch day. */
const EN_LAUNCH = "2020-01-16";

/** The last main story chapter Global shipped at launch. The wiki's episode pages for these carry no Global date. */
const LAST_LAUNCH_CHAPTER = 4;

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

/** The suffix EN gives a rerun's name, such as `Near Light - Rerun` or `Il Siracusano - Retrospection`. */
const RERUN_SUFFIX = /\s*-\s*(Rerun|Retrospection)\s*$/i;

/** The debut an enemy dated to Global's launch day gets. */
const LAUNCH_DEBUT = "Game launch";

/** An event's tie-break order: after every main story chapter, whose order is its chapter number. */
const EVENT_ORDER = 1000;

/**
 * The day part of a wiki timestamp such as `2020-01-16 11:00:00`.
 *
 * @param {string | undefined} text The timestamp.
 * @returns {string | null} The `YYYY-MM-DD` day, or null when the text is empty or malformed.
 */
function dayOfWikiTime(text) {
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
function earliest(a, b) {
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

/**
 * A main story chapter's Global day, read from its wiki episode page's `|global = YYYY/MM/DD` field.
 *
 * @param {number} number The chapter number, 0 for the prologue.
 * @param {string} wikitext The `Episode NN` page's wikitext, or an empty string.
 * @returns {string | null} The day, the launch day for a launch chapter with no field, or null when a later chapter has no field.
 */
export function chapterDay(number, wikitext) {
	const match = /\|\s*global\s*=\s*(\d{4})\/(\d{2})\/(\d{2})/.exec(wikitext);
	if (match) {
		return `${match[1]}-${match[2]}-${match[3]}`;
	}
	return number <= LAST_LAUNCH_CHAPTER ? EN_LAUNCH : null;
}

/**
 * Map every rerun activity to its original run. A rerun is flagged `isReplicate` and named after its original plus a suffix, and the names are
 * matched case-insensitively since upstream spells `IL Siracusano` one way and its rerun another.
 *
 * @param {Record<string, {name: string, startTime: number, isReplicate?: boolean}>} basicInfo `activity_table.basicInfo`.
 * @returns {Map<string, {name: string, startTime: number}>} Rerun activity id to its original. A rerun with no findable original is left out.
 */
function originalRuns(basicInfo) {
	const byName = new Map();
	for (const info of Object.values(basicInfo)) {
		if (!info.isReplicate) {
			byName.set(info.name.trim().toLowerCase(), info);
		}
	}
	const originals = new Map();
	for (const [id, info] of Object.entries(basicInfo)) {
		const original = info.isReplicate ? byName.get(info.name.replace(RERUN_SUFFIX, "").trim().toLowerCase()) : undefined;
		if (original) {
			originals.set(id, original);
		}
	}
	return originals;
}

/**
 * Date every stage that can be dated, and name where it came from. A main story zone uses its chapter's day and name, otherwise the zone's event
 * start and name from `activity_table`.
 *
 * When an event reruns, EN moves its stages into the rerun's zone, so a zone that maps to a rerun is credited to the original run instead. A rerun
 * whose original cannot be found leaves its stages undated rather than dating them by the rerun. Supply, Annihilation and Stationary Security
 * Service zones belong to no event and stay undated. `order` breaks a tie on the same day: main story before events, then the lower chapter.
 *
 * @param {Record<string, {zoneId: string}>} stages `stage_table.stages`.
 * @param {{zoneToActivity?: Record<string, string>, basicInfo?: Record<string, {name: string, startTime: number, isReplicate?: boolean}>}} activityTable
 * `activity_table`.
 * @param {Map<string, string>} chapters Main story zone id, such as `main_7`, to its Global day.
 * @param {Record<string, {zoneNameFirst?: string, zoneNameSecond?: string}>} zones `zone_table.zones`, for the chapter names.
 * @returns {Map<string, {day: string, name: string, order: number}>} Stage id to its day, its source's name and its tie-break order.
 */
export function stageDates(stages, activityTable, chapters, zones) {
	const basicInfo = activityTable.basicInfo ?? {};
	const originals = originalRuns(basicInfo);
	const sources = new Map();
	for (const [stageId, stage] of Object.entries(stages)) {
		const chapter = chapters.get(stage.zoneId);
		if (chapter) {
			const zone = zones[stage.zoneId] ?? {};
			const name = [zone.zoneNameFirst, zone.zoneNameSecond].filter(Boolean).join(": ");
			sources.set(stageId, { day: chapter, name, order: Number(/^main_(\d+)$/.exec(stage.zoneId)?.[1] ?? 0) });
			continue;
		}
		const activityId = activityTable.zoneToActivity?.[stage.zoneId];
		const info = activityId ? basicInfo[activityId] : undefined;
		const run = info?.isReplicate ? originals.get(activityId) : info;
		if (run?.startTime) {
			sources.set(stageId, { day: dayOfUnix(run.startTime), name: run.name.trim(), order: EVENT_ORDER });
		}
	}
	return sources;
}

/**
 * Date every enemy by the earliest dated stage whose level lists it, and name that stage's event or chapter as its debut. Anything dated to
 * Global's launch day debuts at "Game launch", since the prologue and the first four episodes all arrived together.
 *
 * @param {Record<string, {levelId?: string}>} stages `stage_table.stages`.
 * @param {Map<string, {day: string, name: string, order: number}>} stageSources Stage id to its source, from `stageDates`.
 * @param {Map<string, string[]>} levelEnemies Level id to the enemy ids in its `enemyDbRefs`.
 * @returns {{dates: Record<string, string>, debuts: Record<string, string>}} Enemy id to day, and enemy id to debut name.
 */
export function enemyDates(stages, stageSources, levelEnemies) {
	const best = new Map();
	for (const [stageId, stage] of Object.entries(stages)) {
		const source = stageSources.get(stageId);
		if (!source || !stage.levelId) {
			continue;
		}
		for (const enemyId of levelEnemies.get(stage.levelId) ?? []) {
			const current = best.get(enemyId);
			if (!current || source.day < current.day || (source.day === current.day && source.order < current.order)) {
				best.set(enemyId, source);
			}
		}
	}
	const dates = {};
	const debuts = {};
	for (const [enemyId, source] of best) {
		dates[enemyId] = source.day;
		debuts[enemyId] = source.day === EN_LAUNCH ? LAUNCH_DEBUT : source.name;
	}
	return { dates, debuts };
}
