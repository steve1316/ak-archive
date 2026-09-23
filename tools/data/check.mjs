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

/** The asset manifest sections keyed by operator id. Every other section is a flat key list or keyed by enemy id. */
const OPERATOR_SECTIONS = new Set(["portraits", "illustrations", "skins", "variants"]);

/** Module floors at the pinned sha: every ADVANCED module of an imported operator. */
const MIN_MODULES = 473;
const MIN_MODULE_OPERATORS = 371;

/**
 * Module stages checked by hand against the upstream tables. Ch'en's SWO-X adds ATK and ASPD, appends to her trait and upgrades Scolding.
 * SWO-Y upgrades Blade Art with a P1 and a P5 version. Whislash's module replaces her trait and adds a talent she has no other way to get.
 */
const MODULE_FIXTURES = [
	{ id: "char_010_chen", module: "uniequip_002_chen", stage: 3, stats: { atk: 80, aspd: 7 }, trait: "append", talents: [[0, 1]] },
	{
		id: "char_010_chen",
		module: "uniequip_003_chen",
		stage: 2,
		stats: { atk: 68, def: 36 },
		trait: "append",
		talents: [
			[1, 1],
			[1, 5]
		]
	},
	{ id: "char_265_sophia", module: "uniequip_002_sophia", stage: 3, trait: "replace", talents: [[null, 1]] }
];

/**
 * Floors for the asset manifest, set to what the A3 publish actually produced. These are exact rather than slack like the counts above, because
 * the failure they catch is the pipeline claiming fewer assets than it published. Nothing else in the pipeline notices that: `hasPortrait` reads a
 * missing id and a `false` id the same way, so an operator that quietly lost its art just renders a placeholder and no step complains.
 */
const MIN_PORTRAITS = 391;
const MIN_ILLUSTRATIONS = 412;
const MIN_ENEMY_ICONS = 1560;

/**
 * Floors for the Spine index, set to what the first full index produced: 412 operators, 924 forms, 2743 rigs. Exact rather than slack for the
 * same reason the asset floors are - the failure this catches is the index quietly losing rigs, not the roster shrinking.
 */
const MIN_SPINE_OPERATORS = 412;
const MIN_SPINE_FORMS = 924;
const MIN_SPINE_RIGS = 2743;
const MIN_SPINE_BATTLE_RIGS = 918;
const MIN_SPINE_BACK_RIGS = 907;
const MIN_SPINE_DORM_RIGS = 918;

/**
 * Floor for operators whose base battle rig the current runtime draws in full: the runtime's supported stage or below. Every operator
 * since path constraints landed: 412 of 412.
 */
const MIN_SPINE_PLAYABLE_OPERATORS = 412;

/** Enemy rigs at the pinned Ark-Models sha: the count the first full index produced. */
const MIN_ENEMY_SPINE_RIGS = 1537;

/** Enemy rigs the current runtime draws in full. Every one since path constraints landed: 1537 of 1537. */
const MIN_ENEMY_SPINE_PLAYABLE = 1537;

/**
 * The runtime's supported stage, and the highest stage it plans for, both read out of `src/spine/features.ts` so this gate never drifts
 * from what the runtime actually draws. A regex read rather than an import, since this script is plain Node and that file is TypeScript.
 */
const { supported: SPINE_PLAYABLE_STAGE, highest: SPINE_HIGHEST_STAGE } = readSpineStages();

/** The three kinds a Spine rig can be indexed under - the site never plays a fourth. */
const SPINE_KINDS = ["battle", "back", "dorm"];

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

/**
 * Text that must survive markup stripping. Upstream wraps some game terms in angle brackets, such as `<Substitute>`, and those are content,
 * not styling, so the word has to reach the page.
 */
const TEXT_FIXTURES = [
	{ id: "char_1023_ghost2", read: (operator) => operator.description, includes: "swaps to a Substitute" },
	{ id: "char_4072_ironmn", read: (operator) => operator.talents[0]?.candidates[0]?.description, includes: "carry 2 Support Devices" }
];

/** Enemy counts at the pinned sha: 1560 visible handbook entries in 971 groups. Floors, since upstream only grows. */
const MIN_ENEMY_VARIANTS = 1560;
const MIN_ENEMY_GROUPS = 971;

/** The enemy details files, one per level. `tools/data/import.mjs` names them from the head's level. */
const ENEMY_DETAIL_FILES = ["enemy-details-normal", "enemy-details-elite", "enemy-details-leader"];

/**
 * Enemy stats read straight from upstream, one level each. Patriot guards level 0. The Originium Slug's level 1 sets only its HP and ATK, so
 * its DEF and attack interval must still be level 0's - that is what catches a later level read on its own rather than laid over level 0.
 */
