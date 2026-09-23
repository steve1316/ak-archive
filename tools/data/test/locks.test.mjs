import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { movedPins, readPins, writeHeads } from "../lib/locks.mjs";

/**
 * Lay out a fake repo root holding the six lock files.
 *
 * @returns {string} The root.
 */
function fakeRoot() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "locks-"));
	fs.mkdirSync(path.join(root, "tools/data"), { recursive: true });
	fs.mkdirSync(path.join(root, "tools/assets"), { recursive: true });
	const write = (file, value) => fs.writeFileSync(path.join(root, file), `${JSON.stringify(value, null, "\t")}\n`);
	write("tools/data/upstream.lock.json", { repo: "A/data", server: "en", sha: "d1", levelFallback: { repo: "K/data", server: "zh_CN", sha: "c1" } });
	write("tools/assets/upstream.lock.json", { repo: "f/res", branch: "main", sha: "a1" });
	write("tools/assets/enemies.lock.json", { repo: "f/res", branch: "main", sha: "a1" });
	write("tools/assets/icons.lock.json", { repo: "A/icons", branch: "en", sha: "i1" });
	write("tools/assets/enemy-spine.lock.json", { repo: "H/models", branch: "main", sha: "m1" });
	write("tools/assets/story-audio.lock.json", { repo: "A/icons", branch: "voice", sha: "v1" });
	return root;
}

test("readPins reads all seven pins with their repo and ref, including the story audio pin on the voice branch", () => {
	const pins = readPins(fakeRoot());
	assert.deepEqual(
		pins.map((pin) => [pin.name, pin.repo, pin.ref, pin.sha]),
		[
			["data", "A/data", "HEAD", "d1"],
			["data-cn", "K/data", "HEAD", "c1"],
			["art", "f/res", "main", "a1"],
			["enemies", "f/res", "main", "a1"],
			["icons", "A/icons", "en", "i1"],
			["enemy-spine", "H/models", "main", "m1"],
			["story-audio", "A/icons", "voice", "v1"]
		]
	);
});

test("movedPins names only pins whose head differs", () => {
	const pins = readPins(fakeRoot());
	assert.deepEqual(movedPins(pins, { data: "d1", "data-cn": "c2", art: "a1", enemies: "a1", icons: "i2", "enemy-spine": "m1" }), ["data-cn", "icons"]);
});

test("writeHeads updates shas, keeps every other field and the file format", () => {
	const root = fakeRoot();
	writeHeads(root, { data: "d2", "data-cn": "c2", art: "a2", enemies: "a2", icons: "i2", "enemy-spine": "m2" });
	const data = fs.readFileSync(path.join(root, "tools/data/upstream.lock.json"), "utf8");
	assert.equal(data, `${JSON.stringify({ repo: "A/data", server: "en", sha: "d2", levelFallback: { repo: "K/data", server: "zh_CN", sha: "c2" } }, null, "\t")}\n`);
	assert.equal(JSON.parse(fs.readFileSync(path.join(root, "tools/assets/icons.lock.json"), "utf8")).sha, "i2");
});
