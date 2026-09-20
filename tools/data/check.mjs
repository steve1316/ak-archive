#!/usr/bin/env node
/**
 * The gate on generated data. Run it after an import and before a commit.
 *
 * There is no test runner in this repo, so this is what stands between a bad import and a shipped site. It fails on a count regression, on the
 * game's inline markup leaking into text, on an unresolved enum, and on any drift in the three hand-verified stat fixtures. It runs
 * `pnpm build` last so a type error fails here rather than in CI.
 *
 * Usage:
 *     node tools/data/check.mjs [--skip-build]
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { SHARDS } from "./lib/shards.mjs";

/** Where the importer writes. */
const OUT_DIR = "src/data";

/**
 * Floors for what an import must produce. Upstream only grows, so a number below these means the filter broke rather than that the game shrank.
 * Raise them when a real import moves them up.
 */
const MIN_COUNTS = { total: 410, WARRIOR: 80, SNIPER: 55, CASTER: 54, SPECIAL: 46, SUPPORT: 44, TANK: 43, PIONEER: 37, MEDIC: 36 };

/**
 * Stats verified by hand against the Fandom wiki, at final phase, max level, full trust, potential 1.
 *
 * These are the only defence against silently wrong interpolation. If one moves, the maths changed - check it against the wiki before editing
 * the number here.
 */
const FIXTURES = [
	{ id: "char_002_amiya", name: "Amiya", maxHp: 1680, atk: 682, def: 121, magicResistance: 20, cost: 20, blockCnt: 1 },
	{ id: "char_003_kalts", name: "Kal'tsit", maxHp: 2033, atk: 490, def: 255, magicResistance: 0, cost: 20, blockCnt: 1 },
	{ id: "char_010_chen", name: "Ch'en", maxHp: 2880, atk: 660, def: 402, magicResistance: 0, cost: 23, blockCnt: 2 }
];

/** The game's inline markup. Any of it in shipped text means `stripMarkup` missed a field. */
const MARKUP = /<[^>]+>|\{[a-zA-Z@][^}]*\}/;

/** Problems found so far. The run reports all of them rather than stopping at the first. */
const failures = [];

/**
 * Record a failure.
 *
 * @param {string} message What went wrong.
 */
function fail(message) {
	failures.push(message);
}

/**
 * Read one generated file.
 *
 * @param {string} name The file's basename under `src/data`.
 * @returns {unknown} The parsed contents.
 */
function read(name) {
	const file = path.join(OUT_DIR, `${name}.json`);
	if (!fs.existsSync(file)) {
		throw new Error(`${file} is missing - run \`pnpm import\` first`);
	}
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Walk every string in a value, so a check does not have to know the shape.
 *
 * @param {unknown} value The value to walk.
 * @param {string} where A path for the error message.
 * @param {(text: string, where: string) => void} visit Called for each string.
 */
function eachString(value, where, visit) {
	if (typeof value === "string") {
		visit(value, where);
	} else if (Array.isArray(value)) {
		value.forEach((item, i) => eachString(item, `${where}[${i}]`, visit));
	} else if (value && typeof value === "object") {
		for (const [key, item] of Object.entries(value)) {
			eachString(item, `${where}.${key}`, visit);
		}
	}
}

const operators = SHARDS.flatMap((shard) => read(shard.file));
const byId = new Map(operators.map((operator) => [operator.id, operator]));

// Counts.
if (operators.length < MIN_COUNTS.total) {
	fail(`${operators.length} operators, below the floor of ${MIN_COUNTS.total}`);
}
for (const shard of SHARDS) {
	const count = read(shard.file).length;
	if (count < MIN_COUNTS[shard.key]) {
		fail(`${shard.file} has ${count} operators, below the floor of ${MIN_COUNTS[shard.key]}`);
	}
}
if (byId.size !== operators.length) {
	fail(`${operators.length - byId.size} duplicate operator ids across shards`);
}

// Enums must all have resolved.
for (const operator of operators) {
	if (!(operator.rarity >= 1 && operator.rarity <= 6)) {
		fail(`${operator.id} has rarity ${operator.rarity}, outside 1-6`);
	}
	if (operator.profession === operator.professionKey) {
		fail(`${operator.id} has an unresolved class: ${operator.professionKey}`);
	}
	if (operator.subProfession === operator.subProfessionKey) {
		fail(`${operator.id} has an unresolved subclass: ${operator.subProfessionKey}`);
	}
}

// Markup leakage, across everything the site ships.
for (const shard of SHARDS) {
	for (const name of [shard.file, shard.profiles]) {
		eachString(read(name), name, (text, where) => {
			const hit = MARKUP.exec(text);
			if (hit) {
				fail(`markup leaked into ${where}: ${JSON.stringify(hit[0])}`);
			}
		});
	}
}

// The search index has to cover everything, or the navbar cannot find it.
const searchIndex = read("search-index");
if (searchIndex.length !== operators.length) {
	fail(`search index has ${searchIndex.length} entries for ${operators.length} operators`);
}
for (const entry of searchIndex) {
	if (!byId.has(entry.id)) {
		fail(`search index names ${entry.id}, which is in no shard`);
	}
}

// The hand-verified fixtures.
for (const fixture of FIXTURES) {
	const operator = byId.get(fixture.id);
	if (!operator) {
		fail(`fixture ${fixture.name} (${fixture.id}) is missing from the data`);
		continue;
	}
	for (const [field, want] of Object.entries(fixture)) {
		if (field === "id" || field === "name") {
			continue;
		}
		const got = operator.stats.trusted[field];
		if (got !== want) {
			fail(`${fixture.name} ${field} is ${got}, expected ${want} - verify against the wiki before changing the fixture`);
		}
	}
}

for (const message of failures) {
	console.error(`FAIL  ${message}`);
}
if (failures.length > 0) {
	console.error(`\n${failures.length} problem(s) found.`);
	process.exit(1);
}

console.log(`operators   ${operators.length} across ${SHARDS.length} shards`);
console.log(`search index ${searchIndex.length} entries`);
console.log(`fixtures    ${FIXTURES.length} verified`);
console.log("markup      none leaked");

if (!process.argv.includes("--skip-build")) {
	console.log("\nrunning pnpm build...");
	execFileSync("pnpm", ["build"], { stdio: "inherit" });
}
console.log("\nOK");
