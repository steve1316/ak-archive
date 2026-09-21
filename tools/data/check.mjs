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

import { parseRecord } from "./lib/record.mjs";
import { SHARDS } from "./lib/shards.mjs";

/** Where the importer writes. */
const OUT_DIR = "src/data";

/**
 * Floors for what an import must produce. Upstream only grows, so a number below these means the filter broke rather than that the game shrank.
 * Raise them when a real import moves them up.
 */
const MIN_COUNTS = { total: 410, WARRIOR: 80, SNIPER: 55, CASTER: 54, SPECIAL: 46, SUPPORT: 44, TANK: 43, PIONEER: 37, MEDIC: 36 };

/** Every one of the 412 operators has at least one talent at the pinned sha, so a zero here means the candidate filter is too aggressive. */
const MIN_TALENTS = 410;

/** 409 of the 412 operators have potential ranks at the pinned sha. Three ship `potentialRanks` as `{}`, which is legitimately empty. */
const MIN_POTENTIALS = 400;

/** Every one of the 412 operators has at least one form at the pinned sha, so a zero here means the skin table grouping broke. */
const MIN_FORMS = 410;

/** Operators carrying at least one skill: the measured count at the pinned sha, exact for the same reason the asset floors are. */
const MIN_SKILLED = 398;

/**
 * Floors for the asset manifest, set to what the A3 publish actually produced. These are exact rather than slack like the counts above, because
 * the failure they catch is the pipeline claiming fewer assets than it published. Nothing else in the pipeline notices that: `hasPortrait` reads a
 * missing id and a `false` id the same way, so an operator that quietly lost its art just renders a placeholder and no step complains.
 */
const MIN_PORTRAITS = 391;
const MIN_ILLUSTRATIONS = 412;

/** 410 operators have a parsed Basic Info at the pinned sha, 404 a parsed Physical Exam. Robots and a few others use their own labels or none. */
const MIN_RECORD_BASIC = 400;
const MIN_RECORD_EXAM = 395;

// This count is duplicated from `tools/data/lib/record.mjs`'s `GRADES` on purpose. The gate checks the importer's output, so importing the
// importer's own scale here would make a bad scale pass its own test - the same reasoning as the `PLACEHOLDER` pattern above.
const RECORD_GRADE_COUNT = 7;

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
const MARKUP = /<[^>]+>|\{-?[a-zA-Z@][^}]*\}/;

// This pattern is duplicated from `tools/data/lib/text.mjs` on purpose. The importer's `isPlaceholder` exists to filter this out at import
// time, so this gate exists to verify that filtering actually worked - importing the importer's own pattern here would make a bad filter pass
// its own test. Keep this copy independent.
/** The locked placeholder upstream ships for handbook content not yet unlocked. Any of it in shipped text means the profile filter missed it. */
const PLACEHOLDER = /^[？?\s]+$/;

/** A base skill's room must resolve to a display name such as "Trading Post". All-caps like TRADING means the room lookup missed it. */
const RAW_ROOM_ENUM = /^[A-Z_]+$/;

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
		throw new Error(`${file} is missing - run \`pnpm run import\` first`);
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

// Read each shard's operators and its profile side file exactly once. Every check below indexes into these maps instead of re-reading and
// re-parsing the same JSON - the shards total 1050 KB and the profiles 3.87 MB, and several checks below need both files.
const shardOperators = new Map(SHARDS.map((shard) => [shard.key, read(shard.file)]));
const shardProfiles = new Map(SHARDS.map((shard) => [shard.key, read(shard.profiles)]));

const operators = SHARDS.flatMap((shard) => shardOperators.get(shard.key));
const byId = new Map(operators.map((operator) => [operator.id, operator]));

// Counts.
if (operators.length < MIN_COUNTS.total) {
	fail(`${operators.length} operators, below the floor of ${MIN_COUNTS.total}`);
}
for (const shard of SHARDS) {
	const count = shardOperators.get(shard.key).length;
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
	if (!Array.isArray(operator.tags)) {
		fail(`${operator.id} has no tags array`);
	} else if (operator.tags.some((tag) => typeof tag !== "string" || !tag.trim())) {
		fail(`${operator.id} carries a blank tag`);
	}
}

