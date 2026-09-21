#!/usr/bin/env node
/**
 * Fills the Spine index's empty `anims` lists with each rig's animation names, read from its staged `.skel` file.
 *
 * `build_spine_index.py` walks the staged tree and writes the index with every rig's `anims` empty. This script reads each indexed
 * rig's skeleton with `src/spine/binary.ts` and sets `anims` to its animation names, in file order. Splitting the work this way keeps
 * the index builder free of a skeleton parser, and lets the animation names be refreshed without re-walking the staged tree.
 *
 * The index is rewritten with the same formatting `build_spine_index.py` uses: keys sorted at every level, no extra whitespace,
 * non-ASCII characters escaped, and a trailing newline. Matching it byte for byte means running both scripts back to back leaves no
 * diff on an unchanged staged tree.
 *
 * Usage:
 *     node tools/assets/fill_spine_anims.mjs [--staging PATH]
 *
 * Reads and rewrites src/data/spine-index.json. Scans the staged tree under `<staging>/assets/spine`. `--staging` defaults to
 * `tools/assets/.staging`. A missing or unparseable rig prints its path and exits 1 before the file is written.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOLS_DIR, "..", "..");
const DEFAULT_STAGING = path.join(TOOLS_DIR, ".staging");
const INDEX_PATH = path.join(REPO_ROOT, "src", "data", "spine-index.json");

/** Printed when the command line is wrong. */
const USAGE = "Usage: node tools/assets/fill_spine_anims.mjs [--staging PATH]";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Read the staging directory from the command line.
 *
 * @param {string[]} args The arguments after the script name.
 * @returns {string} The staging root, absolute. The staged rigs sit under its `assets/spine`, where `stage_spine.py` writes them.
 */
function parseStaging(args) {
	const index = args.indexOf("--staging");
	if (index === -1) {
		return DEFAULT_STAGING;
	}
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		console.error(USAGE);
		process.exit(1);
	}
	return path.resolve(value);
}

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

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Main

/**
 * Reads the index, fills every rig's `anims` from its staged skeleton, and writes the index back.
 */
async function main() {
	const staging = parseStaging(process.argv.slice(2));
	const spineDir = path.join(staging, "assets", "spine");
	const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));

	const server = await createServer({ root: REPO_ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
	let rigCount = 0;
	try {
		const { readSkeleton } = await server.ssrLoadModule("/src/spine/binary.ts");
		for (const [operatorId, forms] of Object.entries(index)) {
			for (const [formKey, kinds] of Object.entries(forms)) {
				for (const [kind, rig] of Object.entries(kinds)) {
					const skelPath = path.join(spineDir, operatorId, formKey, kind, `${rig.skel}.skel`);
					const shown = path.relative(REPO_ROOT, skelPath);
					let data;
					try {
						data = readSkeleton(new Uint8Array(fs.readFileSync(skelPath)));
					} catch (error) {
						console.error(`${shown}: ${error.message}`);
						process.exit(1);
					}
					rig.anims = data.animations.map((animation) => animation.name);
					rigCount++;
				}
			}
		}
	} finally {
		await server.close();
	}

	fs.writeFileSync(INDEX_PATH, serializeLikeJson(index) + "\n");
	console.log(`rigs filled ${rigCount}`);
}

await main();
