import { test } from "node:test";
import assert from "node:assert/strict";

import { enemyNumber, operatorNumber, routePagePaths } from "../lib/routePages.mjs";

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

test("routePagePaths adds the picker and one page per story, but no page for a group", () => {
	const paths = routePagePaths({ operatorIds: [], enemyHeadIds: [], storyPaths: ["main_0/main_0_a", "1stact/act1_b"] });
	assert.deepEqual(paths, ["enemies", "operators", "stories", "story/1stact/act1_b", "story/main_0/main_0_a"]);
});
