#!/usr/bin/env node
/**
 * Write the heads `refresh_plan.mjs` read into the lock files.
 *
 * Usage:
 *     node tools/data/set_locks.mjs --heads '<json>'
 */

import { writeHeads } from "./lib/locks.mjs";

const flag = process.argv.indexOf("--heads");
if (flag === -1 || !process.argv[flag + 1]) {
	console.error("Usage: node tools/data/set_locks.mjs --heads '<json>'");
	process.exit(1);
}
writeHeads(".", JSON.parse(process.argv[flag + 1]));
console.log("locks updated");
