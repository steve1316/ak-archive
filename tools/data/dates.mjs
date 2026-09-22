#!/usr/bin/env node
/**
 * Build the committed Global release-date snapshot, `tools/data/release-dates.json`.
 *
 * Operators are dated from the Arknights Wiki's Cargo tables. Enemies are dated from the pinned game data. The EN client no longer ships the
 * level files of many old events, so a level missing there is read from the pinned CN repo in `levelFallback` instead. A level's enemy list is the
 * same on every server. The snapshot is committed so that `import.mjs` stays offline and deterministic for dates. Re-run this by hand when new
 * operators or events land.
 *
 * Usage:
 *     node tools/data/dates.mjs > dates_run.log 2>&1
 */

import fs from "node:fs";

import { chapterDay, enemyDates, ID_ALIASES, operatorDates, stageDates } from "./lib/dates.mjs";
import { asArray } from "./lib/json.mjs";
import { selectOperators } from "./lib/operators.mjs";
import { loadTable, readLock } from "./lib/upstream.mjs";
import { cargoQuery, pageWikitext } from "./lib/wiki.mjs";

/** Where the snapshot is written. */
const OUT_PATH = "tools/data/release-dates.json";

/** Level files fetched at once. 2,317 files, each cached after its first download. */
const LEVEL_CONCURRENCY = 8;

/**
 * Copy an object with its keys in sorted order, so the snapshot diffs cleanly between runs.
 *
 * @param {Record<string, string>} record The object.
 * @returns {Record<string, string>} The sorted copy.
 */
function sortedObject(record) {
	return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Run an async task over every item with at most `limit` in flight.
 *
 * @param {string[]} items The inputs.
 * @param {number} limit How many run at once.
 * @param {(item: string) => Promise<void>} work The task.
 * @returns {Promise<void>}
 */
async function eachLimited(items, limit, work) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const item = items[next];
			next += 1;
			await work(item);
		}
	};
	await Promise.all(Array.from({ length: limit }, worker));
}

/**
 * Load one level file from the pinned EN data, falling back to the pinned CN repo for the old event levels EN no longer ships.
 *
 * @param {string} levelId The stage's `levelId`, such as `Obt/Main/level_main_01-07`.
 * @param {{repo: string, server: string, sha: string, levelFallback?: {repo: string, server: string, sha: string}}} lock The pinned upstreams.
 * @returns {Promise<any>} The parsed level.
 * @throws When neither upstream has the file.
 */
async function loadLevel(levelId, lock) {
	const name = `levels/${levelId.toLowerCase()}`;
	try {
		return await loadTable(name, lock);
	} catch (error) {
		if (!lock.levelFallback) {
			throw error;
		}
		return loadTable(name, lock.levelFallback);
	}
}

/**
 * Run the snapshot build.
 *
 * @returns {Promise<void>}
 */
async function main() {
	const lock = readLock();
	const [characterTable, patchTable, stageTable, activityTable, zoneTable] = await Promise.all(
		["character_table", "char_patch_table", "stage_table", "activity_table", "zone_table"].map((name) => loadTable(name, lock))
	);

	const names = new Map(selectOperators(characterTable, patchTable).map(([id, row]) => [id, ID_ALIASES[id] ?? row.name]));
	const banners = await cargoQuery({ tables: "Banners", fields: "operators,startTimeGlobal,upcoming", where: "server='global'" });
	const wikiOperators = await cargoQuery({ tables: "Operators", fields: "name,event" });
	const events = await cargoQuery({ tables: "EventServerDetails", fields: "event,startTime", where: "server='global'" });
	const operators = operatorDates(names, banners, wikiOperators, events);
	console.log(`operators: ${Object.keys(operators.dates).length} dated of ${names.size}`);
	console.log(`  unmatched (${operators.unmatched.length}): ${operators.unmatched.join(", ") || "none"}`);
	console.log(`  undated (${operators.undated.length}): ${operators.undated.join(", ") || "none"}`);

	const chapters = new Map();
	for (const zoneId of asArray(zoneTable.mainlineZoneIdList)) {
		const number = /^main_(\d+)$/.exec(zoneId)?.[1];
		if (number === undefined) {
			continue;
		}
		const day = chapterDay(Number(number), await pageWikitext(`Episode ${number.padStart(2, "0")}`));
		if (day) {
			chapters.set(zoneId, day);
		} else {
			console.warn(`  no Global date for chapter ${zoneId}`);
		}
	}
	console.log(`chapters: ${chapters.size} dated`);

	const stages = stageTable.stages;
	const levelIds = [
		...new Set(
			Object.values(stages)
				.map((stage) => stage.levelId)
				.filter(Boolean)
		)
	].sort();
	const levelEnemies = new Map();
	const missing = [];
	let done = 0;
	await eachLimited(levelIds, LEVEL_CONCURRENCY, async (levelId) => {
		try {
			const level = await loadLevel(levelId, lock);
			levelEnemies.set(
				levelId,
				asArray(level.enemyDbRefs)
					.map((ref) => ref.id)
					.filter(Boolean)
			);
		} catch (error) {
			missing.push(`${levelId}: ${error.message}`);
		}
		done += 1;
		if (done % 200 === 0) {
			console.log(`  levels ${done}/${levelIds.length}`);
		}
	});
	const enemies = enemyDates(stages, stageDates(stages, activityTable, chapters), levelEnemies);
	console.log(`enemies: ${Object.keys(enemies).length} dated from ${levelEnemies.size} levels`);
	console.log(`  missing levels (${missing.length}): ${missing.join("; ") || "none"}`);

	const snapshot = {
		wikiFetchedAt: new Date().toISOString().slice(0, 10),
		gameDataSha: lock.sha,
		levelFallbackSha: lock.levelFallback?.sha ?? null,
		operators: sortedObject(operators.dates),
		enemies: sortedObject(enemies)
	};
	fs.writeFileSync(OUT_PATH, `${JSON.stringify(snapshot, null, "\t")}\n`);
	console.log(`wrote ${OUT_PATH}`);
}

await main();
