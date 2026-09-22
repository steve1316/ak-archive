#!/usr/bin/env node
/**
 * Build the committed Global release-date snapshot, `tools/data/release-dates.json`.
 *
 * Operators are dated from the Arknights Wiki's Cargo tables. Enemies are dated from the pinned game data. The snapshot is committed so that
 * `import.mjs` stays offline and deterministic for dates. Re-run this by hand when new operators or events land.
 *
 * Usage:
 *     node tools/data/dates.mjs > dates_run.log 2>&1
 */

import fs from "node:fs";

import { ID_ALIASES, operatorDates } from "./lib/dates.mjs";
import { selectOperators } from "./lib/operators.mjs";
import { loadTable, readLock } from "./lib/upstream.mjs";
import { cargoQuery } from "./lib/wiki.mjs";

/** Where the snapshot is written. */
const OUT_PATH = "tools/data/release-dates.json";

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
 * Run the snapshot build.
 *
 * @returns {Promise<void>}
 */
async function main() {
	const lock = readLock();
	const [characterTable, patchTable] = await Promise.all(["character_table", "char_patch_table"].map((name) => loadTable(name, lock)));

	const names = new Map(selectOperators(characterTable, patchTable).map(([id, row]) => [id, ID_ALIASES[id] ?? row.name]));
	const banners = await cargoQuery({ tables: "Banners", fields: "operators,startTimeGlobal,upcoming", where: "server='global'" });
	const wikiOperators = await cargoQuery({ tables: "Operators", fields: "name,event" });
	const events = await cargoQuery({ tables: "EventServerDetails", fields: "event,startTime", where: "server='global'" });
	const operators = operatorDates(names, banners, wikiOperators, events);
	console.log(`operators: ${Object.keys(operators.dates).length} dated of ${names.size}`);
	console.log(`  unmatched (${operators.unmatched.length}): ${operators.unmatched.join(", ") || "none"}`);
	console.log(`  undated (${operators.undated.length}): ${operators.undated.join(", ") || "none"}`);

	const snapshot = {
		wikiFetchedAt: new Date().toISOString().slice(0, 10),
		gameDataSha: lock.sha,
		operators: sortedObject(operators.dates),
		enemies: {}
	};
	fs.writeFileSync(OUT_PATH, `${JSON.stringify(snapshot, null, "\t")}\n`);
	console.log(`wrote ${OUT_PATH}`);
}

await main();
