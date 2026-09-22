#!/usr/bin/env node
/**
 * Fills the Spine index's empty `anims` lists with each rig's animation names, and records each rig's `stage`, both read from its staged `.skel` file.
 *
 * `build_spine_index.py` walks the staged tree and writes the index with every rig's `anims` empty. This script reads each indexed
 * rig's skeleton with `src/spine/binary.ts`, sets `anims` to its animation names in file order, and sets `stage` to the lowest runtime
 * stage that draws it in full, from `rigStage` in `src/spine/features.ts`. Splitting the work this way keeps the index builder free of a
 * skeleton parser, and lets both fields be refreshed without re-walking the staged tree.
 *
 * The index is rewritten with the same formatting `build_spine_index.py` uses: keys sorted at every level, no extra whitespace,
 * non-ASCII characters escaped, and a trailing newline. Matching it byte for byte means running both scripts back to back leaves no
 * diff on an unchanged staged tree.
 *
 * Usage:
 *     node tools/assets/fill_spine_anims.mjs [--staging PATH] [--enemies]
 *
 * Reads and rewrites src/data/spine-index.json, or src/data/enemy-spine-index.json with `--enemies`. Scans the staged tree under
 * `<staging>/assets/spine` or `<staging>/assets/spine-enemies`. `--staging` defaults to `tools/assets/.staging`. A missing or unparseable
 * rig, one no planned stage covers, or one whose animations do not match its kind prints its path and exits 1 before the file is written.
 */

import fs from "node:fs";
import path from "node:path";
import { parseStaging, REPO_ROOT, shownPath, startVite } from "./spine_tools.mjs";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** The operator Spine index this script fills by default. */
const INDEX_PATH = path.join(REPO_ROOT, "src", "data", "spine-index.json");

/** The enemy Spine index, filled instead with `--enemies`. */
const ENEMY_INDEX_PATH = path.join(REPO_ROOT, "src", "data", "enemy-spine-index.json");

/** Printed when the command line is wrong. */
const USAGE = "Usage: node tools/assets/fill_spine_anims.mjs [--staging PATH] [--enemies]";

/**
 * Animation names only a battle rig has, matched on the name's first word so suffixed sets such as Bena's `Idle_A` count. A dorm rig has none
 * of them, and a battle or back rig always has one. Upstream's folder names once hid Skadi the Corrupting Heart's battle rig in a dorm folder,
 * so every rig's kind is checked against what it actually plays.
 */
const BATTLE_ANIM = /^(Idle|Die|Start)(_|$)/;

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Escapes one string the way Python's `json.dump` does with its default `ensure_ascii=True`: the quote, backslash and common control
 * characters get their short escape, every other character outside printable ASCII becomes a `\uXXXX` escape, and a character above the
 * basic multilingual plane is written as a surrogate pair.
 *
 * @param {string} value The string to escape.
 * @returns {string} The quoted, escaped JSON string.
 */
function escapeJsonString(value) {
	let out = '"';
	for (const char of value) {
		const code = char.codePointAt(0);
		if (char === '"') {
			out += '\\"';
		} else if (char === "\\") {
			out += "\\\\";
		} else if (code === 0x08) {
			out += "\\b";
		} else if (code === 0x0c) {
			out += "\\f";
		} else if (code === 0x0a) {
			out += "\\n";
		} else if (code === 0x0d) {
			out += "\\r";
		} else if (code === 0x09) {
			out += "\\t";
		} else if (code < 0x20 || code > 0x7e) {
			if (code > 0xffff) {
				const offset = code - 0x10000;
				out += "\\u" + (0xd800 + (offset >> 10)).toString(16).padStart(4, "0");
				out += "\\u" + (0xdc00 + (offset & 0x3ff)).toString(16).padStart(4, "0");
			} else {
				out += "\\u" + code.toString(16).padStart(4, "0");
			}
		} else {
			out += char;
		}
	}
	return out + '"';
}

/**
 * Serializes a value the way `build_spine_index.py` writes the index: object keys sorted at every level, no extra whitespace, and
 * non-ASCII characters escaped. Matching this byte for byte keeps a rerun of both scripts diff-free on an unchanged staged tree.
 *
 * @param {unknown} value The value to serialize. Only plain objects, arrays, strings, numbers, booleans and null are expected.
 * @returns {string} The JSON text, without a trailing newline.
 */
function serializeLikeJson(value) {
	if (value === null || typeof value === "number" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (typeof value === "string") {
		return escapeJsonString(value);
	}
	if (Array.isArray(value)) {
		return "[" + value.map(serializeLikeJson).join(",") + "]";
	}
	const keys = Object.keys(value).sort();
	return "{" + keys.map((key) => escapeJsonString(key) + ":" + serializeLikeJson(value[key])).join(",") + "}";
}

/**
 * Lists every rig an index names, with the staged folder that holds it.
 *
 * @param {object} index The parsed index.
 * @param {string} staging The staging root.
 * @param {boolean} enemies Whether the index is the flat enemy index rather than the operator one.
 * @returns {Array<{ rig: object, folder: string, kind: string }>} One entry per rig.
 */
function listRigs(index, staging, enemies) {
	if (enemies) {
		const root = path.join(staging, "assets", "spine-enemies");
		return Object.entries(index).map(([enemyId, rig]) => ({ rig, folder: path.join(root, enemyId), kind: "battle" }));
	}
	const root = path.join(staging, "assets", "spine");
	return Object.entries(index).flatMap(([operatorId, forms]) =>
		Object.entries(forms).flatMap(([formKey, kinds]) => Object.entries(kinds).map(([kind, rig]) => ({ rig, folder: path.join(root, operatorId, formKey, kind), kind })))
	);
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Main

/**
 * Reads the index, fills every rig's `anims` and `stage` from its staged skeleton, and writes the index back.
 */
async function main() {
	const staging = parseStaging(process.argv.slice(2), USAGE);
	const enemies = process.argv.includes("--enemies");
	const indexPath = enemies ? ENEMY_INDEX_PATH : INDEX_PATH;
	const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));

	const server = await startVite();
	let rigCount = 0;
	try {
		const { readSkeleton } = await server.ssrLoadModule("/src/spine/binary.ts");
		const { rigStage } = await server.ssrLoadModule("/src/spine/features.ts");
		for (const { rig, folder, kind } of listRigs(index, staging, enemies)) {
			const skelPath = path.join(folder, `${rig.skel}.skel`);
			const shown = shownPath(skelPath);
			let data;
			try {
				data = readSkeleton(new Uint8Array(fs.readFileSync(skelPath)));
			} catch (error) {
				console.error(`${shown}: ${error.message}`);
				process.exit(1);
			}
			const stage = rigStage(data);
			if (!Number.isFinite(stage)) {
				console.error(`${shown}: no planned runtime stage covers this rig`);
				process.exit(1);
			}
			rig.anims = data.animations.map((animation) => animation.name);
			// Enemy rigs are all battle rigs by construction, and their animation names vary too much for the name check to mean anything.
			if (!enemies && rig.anims.some((name) => BATTLE_ANIM.test(name)) !== (kind !== "dorm")) {
				console.error(`${shown}: filed as ${kind}, but its animations say otherwise: ${rig.anims.join(", ")}`);
				process.exit(1);
			}
			rig.stage = stage;
			rigCount++;
		}
	} finally {
		await server.close();
	}

	fs.writeFileSync(indexPath, serializeLikeJson(index) + "\n");
	console.log(`rigs filled ${rigCount}`);
}

await main();