// Talents. Every operator has at least one at the pinned sha, and a talent with no usable candidate means the filter dropped too much.
let withTalents = 0;
for (const operator of operators) {
	if (!Array.isArray(operator.talents)) {
		fail(`${operator.id} has no talents array`);
		continue;
	}
	if (operator.talents.length > 0) {
		withTalents += 1;
	}
	for (const [index, talent] of operator.talents.entries()) {
		if (!Array.isArray(talent.candidates) || talent.candidates.length === 0) {
			fail(`${operator.id} talent ${index} has no candidates`);
			continue;
		}
		for (const candidate of talent.candidates) {
			if (!candidate.name || PLACEHOLDER.test(candidate.name)) {
				fail(`${operator.id} talent ${index} kept a placeholder candidate: ${JSON.stringify(candidate.name)}`);
			}
			if (!(candidate.requiredPotential >= 1 && candidate.requiredPotential <= 6)) {
				fail(`${operator.id} talent ${index} has requiredPotential ${candidate.requiredPotential}, outside 1-6`);
			}
			if (!(candidate.unlockPhase >= 0 && candidate.unlockPhase <= 2)) {
				fail(`${operator.id} talent ${index} has unlockPhase ${candidate.unlockPhase}, outside 0-2`);
			}
		}
	}
}
if (withTalents < MIN_TALENTS) {
	fail(`${withTalents} operators have talents, below the floor of ${MIN_TALENTS}`);
}

// Potential ranks. Rank 1 is the base state and has no entry, so the ranks run 2 upward. Whether an operator has a CUSTOM one at all varies:
// across the 412 operators, 79 have none, 281 have one, 43 have two, and 9 have five.
let withPotentials = 0;
for (const operator of operators) {
	if (!Array.isArray(operator.potentials)) {
		fail(`${operator.id} has no potentials array`);
		continue;
	}
	if (operator.potentials.length > 0) {
		withPotentials += 1;
	}
	for (const [index, potential] of operator.potentials.entries()) {
		if (potential.rank !== index + 2) {
			fail(`${operator.id} potential ${index} is numbered ${potential.rank}, expected ${index + 2}`);
		}
		if (potential.type !== "BUFF" && potential.type !== "CUSTOM") {
			fail(`${operator.id} potential ${potential.rank} has type ${potential.type}`);
		}
		if (!potential.description) {
			fail(`${operator.id} potential ${potential.rank} has no description`);
		}
	}
}
if (withPotentials < MIN_POTENTIALS) {
	fail(`${withPotentials} operators have potential ranks, below the floor of ${MIN_POTENTIALS}`);
}

// Forms. The page's chips, backdrop and art card all key off these, so a missing array or a duplicated key breaks switching quietly.
let withForms = 0;
for (const operator of operators) {
	if (!Array.isArray(operator.forms)) {
		fail(`${operator.id} has no forms array`);
		continue;
	}
	if (operator.forms.length > 0) {
		withForms += 1;
	}
	const seen = new Set();
	for (const form of operator.forms) {
		if (!form.key || !form.name) {
			fail(`${operator.id} has a form with an empty key or name`);
		}
		if (seen.has(form.key)) {
			fail(`${operator.id} lists form ${form.key} twice`);
		}
		seen.add(form.key);
	}
}
if (withForms < MIN_FORMS) {
	fail(`${withForms} operators have forms, below the floor of ${MIN_FORMS}`);
}

// Skills: every operator that has any has a sane shape, and the count holds.
let withSkills = 0;
for (const operator of operators) {
	if (operator.skills.length > 0) {
		withSkills += 1;
	}
	for (const skill of operator.skills) {
		if (skill.levels.length !== 7 && skill.levels.length !== 10) {
			fail(`${operator.id} skill ${skill.id} has ${skill.levels.length} levels, not 7 or 10`);
		}
		if (!/^[a-z0-9_]+$/.test(skill.icon)) {
			fail(`${operator.id} skill ${skill.id} has an unpublishable icon key ${JSON.stringify(skill.icon)}`);
		}
		for (const level of skill.levels) {
			if (level.description.length === 0) {
				fail(`${operator.id} skill ${skill.id} has a level with no description`);
			}
			const joined = level.description.map((run) => run.text).join("");
			if (joined.includes("  ")) {
				fail(`${operator.id} skill ${skill.id} has a doubled space in its description: ${JSON.stringify(joined)}`);
			}
		}
	}
}
if (withSkills < MIN_SKILLED) {
	fail(`${withSkills} operators have skills, below the floor of ${MIN_SKILLED}`);
}

