/**
 * Fetching the upstream game tables at a pinned commit.
 *
 * The upstream repo is 1.31 GB and v1 reads six files out of it, so nothing is cloned. Each file is pulled over raw.githubusercontent at the
 * pinned sha and cached under `tools/data/.cache/<sha>/`, which is gitignored. Pinning by sha rather than by branch is what makes an import
 * reproducible, and it is also how a stale pin becomes visible rather than silently importing whatever upstream looks like today.
 */

import fs from "node:fs";
import path from "node:path";

/** Where the lock file lives, relative to the repo root. */
const LOCK_PATH = "tools/data/upstream.lock.json";

/** Where fetched tables are cached. Gitignored, and safe to delete. */
const CACHE_DIR = "tools/data/.cache";

/**
 * Read the pinned upstream.
 *
 * @returns The lock file's contents.
 */
export function readLock() {
	const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
	for (const key of ["repo", "server", "sha"]) {
		if (!lock[key]) {
			throw new Error(`${LOCK_PATH} is missing "${key}"`);
		}
	}
	return lock;
}

/**
 * Fetch one game table at the pinned commit, reusing the cached copy when there is one.
 *
 * A bare name is read from `gamedata/excel/`. A name with a slash is a path under `gamedata/` instead, which is how the enemy stats in
 * `levels/enemydata/enemy_database` are reached.
 *
 * @param {string} name The table's basename, such as `character_table`, or its path under `gamedata/`.
 * @param {{repo: string, server: string, sha: string}} lock The pinned upstream.
 * @returns {Promise<unknown>} The parsed table.
 * @throws When the download fails or the body is not JSON. A failed download's error carries the HTTP `status`.
 */
export async function loadTable(name, lock) {
	const cached = path.join(CACHE_DIR, lock.sha, `${name}.json`);
	if (fs.existsSync(cached)) {
		return JSON.parse(fs.readFileSync(cached, "utf8"));
	}
	const tablePath = name.includes("/") ? name : `excel/${name}`;
	const url = `https://raw.githubusercontent.com/${lock.repo}/${lock.sha}/${lock.server}/gamedata/${tablePath}.json`;
	const response = await fetch(url);
	if (!response.ok) {
		throw Object.assign(new Error(`${name}.json failed to download with HTTP ${response.status} from ${url}`), { status: response.status });
	}
	const body = await response.text();
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch (cause) {
		throw new Error(`${name}.json downloaded from ${url} but did not parse as JSON`, { cause });
	}
	fs.mkdirSync(path.dirname(cached), { recursive: true });
	fs.writeFileSync(cached, body);
	return parsed;
}
