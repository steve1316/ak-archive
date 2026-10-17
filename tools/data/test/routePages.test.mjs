import { test } from "node:test";
import assert from "node:assert/strict";

import { enemyNumber, operatorNumber, fileStorySlug, routePagePaths, storySlug } from "../lib/routePages.mjs";

test("route numbers drop leading zeros and leave an id with no number as it is", () => {
	assert.equal(operatorNumber("char_010_chen"), "10");
	assert.equal(operatorNumber("char_1001_amiya2"), "1001");
	assert.equal(enemyNumber("enemy_1506_patrt"), "1506");
	assert.equal(operatorNumber("oddity"), "oddity");
});

test("routePagePaths names every page route once, and no route that would need a folder beside a page of the same name", () => {
	const paths = routePagePaths({ operatorIds: ["char_010_chen", "char_002_amiya"], enemyHeadIds: ["enemy_1506_patrt", "enemy_1007_slime"] });
	assert.deepEqual(paths, ["enemies", "enemy/1007", "enemy/1506", "operator/10", "operator/2", "operators"]);
});

/** A set with one story, as nearly every operator record is, and an event with several. */
const RECORD = { id: "story_angel_set_1", stories: [{ id: "story_angel_set_1_story_1", code: null, tag: "Interlude" }] };
const EVENT = {
	id: "act40side",
	stories: [
		{ id: "act40side_level_act40side_st01", code: "OR-ST-1", tag: "Interlude" },
		{ id: "act40side_level_act40side_01_beg", code: "OR-1", tag: "Before Operation" }
	]
};

test("routePagePaths adds the picker and one page per story, but no page for a group", () => {
	const paths = routePagePaths({ operatorIds: [], enemyHeadIds: [], storyGroups: [RECORD, EVENT] });
	assert.deepEqual(paths, ["enemies", "operators", "stories", "story/act40side/or-1-before", "story/act40side/or-st-1", "story/story_angel_set_1"]);
});

test("storySlug names a story by the stage code a reader sees, and a group's only story needs no name", () => {
	assert.equal(storySlug(RECORD, "story_angel_set_1_story_1"), "");
	assert.equal(storySlug(EVENT, "act40side_level_act40side_01_beg"), "or-1-before");
	// The file says 10-01, but the story-only 10-1 comes first, so a reader knows this battle as 10-2.
	const main = {
		id: "main_10",
		stories: [
			{ id: "main_10_level_st_10-01", code: "10-1", tag: "Interlude" },
			{ id: "main_10_level_main_10-01_beg", code: "10-2", tag: "Before Operation" },
			{ id: "main_10_level_main_10-01_end_variation01", code: "10-2", tag: "Interlude" },
			{ id: "main_10_level_main_10-01_end_variation02", code: "10-2", tag: "Interlude" },
			{ id: "main_10_0_guide", code: null, tag: "Interlude" }
		]
	};
	assert.deepEqual(
		main.stories.map((story) => storySlug(main, story.id)),
		["10-1", "10-2-before", "10-2", "10-2-2", "0_guide"]
	);
});

test("fileStorySlug keeps the file-based name older links use, with every part the URL already says dropped", () => {
	assert.equal(fileStorySlug(EVENT, "act40side_level_act40side_01_beg"), "01_beg");
	assert.equal(fileStorySlug({ id: "main_10" }, "main_10_level_main_10-01_beg"), "10-01_beg");
	assert.equal(fileStorySlug({ id: "1stact" }, "act1_b"), "act1_b");
});
