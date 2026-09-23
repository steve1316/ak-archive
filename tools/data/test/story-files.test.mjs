import { test } from "node:test";
import assert from "node:assert/strict";

import { blobSha, fetchWithRetry, mapLimit, storyScriptIndex } from "../lib/storyFiles.mjs";

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

test("blobSha matches git's own blob hash, so a cut-short or corrupted file is caught", () => {
	assert.equal(blobSha(Buffer.from("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a");
});

/**
 * A fake fetch that answers from a script of statuses, where "throw" is a network error.
 *
 * @param {Array<number | "throw">} script What each call returns, in order.
 * @returns {{fetchImpl: Function, calls: () => number}} The fake and a call counter.
 */
function fakeFetch(script) {
	let calls = 0;
	const fetchImpl = async () => {
		const next = script[Math.min(calls++, script.length - 1)];
		if (next === "throw") {
			throw new TypeError("fetch failed");
		}
		return new Response("body", { status: next });
	};
	return { fetchImpl, calls: () => calls };
}

test("fetchWithRetry retries a server error and a network error, then returns the success", async () => {
	const fake = fakeFetch([503, "throw", 200]);
	const response = await fetchWithRetry("https://example.test", {}, { fetchImpl: fake.fetchImpl, delayMs: 0 });
	assert.equal(response.status, 200);
	assert.equal(fake.calls(), 3);
});

test("fetchWithRetry does not retry a 404, and gives up after its attempts", async () => {
	const notFound = fakeFetch([404]);
	assert.equal((await fetchWithRetry("https://example.test", {}, { fetchImpl: notFound.fetchImpl, delayMs: 0 })).status, 404);
	assert.equal(notFound.calls(), 1);
	const down = fakeFetch([503]);
	assert.equal((await fetchWithRetry("https://example.test", {}, { fetchImpl: down.fetchImpl, delayMs: 0, attempts: 3 })).status, 503);
	assert.equal(down.calls(), 3);
});