const ENEMY_FIXTURES = [
	{ id: "enemy_1506_patrt", level: 0, maxHp: 45000, atk: 1600, def: 500, magicResistance: 45, attackTime: 4 },
	{ id: "enemy_1007_slime", level: 1, maxHp: 2050, atk: 300, def: 0, magicResistance: 0, attackTime: 1.7 }
];

/** A release day. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Operators with a release date at the first snapshot: 404 of 412. The rest are event-only oddities the wiki cannot date. */
const MIN_OPERATOR_DATES = 400;

/** Enemy groups with a release date at the first snapshot: 796 of 971. The rest only appear in Supply, Annihilation, SSS or roguelike stages. */
const MIN_ENEMY_DATES = 796;

/** Hand-checked against the wiki. Exusiai is a launch operator, Myrtle debuted with Heart of Surging Flame Part 1, Mizuki with Dossoles Holiday. */
const DATE_FIXTURES = [
	{ id: "char_103_angel", date: "2020-01-16" },
	{ id: "char_151_myrtle", date: "2020-04-15" },
	{ id: "char_437_mizuki", date: "2022-01-14" }
];

/**
 * The Originium Slug is in the prologue, which shipped at launch. `enemy_10071_ftprg` debuted in When Elegies Are Ashes, whose stages now sit in its
 * 2026 rerun's zone, so it guards against dating an enemy by a rerun.
 */
const ENEMY_DATE_FIXTURES = [
	{ id: "enemy_1007_slime", date: "2020-01-16" },
	{ id: "enemy_10071_ftprg", date: "2025-08-28" }
];

/** Hand-checked outfit dates. Midnight Delivery reached Global on 2023-02-22. Base art has no date of its own - it is the operator's release. */
const FORM_DATE_FIXTURES = [
	{ id: "char_103_angel", key: "sale_8", date: "2023-02-22" },
	{ id: "char_103_angel", key: "1", date: null }
];

/** Exusiai's chips, oldest outfit first after her default art: Wild Operation (2020), Midnight Delivery (2023), City Rider (2024). */
const FORM_ORDER_FIXTURES = [{ id: "char_103_angel", keys: ["1", "2", "wild_1", "sale_8", "kfc_1"] }];

/** Hand-checked debut lines: a launch enemy, a main story boss that arrived later, and an event enemy whose event has since rerun. */
const ENEMY_DEBUT_FIXTURES = [
	{ id: "enemy_1007_slime", debut: "Game launch" },
	{ id: "enemy_1506_patrt", debut: "Episode 7: The Birth of Tragedy" },
	{ id: "enemy_10071_ftprg", debut: "When Elegies Are Ashes" }
];

/**
 * Hand-checked range ids. Ch'en the Holungday grows at E1, has a front-row trait area and an S3 that widens her range. Swire's S1 changes range at
 * level 7, which is why ranges are kept per skill level rather than per skill.
 */
const RANGE_FIXTURES = [
	{ id: "char_1013_chen2", phases: ["2-4", "2-5", "2-5"], trait: "1-3", skill: "skchr_chen2_3", skillLevels: { 0: "2-6", 9: "2-6" } },
	{ id: "char_308_swire", skill: "skchr_swire_1", skillLevels: { 0: "x-1", 5: "x-1", 6: "x-2", 9: "x-2" } }
];

/**
 * Skills that stretch the normal range through a blackboard value rather than a range id. Surtr's S3 adds 2 tiles, Narantuya's S1 takes one away, and
 * Weedy's S2 grows from 1 to 2 at M2. A skill without the value carries no `rangeExtend` at all.
 */
const RANGE_EXTEND_FIXTURES = [
	{ id: "char_350_surtr", skill: "skchr_surtr_3", levels: { 0: 2, 9: 2 } },
	{ id: "char_4138_narant", skill: "skchr_narant_1", levels: { 9: -1 } },
	{ id: "char_400_weedy", skill: "skchr_weedy_2", levels: { 0: 1, 7: 1, 8: 2 } },
	{ id: "char_103_angel", skill: "skchr_angel_1", levels: { 9: undefined } }
];

/** The handbook's grade scale, best first. */
const ENEMY_GRADES = ["SS", "S+", "S", "A+", "A", "B+", "B", "C", "D", "E"];

/** The game's inline markup. Any of it in shipped text means `stripMarkup` missed a field. */
const MARKUP = /<[^>]+>|\{-?[a-zA-Z@][^}]*\}/;

