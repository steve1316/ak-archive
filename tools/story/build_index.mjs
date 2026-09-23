/**
 * The story index: which acts, episodes, events, side stories and operator records exist, and which stories each holds.
 *
 * The game catalogues its stories in `story_review_table`, one group per episode or event, each listing its stories and their script paths.
 * Acts come from `chapter_table`, and operator record sets from `handbook_info_table`. A story whose script upstream does not have is left out
 * and listed in `missing`, so the picker never offers a story that cannot open. Script paths are matched case-insensitively, since the tables
 * and the files disagree on case.
 *
 * This module is pure: it takes the tables and the script listing and returns data, so it is tested without the network.
 */

import { asArray } from "../data/lib/json.mjs";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Module constants

/** Which picker tab each `entryType` feeds. `NONE` groups appear only as operator record sets. */
const TAB_BY_ENTRY = { MAINLINE: "main", ACTIVITY: "event", MINI_ACTIVITY: "side" };

/** A main episode's zone id, such as `main_14`. */
const MAIN_ZONE = /^main_(\d+)$/;

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Index

/**
 * The episode number in a main zone id.
 *
 * @param {string | null | undefined} id The zone id.
 * @returns {number | null} The number, or null for any other id.
 */
function mainNumber(id) {
	const match = MAIN_ZONE.exec(id ?? "");
	return match ? Number(match[1]) : null;
}

/**
 * A group's entry in a picker tab.
 *
 * @param {{id: string, name: string, stories: unknown[]}} group The built group.
 * @param {{storyEntryPicId?: string | null, startShowTime?: number}} row The group's `story_review_table` row.
 * @returns {{id: string, name: string, stories: number, cover: string | null, start: number | null}} The entry.
 */
function groupMeta(group, row) {
	return { id: group.id, name: group.name, stories: group.stories.length, cover: row.storyEntryPicId ?? null, start: row.startShowTime > 0 ? row.startShowTime : null };
}

/**
 * Build the story index.
 *
 * @param {{reviewTable: Record<string, any>, chapterTable: Record<string, any>, handbookDict: Record<string, any>, scripts: Map<string, {path: string, sha: string}>}} input
 * The upstream tables, and every script upstream has, keyed by lowercased path without `.txt`.
 * @returns {{index: object, groups: Record<string, object>, stories: {id: string, path: string, sha: string}[], records: Map<string, {group: string, name: string}[]>}}
 * The index, the groups by id, one entry per unique story to write, and each operator's record sets.
 */
export function buildStoryIndex({ reviewTable, chapterTable, handbookDict, scripts }) {
	const recordSets = new Map();
	for (const [operator, entry] of Object.entries(handbookDict)) {
		for (const set of asArray(entry.handbookAvgList)) {
			recordSets.set(set.storySetId, { operator, name: set.storySetName });
		}
	}

	const groups = {};
	const rows = {};
	const stories = new Map();
	const missing = [];
	for (const row of Object.values(reviewTable)) {
		const type = TAB_BY_ENTRY[row.entryType] ?? (recordSets.has(row.id) ? "record" : null);
		if (!type) {
			continue;
		}
		const entries = [];
		for (const item of [...asArray(row.infoUnlockDatas)].sort((a, b) => a.storySort - b.storySort)) {
			const script = scripts.get(item.storyTxt.toLowerCase());
			if (!script) {
				missing.push(item.storyTxt);
				continue;
			}
			entries.push({ id: item.storyId, code: item.storyCode ?? null, name: item.storyName, tag: item.avgTag });
			if (!stories.has(item.storyId)) {
				stories.set(item.storyId, { id: item.storyId, path: script.path, sha: script.sha });
			}
		}
		if (entries.length) {
			groups[row.id] = { id: row.id, name: row.name, type, stories: entries };
			rows[row.id] = row;
		}
	}

	const byType = (type) => Object.values(groups).filter((group) => group.type === type);
	const main = byType("main").sort((a, b) => mainNumber(a.id) - mainNumber(b.id));
	const byStart = (a, b) => (rows[a.id].startShowTime ?? 0) - (rows[b.id].startShowTime ?? 0) || a.id.localeCompare(b.id);
	const maxMain = Math.max(...main.map((group) => mainNumber(group.id)));

	const acts = [];
	let previousEnd = -1;
	for (const chapter of Object.values(chapterTable).sort((a, b) => a.chapterIndex - b.chapterIndex)) {
		// Act 3's zone ids are not `main_N`, so an act without numbers runs from the episode after the previous act to the last one.
		const from = mainNumber(chapter.startZoneId) ?? previousEnd + 1;
		const to = mainNumber(chapter.endZoneId) ?? maxMain;
		acts.push({ id: chapter.chapterId, name: chapter.chapterName, groups: main.filter((group) => mainNumber(group.id) >= from && mainNumber(group.id) <= to).map((group) => group.id) });
		previousEnd = to;
	}

	const records = new Map();
	for (const group of byType("record")) {
		const set = recordSets.get(group.id);
		if (!records.has(set.operator)) {
			records.set(set.operator, []);
		}
		records.get(set.operator).push({ group: group.id, name: set.name });
	}
	const recordList = [...records.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([operator, sets]) => ({ operator, sets }));

	const index = {
		acts,
		main: main.map((group) => groupMeta(group, rows[group.id])),
		events: byType("event")
			.sort(byStart)
			.map((group) => groupMeta(group, rows[group.id])),
		side: byType("side")
			.sort(byStart)
			.map((group) => groupMeta(group, rows[group.id])),
		records: recordList,
		missing: missing.sort()
	};
	return { index, groups, stories: [...stories.values()], records };
}

/**
 * Remove stories from a built index, such as scripts that parsed to nothing, so the picker never offers a story that opens blank.
 *
 * @param {{index: object, groups: Record<string, object>, stories: {id: string}[], records: Map<string, {group: string, name: string}[]>}} built
 * A `buildStoryIndex` result. It is not modified.
 * @param {Set<string>} ids The story ids to remove.
 * @param {string[]} paths Their script paths, which join `index.missing`.
 * @returns {{index: object, groups: Record<string, object>, stories: {id: string}[], records: Map<string, {group: string, name: string}[]>}} The trimmed copy.
 */
export function withoutStories(built, ids, paths) {
	const groups = {};
	for (const group of Object.values(built.groups)) {
		const stories = group.stories.filter((entry) => !ids.has(entry.id));
		if (stories.length) {
			groups[group.id] = { ...group, stories };
		}
	}
	const kept = (tab) => tab.filter((meta) => groups[meta.id]).map((meta) => ({ ...meta, stories: groups[meta.id].stories.length }));
	const records = new Map();
	for (const [operator, sets] of built.records) {
		const live = sets.filter((set) => groups[set.group]);
		if (live.length) {
			records.set(operator, live);
		}
	}
	const index = {
		...built.index,
		main: kept(built.index.main),
		events: kept(built.index.events),
		side: kept(built.index.side),
		records: [...records.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([operator, sets]) => ({ operator, sets })),
		acts: built.index.acts.map((act) => ({ ...act, groups: act.groups.filter((id) => groups[id]) })),
		missing: [...built.index.missing, ...paths].sort()
	};
	return { index, groups, stories: built.stories.filter((entry) => !ids.has(entry.id)), records };
}
