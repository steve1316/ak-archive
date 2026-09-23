#!/usr/bin/env node
/**
 * The last line of defence for the asset pipeline: confirms the published repo actually serves every URL the site can ask for.
 *
 * A build can pass `tsc` and still ship broken art - the manifest can claim a portrait exists while the file that went out to
 * `ak-archive-assets` has a different name, a different case, or never went out at all. This resolves every one of those URLs for real,
 * over HTTP, and reports every mismatch rather than stopping at the first. The reference pipeline's equivalent caught ten atlases whose
 * page image differed only in capitalisation - invisible on a case-insensitive filesystem, fatal once served over HTTP.
 *
 * Usage:
 *     node tools/assets/audit_assets.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOLS_DIR, "..", "..");
const DATA_DIR = path.join(REPO_ROOT, "src", "data");
const MANIFEST_PATH = path.join(DATA_DIR, "assets-manifest.json");
const ENEMY_SPINE_INDEX_PATH = path.join(DATA_DIR, "enemy-spine-index.json");
const ENV_PATH = path.join(REPO_ROOT, ".env");

/** How many HEAD requests run at once. A few hundred requests against a CDN is fine in parallel, but unbounded fan-out is not polite. */
const CONCURRENCY = 8;

/** How often to print a progress line, in completed checks. Keeps a 400-request run followable without flooding the terminal. */
const PROGRESS_EVERY = 25;

/** How long a single HEAD request waits before it counts as a failure, in milliseconds. */
const REQUEST_TIMEOUT_MS = 15000;

/** Problems found so far. The run reports all of them rather than stopping at the first, matching `tools/data/check.mjs`. */
const failures = [];

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Record a failure.
 *
 * @param {string} message What went wrong.
 */
function fail(message) {
	failures.push(message);
}

/**
 * Read the asset host from `.env`.
 *
 * The site resolves `VITE_ASSET_BASE_URL` through `import.meta.env`, which only Vite can do. This script runs under plain Node, so it
 * reads the same `.env` line directly instead of importing the app's config.
 *
 * @returns {string} The asset host, exactly as `.env` stores it. Trailing-slash handling happens in `assetUrl`, not here.
 * @throws When `.env` is missing or carries no `VITE_ASSET_BASE_URL` line.
 */
function readAssetBaseUrl() {
	if (!fs.existsSync(ENV_PATH)) {
		throw new Error(`${ENV_PATH} is missing - cannot resolve the asset host`);
	}
	const contents = fs.readFileSync(ENV_PATH, "utf8");
	const match = contents.match(/^VITE_ASSET_BASE_URL=(.*)$/m);
	if (!match) {
		throw new Error(`${ENV_PATH} has no VITE_ASSET_BASE_URL line`);
	}
	return match[1].trim();
}

/**
 * Build an absolute asset URL the same way the site does.
 *
 * This has to stay in step with `src/lib/assets.ts` by hand, not by import - that file is TypeScript and reads `import.meta.env`, which
 * is awkward to pull into plain Node. It wraps `archive-kit`'s `createAssetUrls` (strip trailing slashes from the base, then join
 * percent-encoded path segments onto it), and its own builders derive these path shapes from an id, class name or key:
 * `portraits/<id>.webp`, `illustrations/<id>.webp`, `classes/<lowercase class name>.webp`, `enemies/<enemy id>.webp`,
 * `modules/<art key>.webp` and `module-types/<badge key>.webp`. If a future change to `src/lib/assets.ts`
 * alters any of those shapes, this script drifts silently until it starts passing checks it should fail - keep both sides in sync.
 *
 * @param {string} baseUrl The asset host, with or without a trailing slash.
 * @param {string} assetPath Unencoded path relative to the base, such as `portraits/char_002_amiya.webp`.
 * @returns {string} The absolute, percent-encoded URL.
 */
