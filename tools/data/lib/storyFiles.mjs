/**
 * Fetching the story scripts at the pinned commit.
 *
 * There are about 1,900 scripts, 59 MB in all, so they are not fetched one listing call at a time. One call to the GitHub trees API lists the
 * whole story folder with each file's blob sha, and each script is cached under `tools/data/.cache/story/<blob sha>.txt`. The cache is keyed by
 * content rather than by commit, so when the pin moves only the scripts that actually changed are downloaded again. `refresh.yml` keeps the
 * folder between runs.
 */

import fs from "node:fs";
import path from "node:path";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Module constants

/** Where scripts are cached, by blob sha. Gitignored with the rest of `tools/data/.cache`. */
const STORY_CACHE_DIR = "tools/data/.cache/story";

/** The summary files that sit beside the scripts. They are not stories. */
const SUMMARY_PREFIX = "[uc]info/";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Listing and fetching

/**
 * Index a trees API listing of the story folder.
 *
 * @param {{truncated: boolean, tree: {path: string, type: string, sha: string}[]}} tree The listing.
 * @returns {Map<string, {path: string, sha: string}>} Each script by lowercased path without `.txt`, holding its real path and blob sha.
 * @throws When the listing is truncated, since planning from part of it would mark real stories missing.
 */
export function storyScriptIndex(tree) {
	if (tree.truncated) {
		throw new Error("the story folder listing came back truncated, so the story index cannot be trusted");
	}
	const scripts = new Map();
	for (const entry of tree.tree) {
		if (entry.type !== "blob" || !entry.path.endsWith(".txt") || entry.path.startsWith(SUMMARY_PREFIX)) {
			continue;
		}
		const scriptPath = entry.path.slice(0, -".txt".length);
		scripts.set(scriptPath.toLowerCase(), { path: scriptPath, sha: entry.sha });
	}
	return scripts;
}

/**
 * List every story script at the pinned commit. Sends `GITHUB_TOKEN` when it is set, so CI does not share the anonymous rate limit.
 *
 * @param {{repo: string, server: string, sha: string}} lock The pinned upstream.
 * @returns {Promise<Map<string, {path: string, sha: string}>>} The scripts, as `storyScriptIndex` keys them.
 * @throws When the listing request fails.
 */
export async function listStoryScripts(lock) {
	const url = `https://api.github.com/repos/${lock.repo}/git/trees/${lock.sha}:${lock.server}/gamedata/story?recursive=1`;
	const headers = { Accept: "application/vnd.github+json" };
	if (process.env.GITHUB_TOKEN) {
		headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	}
	const response = await fetch(url, { headers });
	if (!response.ok) {
		throw new Error(`listing the story scripts failed with HTTP ${response.status} from ${url}`);
	}
	return storyScriptIndex(await response.json());
}

/**
 * One story script's text, from the cache when this blob was fetched before.
 *
 * @param {string} scriptPath The script's path under `gamedata/story/`, without `.txt`.
 * @param {string} sha The script's blob sha.
 * @param {{repo: string, server: string, sha: string}} lock The pinned upstream.
 * @returns {Promise<string>} The script.
 * @throws When the download fails.
 */
export async function loadStoryText(scriptPath, sha, lock) {
	const cached = path.join(STORY_CACHE_DIR, `${sha}.txt`);
	if (fs.existsSync(cached)) {
		return fs.readFileSync(cached, "utf8");
	}
	const url = `https://raw.githubusercontent.com/${lock.repo}/${lock.sha}/${lock.server}/gamedata/story/${scriptPath.split("/").map(encodeURIComponent).join("/")}.txt`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`${scriptPath}.txt failed to download with HTTP ${response.status} from ${url}`);
	}
	const body = await response.text();
	fs.mkdirSync(STORY_CACHE_DIR, { recursive: true });
	fs.writeFileSync(cached, body);
	return body;
}

/**
 * Run an async function over every item, at most `limit` at a time.
 *
 * @param {T[]} items The items.
 * @param {number} limit How many may run at once.
 * @param {(item: T) => Promise<void>} fn The work for one item.
 * @template T
 */
export async function mapLimit(items, limit, fn) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			await fn(items[next++]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