// Markup leakage, across everything the site ships.
for (const shard of SHARDS) {
	for (const [data, name] of [
		[shardOperators.get(shard.key), shard.file],
		[shardProfiles.get(shard.key), shard.profiles]
	]) {
		eachString(data, name, (text, where) => {
			const hit = MARKUP.exec(text);
			if (hit) {
				fail(`markup leaked into ${where}: ${JSON.stringify(hit[0])}`);
			}
		});
	}
}

// Every operator must have an entry in its class's profile file. The page loads the shard and the side file separately, so one missing from
// the side file would quietly render as an operator with no handbook at all rather than as a broken import.
let withProfiles = 0;
for (const shard of SHARDS) {
	const profiles = shardProfiles.get(shard.key);
	for (const operator of shardOperators.get(shard.key)) {
		if (Object.hasOwn(profiles, operator.id)) {
			withProfiles += 1;
		} else {
			fail(`${operator.id} is in ${shard.file} but has no entry in ${shard.profiles}`);
		}
	}
}

// The handbook record. Its sections must have moved out of the lore, and every grade must sit on the scale the record bar draws.
let withBasic = 0;
let withExam = 0;
for (const shard of SHARDS) {
	const profiles = shardProfiles.get(shard.key);
	for (const operator of shardOperators.get(shard.key)) {
		const { basic, exam } = operator.record;
		if (basic.length > 0) {
			withBasic += 1;
		}
		if (exam.length > 0) {
			withExam += 1;
		}
		for (const field of [...basic, ...exam]) {
			if (!field.label) {
				fail(`${operator.id} has a record field with no label`);
			}
			if (field.grade !== null && (field.grade < 1 || field.grade > RECORD_GRADE_COUNT)) {
				fail(`${operator.id} grades ${field.label} ${field.grade}, off the ${RECORD_GRADE_COUNT}-step scale`);
			}
		}
		// A record-titled section is allowed to remain in the lore - that's how Amiya's second dossier survives - but only when something
		// proves it is a genuine second dossier and not splitRecord failing to remove what it already captured. Content alone cannot always
		// tell the two apart: Amiya's two Physical Exams happen to carry identical grades, even though her two Basic Infos plainly differ.
		// So a leftover only counts as proven-genuine when at least one of this operator's leftover record sections differs from its
		// captured slot - Amiya clears that bar on Basic Info, which is enough to trust her matching Physical Exam too. An operator whose
		// every leftover record section matches its capture has no such evidence, so those matches mean removal failed.
		const lore = profiles[operator.id]?.lore ?? [];
		const candidates = [];
		for (const section of lore) {
			const slotFields = section.title === "Basic Info" ? basic : section.title === "Physical Exam" ? exam : null;
			if (slotFields === null || slotFields.length === 0) {
				continue;
			}
			const matches = JSON.stringify(parseRecord(section.text)) === JSON.stringify(slotFields);
			candidates.push({ title: section.title, matches });
		}
		if (candidates.length > 0 && candidates.every((candidate) => candidate.matches)) {
			for (const candidate of candidates) {
				fail(`${operator.id} still carries ${candidate.title} in its lore after parsing it`);
			}
		}
	}
}
if (withBasic < MIN_RECORD_BASIC) {
	fail(`${withBasic} operators have a basic record, below the floor of ${MIN_RECORD_BASIC}`);
}
if (withExam < MIN_RECORD_EXAM) {
	fail(`${withExam} operators have an exam record, below the floor of ${MIN_RECORD_EXAM}`);
}

