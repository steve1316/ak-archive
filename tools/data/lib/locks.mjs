/**
 * The six upstream pins a scheduled refresh moves: the game data and its CN level fallback, and the four asset mirrors. Each lock file keeps its
 * own fields and formatting, and only `sha` changes.
 */

import fs from "node:fs";
import path from "node:path";

/** Every pin: its name, its lock file relative to the repo root, and the nested field holding it, or null for the top level. */
export const PINS = [
	{ name: "data", file: "tools/data/upstream.lock.json", field: null },
	{ name: "data-cn", file: "tools/data/upstream.lock.json", field: "levelFallback" },
	{ name: "art", file: "tools/assets/upstream.lock.json", field: null },
	{ name: "enemies", file: "tools/assets/enemies.lock.json", field: null },
	{ name: "icons", file: "tools/assets/icons.lock.json", field: null },
	{ name: "enemy-spine", file: "tools/assets/enemy-spine.lock.json", field: null }
];

/**
 * Read one lock file.
 *
 * @param {string} root The repo root.
 * @param {string} file The lock file, relative to the root.
 * @returns {any} The parsed lock.
 */
function readLockFile(root, file) {
	return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

/**
 * Read every pin.
 *
 * @param {string} root The repo root.
 * @returns {Array<{name: string, file: string, field: string | null, repo: string, ref: string, sha: string}>} The pins, in `PINS` order. `ref` is the
 *   lock's branch, or `HEAD` for the game-data locks, which record none.
 */
export function readPins(root) {
	return PINS.map((pin) => {
		const lock = readLockFile(root, pin.file);
		const entry = pin.field ? lock[pin.field] : lock;
		return { ...pin, repo: entry.repo, ref: entry.branch ?? "HEAD", sha: entry.sha };
	});
}

/**
 * The pins whose upstream head differs from the pinned sha.
 *
 * @param {Array<{name: string, sha: string}>} pins From `readPins`.
 * @param {Record<string, string>} heads Each pin's current head by name.
 * @returns {string[]} The moved pin names, in `PINS` order.
 */
export function movedPins(pins, heads) {
	return pins.filter((pin) => heads[pin.name] && heads[pin.name] !== pin.sha).map((pin) => pin.name);
}

/**
 * Write new heads into the lock files, touching only each `sha`.
 *
 * @param {string} root The repo root.
 * @param {Record<string, string>} heads Each pin's new sha by name. A pin missing here keeps its sha.
 */
export function writeHeads(root, heads) {
	const files = new Map();
	for (const pin of PINS) {
		const lock = files.get(pin.file) ?? readLockFile(root, pin.file);
		files.set(pin.file, lock);
		if (heads[pin.name]) {
			(pin.field ? lock[pin.field] : lock).sha = heads[pin.name];
		}
	}
	for (const [file, lock] of files) {
		fs.writeFileSync(path.join(root, file), `${JSON.stringify(lock, null, "\t")}\n`);
	}
}
