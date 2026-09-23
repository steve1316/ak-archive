/**
 * Fetching the story scripts at the pinned commit.
 *
 * There are about 1,900 scripts, 59 MB in all, so they are not fetched one listing call at a time. One call to the GitHub trees API lists the
 * whole story folder with each file's blob sha, and each script is cached under `tools/data/.cache/story/<blob sha>.txt`. The cache is keyed by
 * content rather than by commit, so when the pin moves only the scripts that actually changed are downloaded again. `refresh.yml` keeps the
 * folder between runs.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Module constants

/** Where scripts are cached, by blob sha. Gitignored with the rest of `tools/data/.cache`. */
const STORY_CACHE_DIR = "tools/data/.cache/story";

/** The summary files that sit beside the scripts. They are not stories. */
const SUMMARY_PREFIX = "[uc]info/";

/** How long one request may take before it is abandoned and retried, so a hung socket cannot stall a refresh until the job times out. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Statuses worth retrying: rate limiting and server errors. Anything else, such as a 404, fails at once. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

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
 * The git blob hash of some bytes, the same hash the trees API reports. A cached or downloaded script whose hash differs is cut short or
 * corrupted, and is fetched again rather than trusted.
 *
 * @param {Buffer} bytes The file's bytes.
 * @returns {string} The hex sha1 of `blob <length>\0<bytes>`.
 */
export function blobSha(bytes) {
	return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/**
 * The request headers for GitHub, carrying `GITHUB_TOKEN` when it is set, so CI does not share the anonymous rate limits.
 *
 * @param {Record<string, string>} [extra] Headers to add.
 * @returns {Record<string, string>} The headers.
 */
function githubHeaders(extra = {}) {
	return process.env.GITHUB_TOKEN ? { ...extra, Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : extra;
}

/**
 * Fetch with a timeout, retrying rate limits, server errors and network failures with a doubling delay.
 *
 * @param {string} url The URL.
 * @param {RequestInit} init The request options.
 * @param {{fetchImpl?: typeof fetch, attempts?: number, delayMs?: number}} [options] The fetch to use, how many tries in all, and the first delay.
 * @returns {Promise<Response>} The first response that is not retryable, or the last one when every attempt was.
 * @throws The last network error, when every attempt failed to connect.
 */
export async function fetchWithRetry(url, init, { fetchImpl = fetch, attempts = 4, delayMs = 1000 } = {}) {
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
			if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) {
				return response;
			}
		} catch (error) {
			lastError = error;
			if (attempt === attempts) {
				throw error;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1)));
	}
	throw lastError;
}

/**
 * List every story script at the pinned commit.
 *
 * @param {{repo: string, server: string, sha: string}} lock The pinned upstream.
 * @returns {Promise<Map<string, {path: string, sha: string}>>} The scripts, as `storyScriptIndex` keys them.
 * @throws When the listing request fails.
 */
export async function listStoryScripts(lock) {
	const url = `https://api.github.com/repos/${lock.repo}/git/trees/${lock.sha}:${lock.server}/gamedata/story?recursive=1`;
	const response = await fetchWithRetry(url, { headers: githubHeaders({ Accept: "application/vnd.github+json" }) });
	if (!response.ok) {
		throw new Error(`listing the story scripts failed with HTTP ${response.status} from ${url}`);
	}
	return storyScriptIndex(await response.json());
}

/**
 * One story script's text, from the cache when this blob was fetched before and is still whole.
 *
 * @param {string} scriptPath The script's path under `gamedata/story/`, without `.txt`.
 * @param {string} sha The script's blob sha.
 * @param {{repo: string, server: string, sha: string}} lock The pinned upstream.
 * @returns {Promise<string>} The script.
 * @throws When the download fails, or downloads bytes whose hash is not `sha`.
 */
export async function loadStoryText(scriptPath, sha, lock) {
	const cached = path.join(STORY_CACHE_DIR, `${sha}.txt`);
	if (fs.existsSync(cached)) {
		const bytes = fs.readFileSync(cached);
		if (blobSha(bytes) === sha) {
			return bytes.toString("utf8");
		}
	}
	const url = `https://raw.githubusercontent.com/${lock.repo}/${lock.sha}/${lock.server}/gamedata/story/${scriptPath.split("/").map(encodeURIComponent).join("/")}.txt`;
	const response = await fetchWithRetry(url, { headers: githubHeaders() });
	if (!response.ok) {
		throw new Error(`${scriptPath}.txt failed to download with HTTP ${response.status} from ${url}`);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	if (blobSha(bytes) !== sha) {
		throw new Error(`${scriptPath}.txt downloaded from ${url} does not match its blob sha ${sha}`);
	}
	fs.mkdirSync(STORY_CACHE_DIR, { recursive: true });
	fs.writeFileSync(cached, bytes);
	return bytes.toString("utf8");
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
