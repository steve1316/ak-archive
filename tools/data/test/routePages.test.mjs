import { test } from "node:test";
import assert from "node:assert/strict";

import { enemyNumber, operatorNumber, routePagePaths, storySlug } from "../lib/routePages.mjs";

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
const RECORD = { id: "story_angel_set_1", stories: [{ id: "story_angel_set_1_story_1" }] };
const EVENT = { id: "act40side", stories: [{ id: "act40side_level_act40side_st01" }, { id: "act40side_level_act40side_01_beg" }] };

test("routePagePaths adds the picker and one page per story, but no page for a group", () => {
	const paths = routePagePaths({ operatorIds: [], enemyHeadIds: [], storyGroups: [RECORD, EVENT] });
	assert.deepEqual(paths, ["enemies", "operators", "stories", "story/act40side/01_beg", "story/act40side/st01", "story/story_angel_set_1"]);
});

test("storySlug drops every part the URL already says, and a group's only story needs no name", () => {
	assert.equal(storySlug(RECORD, "story_angel_set_1_story_1"), "");
	assert.equal(storySlug(EVENT, "act40side_level_act40side_01_beg"), "01_beg");
	const main = { id: "main_0", stories: [{ id: "main_0_0_welcome_to_guide" }, { id: "main_0_level_main_00-01_beg" }] };
	assert.equal(storySlug(main, "main_0_0_welcome_to_guide"), "0_welcome_to_guide");
	assert.equal(storySlug(main, "main_0_level_main_00-01_beg"), "00-01_beg");
	assert.equal(storySlug({ id: "1stact", stories: [{ id: "a" }, { id: "b" }] }, "act1_b"), "act1_b");
});
