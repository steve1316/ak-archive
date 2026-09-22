#!/usr/bin/env node
/**
 * Generate the site's operator data from the pinned upstream tables.
 *
 * Writes one shard, one profile side file and one details file per class under `src/data`, plus a small search index and a provenance file.
 * Enemies get one index file, one details file per enemy level and their own search index, which the navbar loads after first paint.
 * Output is deterministic for a given upstream commit, so re-running an unchanged import produces no diff.
 *
 * Usage:
 *     node tools/data/import.mjs
 */

import fs from "node:fs";
import path from "node:path";

import { buildEnemyGroup, buildVariant, selectEnemies } from "./lib/enemies.mjs";
import { buildOperator, selectOperators } from "./lib/operators.mjs";
import { buildHandbook } from "./lib/profiles.mjs";
import { SHARDS, shardFor } from "./lib/shards.mjs";
import { buildSkills } from "./lib/skills.mjs";
import { buildForms } from "./lib/skins.mjs";
import { loadTable, readLock } from "./lib/upstream.mjs";

/** Where generated data is written. */
const OUT_DIR = "src/data";

/** The tables the import reads. `uniequip_table` rather than `uniequip_data`, which is not localised - see PROJECT.md. */
const TABLES = ["character_table", "char_patch_table", "uniequip_table", "handbook_team_table", "handbook_info_table", "skin_table", "skill_table"];

/** The enemy tables. The stats live outside `excel/`, so this one is a path under `gamedata/`. */
const ENEMY_TABLES = ["enemy_handbook_table", "levels/enemydata/enemy_database"];

/**
 * Write a JSON file with a trailing newline, creating its directory.
 *
 * @param {string} file The path to write.
 * @param {unknown} value The value to serialise.
 * @returns {number} The bytes written.
 */
function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const body = `${JSON.stringify(value)}\n`;
	fs.writeFileSync(file, body);
	return Buffer.byteLength(body);
}

/**
 * Build and write the enemy files: the index every card reads, one details file per head's level and the navbar's enemy search index.
 *
 * @param {object} handbook `enemy_handbook_table`.
 * @param {Record<string, Array<object>>} database `enemy_database`, keyed by enemy id.
 * @returns {{total: number, variants: number}} The bytes written and how many variants were imported.
 */
function writeEnemies(handbook, database) {
	const groups = selectEnemies(handbook).map((rows) => buildEnemyGroup(rows.map((row) => buildVariant(row, database[row.enemyId], handbook.raceData, handbook.levelInfoList))));
	groups.sort((a, b) => a.record.sortId - b.record.sortId);
	const variants = groups.reduce((count, group) => count + group.record.variants.length, 0);
	console.log(`enemies: ${groups.length} groups, ${variants} variants`);

	let total = writeJson(
		path.join(OUT_DIR, "enemies.json"),
		groups.map((group) => group.record)
	);
	console.log(`  ${"enemies".padEnd(24)} ${String(groups.length).padStart(3)} groups     ${(total / 1024).toFixed(0).padStart(5)} KB`);

	const byLevel = new Map();
	for (const { record, details } of groups) {
		const file = `enemy-details-${record.level.toLowerCase()}`;
		byLevel.set(file, { ...byLevel.get(file), ...details });
	}
	for (const [file, details] of [...byLevel.entries()].sort()) {
		const bytes = writeJson(path.join(OUT_DIR, `${file}.json`), details);
		total += bytes;
		console.log(`  ${file.padEnd(24)} ${String(Object.keys(details).length).padStart(3)} variants   ${(bytes / 1024).toFixed(0).padStart(5)} KB`);
	}

	// Every variant is searchable by its own name. A variant carries its group's id so the result opens the group's page with it selected.
	const searchIndex = groups.flatMap(({ record }) =>
		record.variants.map((variant) => (variant.id === record.id ? { id: variant.id, name: variant.name } : { id: variant.id, name: variant.name, group: record.id }))
	);
	const indexBytes = writeJson(path.join(OUT_DIR, "enemy-search-index.json"), searchIndex);
	console.log(`  ${"enemy-search-index".padEnd(24)} ${String(searchIndex.length).padStart(3)} entries    ${(indexBytes / 1024).toFixed(0).padStart(5)} KB`);
	return { total: total + indexBytes, variants };
}

/**
 * Run the import.
 *
 * @returns {Promise<void>}
 */
async function main() {
	const lock = readLock();
	console.log(`upstream ${lock.repo}@${lock.sha.slice(0, 10)} (${lock.server})`);
	const [characterTable, patchTable, uniequip, teams, handbook, skins, skillTable] = await Promise.all(TABLES.map((name) => loadTable(name, lock)));
	const [enemyHandbook, enemyDatabase] = await Promise.all(ENEMY_TABLES.map((name) => loadTable(name, lock)));

	const context = { subProfDict: uniequip.subProfDict, teams };
	const profileContext = { handbookDict: handbook.handbookDict };
	const forms = buildForms(skins.charSkins);

	const operators = selectOperators(characterTable, patchTable).map(([id, row]) => {
		const handbook = buildHandbook(id, profileContext);
		return {
			id,
			row,
			side: handbook.side,
			record: { ...buildOperator(id, row, context), forms: forms.get(id) ?? [] },
			details: { skills: buildSkills(row, skillTable), ...handbook.shard }
		};
	});
	console.log(`operators: ${operators.length}`);

	const byShard = new Map(SHARDS.map((shard) => [shard.key, []]));
	for (const entry of operators) {
		byShard.get(shardFor(entry.record.professionKey).key).push(entry);
	}

	let total = 0;
	for (const shard of SHARDS) {
		const entries = byShard.get(shard.key);
		const records = entries.map((entry) => entry.record);
		const profiles = Object.fromEntries(entries.map((entry) => [entry.id, entry.side]));
		const details = Object.fromEntries(entries.map((entry) => [entry.id, entry.details]));
		const a = writeJson(path.join(OUT_DIR, `${shard.file}.json`), records);
		const b = writeJson(path.join(OUT_DIR, `${shard.profiles}.json`), profiles);
		const c = writeJson(path.join(OUT_DIR, `${shard.details}.json`), details);
		total += a + b + c;
		console.log(
			`  ${shard.file.padEnd(24)} ${String(records.length).padStart(3)} operators  ${(a / 1024).toFixed(0).padStart(5)} KB  + profiles ${(b / 1024).toFixed(0).padStart(5)} KB  + details ${(c / 1024).toFixed(0).padStart(5)} KB`
		);
	}

	// The navbar renders on every route, so its index carries only what a search result needs to show and open.
	const searchIndex = operators.map(({ record }) => ({ id: record.id, name: record.name, rarity: record.rarity, profession: record.profession }));
	const indexBytes = writeJson(path.join(OUT_DIR, "search-index.json"), searchIndex);
	console.log(`  ${"search-index".padEnd(24)} ${String(searchIndex.length).padStart(3)} entries    ${(indexBytes / 1024).toFixed(0).padStart(5)} KB`);

	const enemyBytes = writeEnemies(enemyHandbook, enemyDatabase);
	const upstreamBytes = writeJson(path.join(OUT_DIR, "upstream.json"), {
		repo: lock.repo,
		server: lock.server,
		sha: lock.sha,
		operators: operators.length,
		enemies: enemyBytes.variants
	});
	console.log(`total written: ${((total + indexBytes + enemyBytes.total + upstreamBytes) / 1048576).toFixed(2)} MB`);
}

await main();