// Profile placeholders. Upstream ships a locked handbook entry as literal full-width question marks for content not yet unlocked, and it must
// not survive the import - Amiya carries the only one at the pinned sha, in her lore. Base skills are walked too since they come from the same
// handbook parse, though they now ride in the shard rather than the side file.
for (const shard of SHARDS) {
	const profiles = shardProfiles.get(shard.key);
	for (const operator of shardOperators.get(shard.key)) {
		const lore = profiles[operator.id]?.lore ?? [];
		for (const [index, section] of lore.entries()) {
			if (PLACEHOLDER.test(section.title) || PLACEHOLDER.test(section.text)) {
				fail(`${operator.id} lore section ${index} kept a placeholder: ${JSON.stringify(section.title)} / ${JSON.stringify(section.text)}`);
			}
		}
		for (const [index, skill] of operator.baseSkills.entries()) {
			if (PLACEHOLDER.test(skill.name ?? "") || PLACEHOLDER.test(skill.description ?? "")) {
				fail(`${operator.id} base skill ${index} kept a placeholder: ${JSON.stringify(skill.name)}`);
			}
			if (RAW_ROOM_ENUM.test(skill.room ?? "")) {
				fail(`${operator.id} base skill ${index} has an unresolved room: ${JSON.stringify(skill.room)}`);
			}
		}
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

// The trust bonus must be exactly what `trusted` adds over the last phase's max. This is what catches a bonus read from the wrong keyframe.
for (const operator of operators) {
	const last = operator.stats.phases[operator.stats.phases.length - 1];
	const bonus = operator.stats.trustBonus;
	if (!bonus) {
		fail(`${operator.id} has no stats.trustBonus`);
		continue;
	}
	for (const field of ["maxHp", "atk", "def", "magicResistance"]) {
		const want = operator.stats.trusted[field];
		const got = last.max[field] + bonus[field];
		if (got !== want) {
			fail(`${operator.id} trust bonus for ${field} gives ${got}, but trusted says ${want}`);
		}
	}
}

// The asset manifest, once A3 has produced one. Guarded because this gate runs on every import, including before any manifest exists. Every
// id the manifest names in any of its three sections must be an operator this import also knows about - an id the pipeline names that no
// operator has means the pipeline and the importer disagree about who exists.
const manifestPath = path.join(OUT_DIR, "assets-manifest.json");
const hasManifest = fs.existsSync(manifestPath);
let portraitCount = 0;
let illustrationCount = 0;
if (hasManifest) {
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	for (const [section, entries] of Object.entries(manifest)) {
		// The variants section has a nested structure with portraits and illustrations keys
		if (section === "variants") {
			for (const [kind, kindEntries] of Object.entries(entries)) {
				for (const id of Object.keys(kindEntries)) {
					if (!byId.has(id)) {
						fail(`asset manifest names ${id} in ${section}.${kind}, which is in no shard`);
					}
				}
			}
		} else {
			for (const id of Object.keys(entries)) {
				if (!byId.has(id)) {
					fail(`asset manifest names ${id} in ${section}, which is in no shard`);
				}
			}
		}
	}
	// Count the operators the manifest says have art, not the operators it names. It names all 412 either way, so counting keys would make the
	// floors below unfalsifiable - a manifest with every entry `false` would sail through them.
	portraitCount = Object.values(manifest.portraits ?? {}).filter(Boolean).length;
	illustrationCount = Object.values(manifest.illustrations ?? {}).filter(Boolean).length;
	if (portraitCount < MIN_PORTRAITS) {
		fail(`asset manifest records ${portraitCount} portraits, below the floor of ${MIN_PORTRAITS}`);
	}
	if (illustrationCount < MIN_ILLUSTRATIONS) {
		fail(`asset manifest records ${illustrationCount} illustrations, below the floor of ${MIN_ILLUSTRATIONS}`);
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
console.log(`talents    ${withTalents} operators carry at least one`);
console.log(`potentials  ${withPotentials} operators carry at least one`);
console.log(`forms       ${withForms} operators carry at least one`);
console.log(`skills      ${withSkills} operators`);
console.log(`profiles    ${withProfiles} operators carry a side-file entry`);
console.log(`record      ${withBasic} basic, ${withExam} exam`);
console.log("markup      none leaked");
console.log("placeholders none leaked");
if (hasManifest) {
	console.log(`assets      ${portraitCount} portraits, ${illustrationCount} illustrations`);
}

if (!process.argv.includes("--skip-build")) {
	console.log("\nrunning pnpm build...");
	execFileSync("pnpm", ["build"], { stdio: "inherit" });
}
console.log("\nOK");
