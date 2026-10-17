import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { SNAPSHOT, auditCoverage, namesOf } from "../../story/audit_coverage.mjs";

/**
 * The hint every failure ends with.
 *
 * @type {string}
 */
const HOW = "Decide what it means in the game, make the engine apply it, then run `node tools/story/audit_coverage.mjs --write`.";

test("every story command and argument is either applied by the engine or listed as a known gap", () => {
	const reviewed = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
	const now = namesOf(auditCoverage());
	const unreviewed = [];
	for (const [command, entry] of Object.entries(now)) {
		const known = reviewed[command];
		if (!known) {
			unreviewed.push(`new command ${command}`);
			continue;
		}
		unreviewed.push(...entry.ignored.filter((key) => !known.ignored.includes(key)).map((key) => `${command}.${key}`));
	}
	assert.deepEqual(unreviewed, [], `The stories use commands or arguments the engine does not read and nobody has reviewed. ${HOW}`);
});

test("the known-gap list drops an argument once the engine reads it", () => {
	const reviewed = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
	const now = namesOf(auditCoverage());
	const fixed = [];
	for (const [command, entry] of Object.entries(reviewed)) {
		const current = now[command];
		fixed.push(...entry.ignored.filter((key) => current && !current.ignored.includes(key)).map((key) => `${command}.${key}`));
		if (entry.handled === false && current?.handled) {
			fixed.push(`${command} (now handled)`);
		}
	}
	assert.deepEqual(fixed, [], `The engine now reads these, so they are stale in the gap list. ${HOW}`);
});
