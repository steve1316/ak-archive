import { test } from "node:test";
import assert from "node:assert/strict";

import { mapLimit, storyScriptIndex } from "../lib/storyFiles.mjs";

test("storyScriptIndex keys scripts by lowercased path without .txt, and skips summaries, folders and other files", () => {
	const index = storyScriptIndex({
		truncated: false,
		tree: [
			{ path: "obt/main/Level_Main_00-01_beg.txt", type: "blob", sha: "a1" },
			{ path: "[uc]info/obt/main/level_main_00-01_beg.txt", type: "blob", sha: "b2" },
			{ path: "obt/main", type: "tree", sha: "c3" },
			{ path: "story_variables.json", type: "blob", sha: "d4" }
		]
	});
	assert.deepEqual([...index.entries()], [["obt/main/level_main_00-01_beg", { path: "obt/main/Level_Main_00-01_beg", sha: "a1" }]]);
});

test("storyScriptIndex refuses a truncated listing rather than planning from part of it", () => {
	assert.throws(() => storyScriptIndex({ truncated: true, tree: [] }), /truncated/);
});

test("mapLimit runs every item and never more than the limit at once", async () => {
	let running = 0;
	let peak = 0;
	const seen = [];
	await mapLimit([1, 2, 3, 4, 5], 2, async (item) => {
		running++;
		peak = Math.max(peak, running);
		await new Promise((resolve) => setTimeout(resolve, 5));
		seen.push(item);
		running--;
	});
	assert.equal(peak, 2);
	assert.deepEqual(
		seen.sort((a, b) => a - b),
		[1, 2, 3, 4, 5]
	);
});
