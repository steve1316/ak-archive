#!/usr/bin/env node
/**
 * The scheduled refresh's first job: read every upstream head and decide whether there is any work. There is work when a pin moved or the gap
 * ledger has a pending entry that a later mirror update might fill.
 *
 * Usage:
 *     node tools/data/refresh_plan.mjs
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { movedPins, readPins } from "./lib/locks.mjs";

const pins = readPins(".");
const heads = {};
for (const pin of pins) {
	const ref = pin.ref === "HEAD" ? "HEAD" : `refs/heads/${pin.ref}`;
	const line =
		execFileSync("git", ["ls-remote", `https://github.com/${pin.repo}.git`, ref], { encoding: "utf8" })
			.trim()
			.split("\n")[0] ?? "";
	const sha = line.split("\t")[0];
	if (!/^[0-9a-f]{40}$/.test(sha)) {
		throw new Error(`could not read the head of ${pin.repo} ${ref}: ${JSON.stringify(line)}`);
	}
	heads[pin.name] = sha;
}
const moved = movedPins(pins, heads);
const ledger = JSON.parse(fs.readFileSync("tools/data/asset-gaps.json", "utf8"));
const pending = Object.keys(ledger.pending ?? {}).length;
const work = moved.length > 0 || pending > 0;
console.log(`moved: ${moved.join(", ") || "none"}; pending gaps: ${pending}; work: ${work}`);
if (process.env.GITHUB_OUTPUT) {
	fs.appendFileSync(process.env.GITHUB_OUTPUT, `work=${work}\nmoved=${moved.join(",")}\nheads=${JSON.stringify(heads)}\n`);
}
