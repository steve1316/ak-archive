import { test } from "node:test";
import assert from "node:assert/strict";

import { ledgerProblems, missingAssets, publishedAssets, referencedAssets, updateLedger } from "../lib/gaps.mjs";

const OPERATORS = [{ id: "char_a" }];
const DETAILS = new Map([["char_a", { skills: [{ icon: "skcom_a" }], modules: [{ art: "uniequip_002_a", typeIcon: "swo-x" }] }]]);
const ENEMIES = [{ variants: [{ id: "enemy_1" }] }];

test("referencedAssets names every core asset the data points at", () => {
	const keys = [...referencedAssets({ operators: OPERATORS, details: DETAILS, enemies: ENEMIES })].sort();
	assert.deepEqual(keys, ["badge:swo-x", "enemy-rig:enemy_1", "enemy:enemy_1", "illustration:char_a", "module:uniequip_002_a", "portrait:char_a", "rig:char_a", "skill:skcom_a"]);
});

test("publishedAssets reads presence from the manifest and the rig indexes", () => {
	const manifest = { portraits: { char_a: true }, illustrations: { char_a: false }, skillIcons: ["skcom_a"], moduleArt: [], moduleTypes: ["swo-x"], enemies: { enemy_1: true } };
	const published = publishedAssets({ manifest, spineIndex: { char_a: { base: { battle: {} } } }, enemySpineIndex: {} });
	assert.deepEqual([...published].sort(), ["badge:swo-x", "enemy:enemy_1", "portrait:char_a", "rig:char_a", "skill:skcom_a"]);
});

test("updateLedger adds new gaps with today, keeps first-seen dates and prunes what is published or no longer referenced", () => {
	const ledger = { pending: { "skill:old": "2026-09-01", "module:done": "2026-09-10" }, accepted: { "portrait:gone": "no art", "enemy-rig:enemy_1": "no rig" } };
	const next = updateLedger(ledger, ["skill:old", "portrait:new", "enemy-rig:enemy_1"], "2026-09-22");
	assert.deepEqual(next, { pending: { "portrait:new": "2026-09-22", "skill:old": "2026-09-01" }, accepted: { "enemy-rig:enemy_1": "no rig" } });
});

test("ledgerProblems fails an unlisted gap, an 8-day-old pending gap and a stale entry, and passes a 7-day-old one", () => {
	const ledger = { pending: { "skill:late": "2026-09-14", "skill:fine": "2026-09-15", "module:stale": "2026-09-20" }, accepted: {} };
	const problems = ledgerProblems(ledger, ["skill:late", "skill:fine", "portrait:unlisted"], "2026-09-22");
	assert.equal(problems.length, 3);
	assert.match(problems.join("\n"), /portrait:unlisted is missing and not in/);
	assert.match(problems.join("\n"), /skill:late has been pending since 2026-09-14/);
	assert.match(problems.join("\n"), /module:stale is listed in pending but is not missing/);
});

test("missingAssets is the sorted difference", () => {
	assert.deepEqual(missingAssets(new Set(["b", "a", "c"]), new Set(["c"])), ["a", "b"]);
});