// This pattern is duplicated from `tools/data/lib/text.mjs` on purpose. The importer's `isPlaceholder` exists to filter this out at import
// time, so this gate exists to verify that filtering actually worked - importing the importer's own pattern here would make a bad filter pass
// its own test. Keep this copy independent.
/** The locked placeholder upstream ships for handbook content not yet unlocked. Any of it in shipped text means the profile filter missed it. */
const PLACEHOLDER = /^[？?\s]+$/;

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
 * Reads `SUPPORTED_STAGE` and the highest stage `STAGE_FEATURES` plans for out of `src/spine/features.ts`. `SUPPORTED_STAGE` is a plain
 * `export const` number. The highest stage is `STAGE_ADDS.length`, counted from the number of top-level arrays in that constant's literal.
 *
 * @returns {{ supported: number, highest: number }} The runtime's supported stage and the highest stage it plans for.
 */
function readSpineStages() {
	const source = fs.readFileSync("src/spine/features.ts", "utf8");
	const supportedMatch = source.match(/export const SUPPORTED_STAGE = (\d+);/);
	const addsMatch = source.match(/const STAGE_ADDS: readonly \(readonly Feature\[\]\)\[\] = \[\n([\s\S]*?)\n\];/);
	if (!supportedMatch || !addsMatch) {
		throw new Error("could not read the Spine stage numbers out of src/spine/features.ts");
	}
	const highest = (addsMatch[1].match(/^\t\[/gm) ?? []).length;
	return { supported: Number(supportedMatch[1]), highest };
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

/**
 * Check every entry's `releaseDate`: present, well formed when set, above a floor of dated entries, and equal to the hand-checked fixtures.
 *
 * @param {Array<{id: string, releaseDate?: string | null}>} entries The operators or enemy groups.
 * @param {string} label What the entries are, for messages.
 * @param {number} floor The fewest entries that must carry a date.
 * @param {Array<{id: string, date: string}>} fixtures Hand-checked dates.
 * @returns {number} How many entries carry a date.
 */
function checkDates(entries, label, floor, fixtures) {
	let dated = 0;
	for (const entry of entries) {
		if (entry.releaseDate === undefined) {
			fail(`${entry.id} has no releaseDate field`);
		} else if (entry.releaseDate !== null) {
			dated += 1;
			if (!DATE_PATTERN.test(entry.releaseDate)) {
				fail(`${entry.id} has a malformed releaseDate ${entry.releaseDate}`);
			}
		}
	}
	if (dated < floor) {
		fail(`${dated} ${label} have a release date, below the floor of ${floor}`);
	}
	const byEntryId = new Map(entries.map((entry) => [entry.id, entry]));
	for (const fixture of fixtures) {
		const actual = byEntryId.get(fixture.id)?.releaseDate;
		if (actual !== fixture.date) {
			fail(`${fixture.id} releaseDate is ${actual}, expected ${fixture.date}`);
		}
	}
	return dated;
}

// Read each shard's operators, profile side file and details file exactly once. Every check below indexes into these maps instead of
// re-reading and re-parsing the same JSON, since several checks below need two or three of the files.
const shardOperators = new Map(SHARDS.map((shard) => [shard.key, read(shard.file)]));
const shardProfiles = new Map(SHARDS.map((shard) => [shard.key, read(shard.profiles)]));
const shardDetails = new Map(SHARDS.map((shard) => [shard.key, read(shard.details)]));
const shardModuleLore = new Map(SHARDS.map((shard) => [shard.key, read(shard.moduleLore)]));

const operators = SHARDS.flatMap((shard) => shardOperators.get(shard.key));
const byId = new Map(operators.map((operator) => [operator.id, operator]));

// One lookup across every class's details file, keyed by operator id, so a check does not have to know which shard an operator is in.
const detailsById = new Map(SHARDS.flatMap((shard) => Object.entries(shardDetails.get(shard.key))));

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

// Regression gate: skills and record moved to the details file, so a shard record still carrying one means the importer regressed. Base
// skills were dropped from the site, so no file may carry them.
for (const operator of operators) {
	for (const field of ["skills", "record", "baseSkills"]) {
		if (Object.hasOwn(operator, field)) {
			fail(`${operator.id} in its shard still carries ${field}`);
		}
	}
	if (Object.hasOwn(detailsById.get(operator.id) ?? {}, "baseSkills")) {
		fail(`${operator.id} still carries baseSkills in its details file, which the site no longer shows`);
	}
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

// Bracketed game terms. A missing word here means `stripMarkup` deleted content along with the styling tags.
for (const fixture of TEXT_FIXTURES) {
	const text = byId.has(fixture.id) ? fixture.read(byId.get(fixture.id)) : undefined;
	if (typeof text !== "string" || !text.includes(fixture.includes)) {
		fail(`${fixture.id} text lost a bracketed term: expected ${JSON.stringify(fixture.includes)} in ${JSON.stringify(text)}`);
	}
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

// Skills: every operator that has any has a sane shape, and the count holds. Read from the details file, which is where skills now live.
let withSkills = 0;
for (const operator of operators) {
	const detail = detailsById.get(operator.id);
	if (!detail) {
		continue;
	}
	if (detail.skills.length > 0) {
		withSkills += 1;
	}
	for (const skill of detail.skills) {
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

// Modules. Each has three stages, a code and lowercase asset keys. A stage's talent index is a kept talent slot or null for a new talent.
let moduleCount = 0;
let withModules = 0;
for (const operator of operators) {
	const modules = detailsById.get(operator.id)?.modules;
	if (!Array.isArray(modules)) {
		fail(`${operator.id} has no modules array in its details file`);
		continue;
	}
	if (modules.length > 0) {
		withModules += 1;
	}
	moduleCount += modules.length;
	for (const module of modules) {
		if (module.stages.length !== 3) {
			fail(`${operator.id} module ${module.id} has ${module.stages.length} stages, not 3`);
		}
		if (!/^[A-Z]+-[A-Z]$/.test(module.code)) {
			fail(`${operator.id} module ${module.id} has code ${JSON.stringify(module.code)}`);
		}
		for (const key of [module.art, module.typeIcon]) {
			if (key !== key.toLowerCase()) {
				fail(`${operator.id} module ${module.id} has a non-lowercase asset key ${key}`);
			}
		}
		for (const [stageIndex, stage] of module.stages.entries()) {
			for (const talent of stage.talents) {
				const valid = talent.index === null ? Boolean(talent.name) : talent.index >= 0 && talent.index < operator.talents.length;
				if (!valid || !(talent.requiredPotential >= 1 && talent.requiredPotential <= 6) || !talent.description) {
					fail(`${operator.id} module ${module.id} stage ${stageIndex + 1} has a bad talent ${JSON.stringify(talent)}`);
				}
			}
		}
	}
}
if (moduleCount < MIN_MODULES || withModules < MIN_MODULE_OPERATORS) {
	fail(`${moduleCount} modules across ${withModules} operators, below the floor of ${MIN_MODULES} across ${MIN_MODULE_OPERATORS}`);
}
for (const fixture of MODULE_FIXTURES) {
	const module = detailsById.get(fixture.id)?.modules?.find((entry) => entry.id === fixture.module);
	const stage = module?.stages[fixture.stage - 1];
	if (!stage) {
		fail(`module fixture ${fixture.module} stage ${fixture.stage} is missing`);
		continue;
	}
	for (const [field, value] of Object.entries(fixture.stats ?? {})) {
		if (stage.stats[field] !== value) {
			fail(`${fixture.module} stage ${fixture.stage} ${field} is ${stage.stats[field]}, expected ${value}`);
		}
	}
	if (stage.trait?.mode !== fixture.trait) {
		fail(`${fixture.module} stage ${fixture.stage} trait mode is ${stage.trait?.mode}, expected ${fixture.trait}`);
	}
	const talents = stage.talents.map((talent) => [talent.index, talent.requiredPotential]);
	if (JSON.stringify(talents) !== JSON.stringify(fixture.talents)) {
		fail(`${fixture.module} stage ${fixture.stage} talents are ${JSON.stringify(talents)}, expected ${JSON.stringify(fixture.talents)}`);
	}
}

// Every module's lore must sit in its class's module lore file, since the Modules tab looks it up there by module id.
for (const shard of SHARDS) {
	const lore = shardModuleLore.get(shard.key);
	for (const operator of shardOperators.get(shard.key)) {
		for (const module of detailsById.get(operator.id)?.modules ?? []) {
			if (!lore[module.id]) {
				fail(`${operator.id} module ${module.id} has no lore in ${shard.moduleLore}`);
			}
		}
	}
}

// Markup leakage, across everything the site ships.
for (const shard of SHARDS) {
	for (const [data, name] of [
		[shardOperators.get(shard.key), shard.file],
		[shardProfiles.get(shard.key), shard.profiles],
		[shardDetails.get(shard.key), shard.details],
		[shardModuleLore.get(shard.key), shard.moduleLore]
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

// Every shard operator must have a details entry, and every details entry must belong to an operator in that shard - the two files are written
// from the same list, so a mismatch means the operator page would either 404 correctly or, worse, silently show an operator with no abilities.
let withDetails = 0;
for (const shard of SHARDS) {
	const details = shardDetails.get(shard.key);
	const shardIds = new Set(shardOperators.get(shard.key).map((operator) => operator.id));
	for (const operator of shardOperators.get(shard.key)) {
		if (Object.hasOwn(details, operator.id)) {
			withDetails += 1;
		} else {
			fail(`${operator.id} is in ${shard.file} but has no entry in ${shard.details}`);
		}
	}
	for (const id of Object.keys(details)) {
		if (!shardIds.has(id)) {
			fail(`${shard.details} names ${id}, which is not in ${shard.file}`);
		}
	}
}

// The handbook record. Its sections must have moved out of the lore, and every grade must sit on the scale the record bar draws. Read from the
// details file, which is where the record now lives.
let withBasic = 0;
let withExam = 0;
for (const shard of SHARDS) {
	const profiles = shardProfiles.get(shard.key);
	const details = shardDetails.get(shard.key);
	for (const operator of shardOperators.get(shard.key)) {
		const detail = details[operator.id];
		if (!detail) {
			continue;
		}
		const { basic, exam } = detail.record;
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
// not survive the import - Amiya carries the only one at the pinned sha, in her lore.
for (const shard of SHARDS) {
	const profiles = shardProfiles.get(shard.key);
	for (const operator of shardOperators.get(shard.key)) {
		const lore = profiles[operator.id]?.lore ?? [];
		for (const [index, section] of lore.entries()) {
			if (PLACEHOLDER.test(section.title) || PLACEHOLDER.test(section.text)) {
				fail(`${operator.id} lore section ${index} kept a placeholder: ${JSON.stringify(section.title)} / ${JSON.stringify(section.text)}`);
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

// Enemies. Every group's variants must have details, every variant exactly one group, and the search index must cover every variant.
const enemies = read("enemies");
const enemyDetails = Object.assign({}, ...ENEMY_DETAIL_FILES.map((name) => read(name)));
const enemyVariantIds = enemies.flatMap((enemy) => enemy.variants.map((variant) => variant.id));
if (enemies.length < MIN_ENEMY_GROUPS) {
	fail(`${enemies.length} enemy groups, below the floor of ${MIN_ENEMY_GROUPS}`);
}
if (enemyVariantIds.length < MIN_ENEMY_VARIANTS) {
	fail(`${enemyVariantIds.length} enemy variants, below the floor of ${MIN_ENEMY_VARIANTS}`);
}
if (new Set(enemyVariantIds).size !== enemyVariantIds.length) {
	fail("an enemy variant sits in more than one group");
}
for (const enemy of enemies) {
	if (enemy.variants[0]?.id !== enemy.id) {
		fail(`${enemy.id} does not list itself as its first variant`);
	}
}
for (const id of enemyVariantIds) {
	const detail = enemyDetails[id];
	if (!detail) {
		fail(`${id} is in enemies.json but has no details entry`);
		continue;
	}
	if (detail.levels.length === 0) {
		fail(`${id} has no stat levels`);
	}
	for (const level of detail.levels) {
		for (const [field, grade] of Object.entries(level.grades)) {
			if (!ENEMY_GRADES.includes(grade)) {
				fail(`${id} grades ${field} as ${JSON.stringify(grade)}, off the handbook scale`);
			}
		}
	}
}
if (Object.keys(enemyDetails).length !== enemyVariantIds.length) {
	fail(`enemy details hold ${Object.keys(enemyDetails).length} variants for ${enemyVariantIds.length} in enemies.json`);
}
for (const [data, name] of [
	[enemies, "enemies"],
	[enemyDetails, "enemy-details"]
]) {
	eachString(data, name, (text, where) => {
		const hit = MARKUP.exec(text);
		if (hit) {
			fail(`markup leaked into ${where}: ${JSON.stringify(hit[0])}`);
		}
	});
}
const enemySearchIndex = read("enemy-search-index");
if (enemySearchIndex.length !== enemyVariantIds.length) {
	fail(`enemy search index has ${enemySearchIndex.length} entries for ${enemyVariantIds.length} variants`);
}
for (const fixture of ENEMY_FIXTURES) {
	const stats = enemyDetails[fixture.id]?.levels[fixture.level]?.stats;
	if (!stats) {
		fail(`enemy fixture ${fixture.id} level ${fixture.level} is missing from the data`);
		continue;
	}
	for (const [field, want] of Object.entries(fixture)) {
		if (field !== "id" && field !== "level" && stats[field] !== want) {
			fail(`${fixture.id} level ${fixture.level} ${field} is ${stats[field]}, expected ${want}`);
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
let enemyIconCount = 0;
if (hasManifest) {
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	for (const [section, entries] of Object.entries(manifest)) {
		// Only the operator-keyed sections name operator ids. The flat key lists and the enemy map are checked on their own below.
		if (!OPERATOR_SECTIONS.has(section)) {
			continue;
		}
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
	// Enemy icons: every id must be a known variant, and the count must hold once enemy icons have been published at all.
	const enemyIconIds = Object.keys(manifest.enemies ?? {});
	const knownEnemies = new Set(enemies.flatMap((enemy) => enemy.variants.map((variant) => variant.id)));
	for (const id of enemyIconIds) {
		if (!knownEnemies.has(id)) {
			fail(`asset manifest names ${id} in enemies, which is not a known enemy`);
		}
	}
	enemyIconCount = Object.values(manifest.enemies ?? {}).filter(Boolean).length;
	if (enemyIconIds.length > 0 && enemyIconCount < MIN_ENEMY_ICONS) {
		fail(`asset manifest records ${enemyIconCount} enemy icons, below the floor of ${MIN_ENEMY_ICONS}`);
	}
	// Every skill a page can show must have its icon published. A missing one would render a broken image in the Skills tab.
	const skillIcons = new Set(manifest.skillIcons ?? []);
	for (const operator of operators) {
		const detail = detailsById.get(operator.id);
		for (const skill of detail?.skills ?? []) {
			if (!skillIcons.has(skill.icon)) {
				fail(`${operator.id} skill ${skill.id} has no published icon ${skill.icon}`);
			}
		}
	}
	// Module art and badges, once the pipeline has published them. Before that the page shows placeholders.
	if (Array.isArray(manifest.moduleArt) && Array.isArray(manifest.moduleTypes)) {
		const moduleArt = new Set(manifest.moduleArt);
		const moduleTypes = new Set(manifest.moduleTypes);
		for (const operator of operators) {
			for (const module of detailsById.get(operator.id)?.modules ?? []) {
				if (!moduleArt.has(module.art)) {
					fail(`${operator.id} module ${module.id} has no published art ${module.art}`);
				}
				if (!moduleTypes.has(module.typeIcon)) {
					fail(`${operator.id} module ${module.id} has no published badge ${module.typeIcon}`);
				}
			}
		}
	}
}

// The Spine index is committed, so a missing one fails. Checks that every indexed operator is real, every form's kinds are one of the three
// the viewer plays, and every rig has a skeleton, an atlas and at least one animation - a rig missing any of those would render a blank card
// instead of a broken import.
const spineIndexPath = path.join(OUT_DIR, "spine-index.json");
const hasSpineIndex = fs.existsSync(spineIndexPath);
if (!hasSpineIndex) {
	fail(`${spineIndexPath} is missing`);
}
let spineOperatorCount = 0;
let spineFormCount = 0;
let spineRigCount = 0;
let spinePlayableCount = 0;
const spineKindCounts = { battle: 0, back: 0, dorm: 0 };
if (hasSpineIndex) {
	const spineIndex = JSON.parse(fs.readFileSync(spineIndexPath, "utf8"));
	for (const [operatorId, forms] of Object.entries(spineIndex)) {
		spineOperatorCount += 1;
		if (forms.base?.battle?.stage <= SPINE_PLAYABLE_STAGE) {
			spinePlayableCount += 1;
		}
		if (!byId.has(operatorId)) {
			fail(`spine index names ${operatorId}, which is in no shard`);
		}
		for (const [formKey, kinds] of Object.entries(forms)) {
			spineFormCount += 1;
			for (const [kind, rig] of Object.entries(kinds)) {
				if (!SPINE_KINDS.includes(kind)) {
					fail(`${operatorId} form ${formKey} has kind ${kind}, not one of ${SPINE_KINDS.join(", ")}`);
					continue;
				}
				spineRigCount += 1;
				spineKindCounts[kind] += 1;
				if (!rig.skel || rig.skel.includes("/") || rig.skel.includes("\\")) {
					fail(`${operatorId} form ${formKey} kind ${kind} has a bad skel basename: ${JSON.stringify(rig.skel)}`);
				}
				if (!rig.atlas || rig.atlas.includes("/") || rig.atlas.includes("\\")) {
					fail(`${operatorId} form ${formKey} kind ${kind} has a bad atlas basename: ${JSON.stringify(rig.atlas)}`);
				}
				if (!Array.isArray(rig.anims) || rig.anims.length === 0) {
					fail(`${operatorId} form ${formKey} kind ${kind} has no animations`);
				}
				if (!Number.isInteger(rig.stage) || rig.stage < 1 || rig.stage > SPINE_HIGHEST_STAGE) {
					fail(`${operatorId} form ${formKey} kind ${kind} has a bad stage: ${JSON.stringify(rig.stage)}`);
				}
			}
		}
	}
	if (spinePlayableCount < MIN_SPINE_PLAYABLE_OPERATORS) {
		fail(`spine index has ${spinePlayableCount} operators with a base battle rig at stage ${SPINE_PLAYABLE_STAGE} or below, below the floor of ${MIN_SPINE_PLAYABLE_OPERATORS}`);
	}
	if (spineOperatorCount < MIN_SPINE_OPERATORS) {
		fail(`spine index has ${spineOperatorCount} operators, below the floor of ${MIN_SPINE_OPERATORS}`);
	}
	if (spineFormCount < MIN_SPINE_FORMS) {
		fail(`spine index has ${spineFormCount} forms, below the floor of ${MIN_SPINE_FORMS}`);
	}
	if (spineRigCount < MIN_SPINE_RIGS) {
		fail(`spine index has ${spineRigCount} rigs, below the floor of ${MIN_SPINE_RIGS}`);
	}
	if (spineKindCounts.battle < MIN_SPINE_BATTLE_RIGS) {
		fail(`spine index has ${spineKindCounts.battle} battle rigs, below the floor of ${MIN_SPINE_BATTLE_RIGS}`);
	}
	if (spineKindCounts.back < MIN_SPINE_BACK_RIGS) {
		fail(`spine index has ${spineKindCounts.back} back rigs, below the floor of ${MIN_SPINE_BACK_RIGS}`);
	}
	if (spineKindCounts.dorm < MIN_SPINE_DORM_RIGS) {
		fail(`spine index has ${spineKindCounts.dorm} dorm rigs, below the floor of ${MIN_SPINE_DORM_RIGS}`);
	}
}

// The enemy rig index is committed, so a missing one fails. Every rig must belong to a known enemy variant and carry a skeleton, an atlas,
// at least one animation and a planned stage.
const enemySpineIndexPath = path.join(OUT_DIR, "enemy-spine-index.json");
let enemySpineCount = 0;
let enemySpinePlayable = 0;
if (!fs.existsSync(enemySpineIndexPath)) {
	fail(`${enemySpineIndexPath} is missing`);
} else {
	const known = new Set(enemyVariantIds);
	for (const [enemyId, rig] of Object.entries(JSON.parse(fs.readFileSync(enemySpineIndexPath, "utf8")))) {
		enemySpineCount += 1;
		if (!known.has(enemyId)) {
			fail(`enemy spine index names ${enemyId}, which is not a known enemy`);
		}
		for (const field of ["skel", "atlas"]) {
			if (!rig[field] || rig[field].includes("/") || rig[field].includes("\\")) {
				fail(`${enemyId} has a bad ${field} basename: ${JSON.stringify(rig[field])}`);
			}
		}
		if (!Array.isArray(rig.anims) || rig.anims.length === 0) {
			fail(`${enemyId} rig has no animations`);
		}
		if (!Number.isInteger(rig.stage) || rig.stage < 1 || rig.stage > SPINE_HIGHEST_STAGE) {
			fail(`${enemyId} rig has a bad stage: ${JSON.stringify(rig.stage)}`);
		} else if (rig.stage <= SPINE_PLAYABLE_STAGE) {
			enemySpinePlayable += 1;
		}
	}
	if (enemySpineCount < MIN_ENEMY_SPINE_RIGS) {
		fail(`enemy spine index has ${enemySpineCount} rigs, below the floor of ${MIN_ENEMY_SPINE_RIGS}`);
	}
	if (enemySpinePlayable < MIN_ENEMY_SPINE_PLAYABLE) {
		fail(`enemy spine index has ${enemySpinePlayable} playable rigs, below the floor of ${MIN_ENEMY_SPINE_PLAYABLE}`);
	}
}

const operatorDates = checkDates(operators, "operators", MIN_OPERATOR_DATES, DATE_FIXTURES);
const enemyDates = checkDates(enemies, "enemy groups", MIN_ENEMY_DATES, ENEMY_DATE_FIXTURES);

const ranges = read("ranges");
for (const operator of operators) {
	operator.stats.phases.forEach((phase, index) => {
		if (!ranges[phase.rangeId]) {
			fail(`${operator.id} E${index} has range ${phase.rangeId}, which ranges.json does not know`);
		}
	});
	if (operator.traitRangeId !== null && !ranges[operator.traitRangeId]) {
		fail(`${operator.id} has trait range ${operator.traitRangeId}, which ranges.json does not know`);
	}
}
for (const [id, entry] of detailsById) {
	for (const skill of entry.skills) {
		skill.levels.forEach((level, index) => {
			if (level.rangeId !== null && !ranges[level.rangeId]) {
				fail(`${id} ${skill.id} level ${index} has range ${level.rangeId}, which ranges.json does not know`);
			}
		});
	}
}
for (const fixture of RANGE_FIXTURES) {
	const operator = byId.get(fixture.id);
	if (fixture.phases && JSON.stringify(operator?.stats.phases.map((phase) => phase.rangeId)) !== JSON.stringify(fixture.phases)) {
		fail(`${fixture.id} phase ranges are not ${fixture.phases.join(", ")}`);
	}
	if (fixture.trait && operator?.traitRangeId !== fixture.trait) {
		fail(`${fixture.id} trait range is ${operator?.traitRangeId}, expected ${fixture.trait}`);
	}
	const skill = detailsById.get(fixture.id)?.skills.find((entry) => entry.id === fixture.skill);
	for (const [index, expected] of Object.entries(fixture.skillLevels)) {
		if (skill?.levels[Number(index)]?.rangeId !== expected) {
			fail(`${fixture.id} ${fixture.skill} level ${index} range is ${skill?.levels[Number(index)]?.rangeId}, expected ${expected}`);
		}
	}
}

for (const fixture of RANGE_EXTEND_FIXTURES) {
	const skill = detailsById.get(fixture.id)?.skills.find((entry) => entry.id === fixture.skill);
	if (!skill) {
		fail(`${fixture.id} has no skill ${fixture.skill}`);
		continue;
	}
	for (const [index, expected] of Object.entries(fixture.levels)) {
		if (skill.levels[Number(index)]?.rangeExtend !== expected) {
			fail(`${fixture.id} ${fixture.skill} level ${index} rangeExtend is ${skill.levels[Number(index)]?.rangeExtend}, expected ${expected}`);
		}
	}
}

for (const [id, detail] of Object.entries(enemyDetails)) {
	if (detail.debut === undefined) {
		fail(`${id} has no debut field`);
	} else if ((detail.debut === null) !== (detail.releaseDate === null)) {
		fail(`${id} has a debut without a release date or the other way round`);
	}
}
for (const operator of operators) {
	for (const form of operator.forms) {
		if (form.releaseDate === undefined) {
			fail(`${operator.id} form ${form.key} has no releaseDate field`);
		} else if (form.releaseDate !== null && !DATE_PATTERN.test(form.releaseDate)) {
			fail(`${operator.id} form ${form.key} has a malformed releaseDate ${form.releaseDate}`);
		}
	}
}
for (const operator of operators) {
	// Default art comes first, then outfits oldest to newest.
	const dates = operator.forms.map((form) => form.releaseDate);
	const firstOutfit = dates.findIndex((date) => date !== null);
	if (firstOutfit !== -1 && dates.slice(firstOutfit).some((date, index, list) => date === null || (index > 0 && date < list[index - 1]))) {
		fail(`${operator.id} forms are not default art first, then outfits oldest to newest`);
	}
}
for (const fixture of FORM_ORDER_FIXTURES) {
	const actual = byId
		.get(fixture.id)
		?.forms.map((form) => form.key)
		.join(", ");
	if (actual !== fixture.keys.join(", ")) {
		fail(`${fixture.id} forms are ${actual}, expected ${fixture.keys.join(", ")}`);
	}
}
for (const fixture of FORM_DATE_FIXTURES) {
	const actual = byId.get(fixture.id)?.forms.find((form) => form.key === fixture.key)?.releaseDate;
	if (actual !== fixture.date) {
		fail(`${fixture.id} form ${fixture.key} releaseDate is ${actual}, expected ${fixture.date}`);
	}
}
for (const fixture of ENEMY_DEBUT_FIXTURES) {
	const actual = enemyDetails[fixture.id]?.debut;
	if (actual !== fixture.debut) {
		fail(`${fixture.id} debut is ${actual}, expected ${fixture.debut}`);
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
console.log(`enemies     ${enemies.length} groups, ${enemyVariantIds.length} variants, ${ENEMY_FIXTURES.length} fixtures verified`);
console.log(`talents    ${withTalents} operators carry at least one`);
console.log(`potentials  ${withPotentials} operators carry at least one`);
console.log(`forms       ${withForms} operators carry at least one`);
console.log(`skills      ${withSkills} operators`);
console.log(`modules     ${moduleCount} across ${withModules} operators, ${MODULE_FIXTURES.length} fixtures verified`);
console.log(`profiles    ${withProfiles} operators carry a side-file entry`);
console.log(`details     ${withDetails} operators carry a details-file entry`);
console.log(`record      ${withBasic} basic, ${withExam} exam`);
console.log(`dates       ${operatorDates} operators, ${enemyDates} enemy groups`);
console.log(`ranges      ${Object.keys(ranges).length} shapes, every id resolves`);
console.log("markup      none leaked");
console.log("placeholders none leaked");
if (hasManifest) {
	console.log(`assets      ${portraitCount} portraits, ${illustrationCount} illustrations, ${enemyIconCount} enemy icons`);
}
if (hasSpineIndex) {
	console.log(
		`spine       ${spineOperatorCount} operators, ${spineFormCount} forms, ${spineRigCount} rigs (${spineKindCounts.battle} battle, ${spineKindCounts.back} back, ${spineKindCounts.dorm} dorm), ${spinePlayableCount} with a playable base battle rig`
	);
}
console.log(`enemy spine ${enemySpineCount} rigs, ${enemySpinePlayable} playable`);

if (!process.argv.includes("--skip-build")) {
	console.log("\nrunning pnpm build...");
	execFileSync("pnpm", ["build"], { stdio: "inherit" });
}
console.log("\nOK");
