/**
 * Helpers shared by the Spine tools, `check_spine_rigs.mjs` and `fill_spine_anims.mjs`: the repo paths, the `--staging` and `--dir` options,
 * printing a path, and the Vite server that loads `src/spine/` from Node.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** The `tools/assets` directory. */
export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The repo root, two levels above `tools/assets`. */
export const REPO_ROOT = path.resolve(TOOLS_DIR, "..", "..");

/** The staging root used when `--staging` is not given. The staged rigs sit under its `assets/spine`. */
export const DEFAULT_STAGING = path.join(TOOLS_DIR, ".staging");

/** The `assets` subfolder scanned when `--dir` is not given: the operator rig tree, whose rigs sit three folders deep. */
export const DEFAULT_SPINE_DIR = "spine";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Reads the staging directory from the command line. Prints the usage line and exits 1 when `--staging` has no value.
 *
 * @param {string[]} args The arguments after the script name.
 * @param {string} usage The calling tool's usage line.
 * @returns {string} The staging root, absolute. The staged rigs sit under its `assets/spine`, where `stage_spine.py` writes them.
 */
export function parseStaging(args, usage) {
	const index = args.indexOf("--staging");
	if (index === -1) {
		return DEFAULT_STAGING;
	}
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		console.error(usage);
		process.exit(1);
	}
	return path.resolve(value);
}

/**
 * Reads the scanned `assets` subfolder from the command line. Prints the usage line and exits 1 when `--dir` has no value.
 *
 * @param {string[]} args The arguments after the script name.
 * @param {string} usage The calling tool's usage line.
 * @returns {string} The folder name under the staging root's `assets`, such as `spine` or `spine-enemies`.
 */
export function parseDir(args, usage) {
	const index = args.indexOf("--dir");
	if (index === -1) {
		return DEFAULT_SPINE_DIR;
	}
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		console.error(usage);
		process.exit(1);
	}
	return value;
}

/**
 * Formats a file path for printing: relative to the repo root when the file is inside the repo, absolute otherwise.
 *
 * @param {string} file An absolute file path.
 * @returns {string} The path to print.
 */
export function shownPath(file) {
	return file.startsWith(REPO_ROOT + path.sep) ? path.relative(REPO_ROOT, file) : file;
}

/**
 * Starts a Vite server in middleware mode, so a tool can load `src/spine/` modules with `ssrLoadModule`. The caller closes it.
 *
 * @returns {Promise<import("vite").ViteDevServer>} The running server.
 */
export function startVite() {
	return createServer({ root: REPO_ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
}
