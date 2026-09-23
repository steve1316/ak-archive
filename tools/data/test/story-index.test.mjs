import { test } from "node:test";
import assert from "node:assert/strict";

import { buildStoryIndex, withoutStories } from "../../story/build_index.mjs";

/**
 * A story row as `story_review_table` writes it.
 *
 * @param {string} storyId The story id.
 * @param {number} storySort Its order in the group.
 * @param {string} storyTxt Its script path.
 * @returns {object} The row.
 */
function story(storyId, storySort, storyTxt) {
	return { storyId, storySort, storyCode: `${storySort}-1`, storyName: storyId, avgTag: "Before Operation", storyTxt };
}

const REVIEW = {
	main_0: {
		id: "main_0",
		name: "Evil Time Part 1",
		entryType: "MAINLINE",
		startShowTime: 1,
		storyEntryPicId: null,
		infoUnlockDatas: [story("main_0_a", 2, "obt/main/A_End"), story("main_0_b", 1, "obt/main/a_beg"), story("main_0_gone", 3, "obt/main/gone")]
	},
	main_15: { id: "main_15", name: "Dissociative Recombination", entryType: "MAINLINE", startShowTime: 5, storyEntryPicId: null, infoUnlockDatas: [story("main_15_a", 1, "obt/main/c")] },
	act1: { id: "act1", name: "Later Event", entryType: "ACTIVITY", startShowTime: 20, storyEntryPicId: "storyEntryPic_act1", infoUnlockDatas: [story("act1_a", 1, "activities/act1/a")] },
	act0: { id: "act0", name: "Earlier Event", entryType: "ACTIVITY", startShowTime: 10, storyEntryPicId: null, infoUnlockDatas: [story("main_0_b", 1, "obt/main/a_beg")] },
	mini1: { id: "mini1", name: "Side", entryType: "MINI_ACTIVITY", startShowTime: 30, storyEntryPicId: "storyEntryPic_mini1", infoUnlockDatas: [story("mini1_a", 1, "activities/mini1/a")] },
	story_kroos_set_1: { id: "story_kroos_set_1", name: "Apples", entryType: "NONE", startShowTime: -1, storyEntryPicId: null, infoUnlockDatas: [story("kroos_1", 0, "obt/memory/kroos_1")] },
	orphan: { id: "orphan", name: "Unlinked", entryType: "NONE", startShowTime: -1, storyEntryPicId: null, infoUnlockDatas: [story("orphan_1", 0, "obt/memory/orphan")] }
};

const CHAPTERS = {
	chapter_0: { chapterId: "chapter_0", chapterName: "Hour of An Awakening", chapterIndex: 0, startZoneId: "main_0", endZoneId: "main_3" },
	chapter_3: { chapterId: "chapter_3", chapterName: "Nexus Point of Future", chapterIndex: 3, startZoneId: "act2mainss_zone1", endZoneId: "act3mainss_zone1" }
};

const HANDBOOK = {
	char_124_kroos: { handbookAvgList: [{ storySetId: "story_kroos_set_1", storySetName: "Apples" }] },
	char_999_ghost: { handbookAvgList: [{ storySetId: "story_ghost_set_1", storySetName: "Missing" }] }
};

const SCRIPTS = new Map(
	["obt/main/a_end", "obt/main/a_beg", "obt/main/c", "activities/act1/a", "activities/mini1/a", "obt/memory/kroos_1", "obt/memory/orphan"].map((path, index) => [path, { path, sha: `sha${index}` }])
);

const built = buildStoryIndex({ reviewTable: REVIEW, chapterTable: CHAPTERS, handbookDict: HANDBOOK, scripts: SCRIPTS });

test("acts hold their main episodes, and an act with non-numeric zone ids takes the episodes after the previous act", () => {
	assert.deepEqual(built.index.acts, [
		{ id: "chapter_0", name: "Hour of An Awakening", groups: ["main_0"] },
		{ id: "chapter_3", name: "Nexus Point of Future", groups: ["main_15"] }
	]);
});

test("tabs list main episodes by number, and events and side stories by start time", () => {
	assert.deepEqual(
		built.index.main.map((group) => group.id),
		["main_0", "main_15"]
	);
	assert.deepEqual(
		built.index.events.map((group) => group.id),
		["act0", "act1"]
	);
	assert.deepEqual(built.index.side, [{ id: "mini1", name: "Side", stories: 1, cover: "storyEntryPic_mini1", start: 30 }]);
});

test("a group's stories follow storySort, a case-mismatched script resolves, and a missing script is listed instead", () => {
	assert.deepEqual(
		built.groups.main_0.stories.map((entry) => entry.id),
		["main_0_b", "main_0_a"]
	);
	assert.deepEqual(built.index.missing, ["obt/main/gone"]);
	assert.equal(built.index.main[0].stories, 2);
});

test("a story listed under two groups is written once", () => {
	assert.equal(built.stories.filter((entry) => entry.id === "main_0_b").length, 1);
	assert.deepEqual(
		built.groups.act0.stories.map((entry) => entry.id),
		["main_0_b"]
	);
});

test("operator record sets link to their group, skip sets with no stories, and leave unlinked groups out", () => {
	assert.deepEqual(built.index.records, [{ operator: "char_124_kroos", sets: [{ group: "story_kroos_set_1", name: "Apples" }] }]);
	assert.deepEqual(built.records.get("char_124_kroos"), [{ group: "story_kroos_set_1", name: "Apples" }]);
	assert.equal(built.groups.story_kroos_set_1.type, "record");
	assert.equal(built.groups.orphan, undefined);
});

test("withoutStories drops empty stories, updates the counts, drops groups left empty and lists the dropped scripts as missing", () => {
	const trimmed = withoutStories(built, new Set(["main_0_a", "mini1_a"]), ["obt/main/a_end", "activities/mini1/a"]);
	assert.deepEqual(
		trimmed.groups.main_0.stories.map((entry) => entry.id),
		["main_0_b"]
	);
	assert.equal(trimmed.index.main[0].stories, 1);
	assert.deepEqual(trimmed.index.side, []);
	assert.equal(trimmed.groups.mini1, undefined);
	assert.equal(
		trimmed.stories.some((entry) => entry.id === "main_0_a"),
		false
	);
	assert.deepEqual(trimmed.index.missing, ["activities/mini1/a", "obt/main/a_end", "obt/main/gone"]);
	assert.equal(built.groups.main_0.stories.length, 2, "the input is left unchanged");
});

test("an operator whose record list is written as {} rather than [] has no record sets and does not break the index", () => {
	const index = buildStoryIndex({ reviewTable: REVIEW, chapterTable: CHAPTERS, handbookDict: { ...HANDBOOK, char_000_empty: { handbookAvgList: {} } }, scripts: SCRIPTS });
	assert.equal(index.records.has("char_000_empty"), false);
});
