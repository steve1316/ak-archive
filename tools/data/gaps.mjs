#!/usr/bin/env node
/**
 * Bring the asset gap ledger, `tools/data/asset-gaps.json`, up to date with the generated data. The scheduled refresh runs this after merging.
 * `--seed-accepted` records every current gap as accepted instead, which is how the ledger was first created.
 *
 * Usage:
 *     node tools/data/gaps.mjs [--seed-accepted]
 */

import fs from "node:fs";
import path from "node:path";

import { missingAssets, publishedAssets, referencedAssets, updateLedger } from "./lib/gaps.mjs";
import { SHARDS } from "./lib/shards.mjs";

/** Where generated data lives. */
const OUT_DIR = "src/data";

/** The ledger. */
const LEDGER_PATH = "tools/data/asset-gaps.json";

/**
 * Read one generated file.
 *
 * @param {string} name The basename under `src/data`.
 * @returns {any} The parsed contents.
 */
function read(name) {
	return JSON.parse(fs.readFileSync(path.join(OUT_DIR, `${name}.json`), "utf8"));
}

const operators = SHARDS.flatMap((shard) => read(shard.file));
const details = new Map(SHARDS.flatMap((shard) => Object.entries(read(shard.details))));
const referenced = referencedAssets({ operators, details, enemies: read("enemies") });
const published = publishedAssets({ manifest: read("assets-manifest"), spineIndex: read("spine-index"), enemySpineIndex: read("enemy-spine-index") });
const missing = missingAssets(referenced, published);
const today = new Date().toISOString().slice(0, 10);
const current = fs.existsSync(LEDGER_PATH) ? JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8")) : { pending: {}, accepted: {} };
const ledger = process.argv.includes("--seed-accepted")
	? { pending: {}, accepted: Object.fromEntries(missing.map((key) => [key, `open when the ledger was created, ${today}`])) }
	: updateLedger(current, missing, today);
fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, "\t")}\n`);
console.log(`gaps: ${missing.length} missing, ${Object.keys(ledger.pending).length} pending, ${Object.keys(ledger.accepted).length} accepted`);
for (const [key, since] of Object.entries(ledger.pending)) {
	console.log(`  pending ${key} since ${since}`);
}