function assetUrl(baseUrl, assetPath) {
	const base = baseUrl.replace(/\/+$/, "");
	return `${base}/${assetPath.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Read every operator's id and display class name from the generated per-profession shards.
 *
 * @returns {Array<{id: string, profession: string}>} One entry per operator, across all shards.
 */
function loadOperators() {
	const operators = [];
	for (const name of fs.readdirSync(DATA_DIR).sort()) {
		if (!name.startsWith("operators-") || !name.endsWith(".json")) {
			continue;
		}
		const shard = JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
		for (const operator of shard) {
			operators.push({ id: operator.id, profession: operator.profession });
		}
	}
	return operators;
}

/**
 * Read the published-asset manifest, if one exists yet.
 *
 * @returns {unknown} The parsed manifest, or null when `src/data/assets-manifest.json` does not exist - the pre-A3 state, before the
 *     pipeline has published anything.
 */
function loadManifest() {
	if (!fs.existsSync(MANIFEST_PATH)) {
		return null;
	}
	return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

/**
 * Build the full list of URLs this run must confirm.
 *
 * Only assets the manifest actually claims are checked, mirroring `hasPortrait` and `hasIllustration` in `src/lib/assets.ts` exactly -
 * 21 of the 412 operators have no portrait upstream and never will, and checking those would report a correct absence as a failure.
 * Class icons carry no per-operator presence in the manifest, so all eight are always checked.
 *
 * @param {string} baseUrl The asset host.
 * @param {{portraits?: Record<string, boolean>, illustrations?: Record<string, boolean>, enemies?: Record<string, boolean>, moduleArt?: string[], moduleTypes?: string[]}} manifest
 *   The parsed asset manifest.
 * @param {Array<{id: string, profession: string}>} operators Every operator's id and display class name.
 * @param {Record<string, {skel: string, atlas: string}>} enemySpine The enemy rig index, or an empty object when none is committed.
 * @returns {Array<{label: string, url: string}>} The checks to run.
 */
function buildChecks(baseUrl, manifest, operators, enemySpine) {
	const checks = [];
	for (const { id } of operators) {
		if (manifest.portraits?.[id] === true) {
			checks.push({ label: `portrait ${id}`, url: assetUrl(baseUrl, `portraits/${id}.webp`) });
		}
		if (manifest.illustrations?.[id] === true) {
			checks.push({ label: `illustration ${id}`, url: assetUrl(baseUrl, `illustrations/${id}.webp`) });
		}
	}

	const professions = new Set(operators.map((operator) => operator.profession));
	for (const profession of professions) {
		checks.push({ label: `class icon ${profession}`, url: assetUrl(baseUrl, `classes/${profession.toLowerCase()}.webp`) });
	}

	for (const [id, present] of Object.entries(manifest.enemies ?? {})) {
		if (present === true) {
			checks.push({ label: `enemy icon ${id}`, url: assetUrl(baseUrl, `enemies/${id}.webp`) });
		}
	}

	for (const [id, rig] of Object.entries(enemySpine)) {
		checks.push({ label: `enemy rig ${id} skel`, url: assetUrl(baseUrl, `spine-enemies/${id}/${rig.skel}.skel`) });
		checks.push({ label: `enemy rig ${id} atlas`, url: assetUrl(baseUrl, `spine-enemies/${id}/${rig.atlas}.atlas`) });
	}

	for (const key of manifest.moduleArt ?? []) {
		checks.push({ label: `module art ${key}`, url: assetUrl(baseUrl, `modules/${key}.webp`) });
	}
	for (const key of manifest.moduleTypes ?? []) {
		checks.push({ label: `module badge ${key}`, url: assetUrl(baseUrl, `module-types/${key}.webp`) });
	}
	return checks;
}

/**
 * HEAD one URL and record a failure if it does not resolve to 200.
 *
 * @param {{label: string, url: string}} check The check to run.
 */
async function runCheck(check) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		// fetch follows redirects by default, so a 200 here could be a redirected error page rather than the asset itself. Not a real risk
		// against raw.githubusercontent.com, which 404s instead of redirecting, so this is left as the default rather than forced to "manual".
		const response = await fetch(check.url, { method: "HEAD", signal: controller.signal });
		if (response.status !== 200) {
			fail(`${check.label} -> HTTP ${response.status} at ${check.url}`);
		}
	} catch (error) {
		fail(`${check.label} -> ${error.message} at ${check.url}`);
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Run every check with a small concurrency limit, printing progress as checks complete.
 *
 * @param {Array<{label: string, url: string}>} checks Every check to run.
 */
async function runChecks(checks) {
	let nextIndex = 0;
	let completed = 0;

	async function worker() {
		while (nextIndex < checks.length) {
			const index = nextIndex;
			nextIndex += 1;
			await runCheck(checks[index]);
			completed += 1;
			if (completed % PROGRESS_EVERY === 0 || completed === checks.length) {
				console.log(`checked ${completed}/${checks.length}`);
			}
		}
	}

	const workerCount = Math.min(CONCURRENCY, checks.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Entry point

/** Resolve every URL the site can ask for and confirm the published repo actually serves it. */
async function main() {
	const manifest = loadManifest();
	if (!manifest) {
		console.log(`${MANIFEST_PATH} does not exist yet - nothing has been published, which is the correct pre-A3 state.`);
		return;
	}

	const baseUrl = readAssetBaseUrl();
	const operators = loadOperators();
	const enemySpine = fs.existsSync(ENEMY_SPINE_INDEX_PATH) ? JSON.parse(fs.readFileSync(ENEMY_SPINE_INDEX_PATH, "utf8")) : {};
	const checks = buildChecks(baseUrl, manifest, operators, enemySpine);

	console.log(`auditing ${checks.length} published asset URLs against ${baseUrl}`);
	await runChecks(checks);

	if (failures.length > 0) {
		console.error("");
		for (const message of failures) {
			console.error(`FAIL  ${message}`);
		}
		console.error(`\n${failures.length} problem(s) found.`);
		process.exit(1);
	}

	console.log("\nOK");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
