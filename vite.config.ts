import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

import { baseTrailingSlash, routePages, spaFallback } from "archive-kit/config";

import { EMPTY_PRESENCE, slimManifest } from "./tools/data/lib/presence.mjs";
import { RIG_BUCKET_COUNT, splitRigIndex } from "./tools/data/lib/rigBuckets.mjs";
import { routePagePaths } from "./tools/data/lib/routePages.mjs";

// Pages serves the site from /ak-archive/, while Docker and local previews serve it from the root. VITE_BASE lets the same source produce both.
const BASE = process.env.VITE_BASE ?? "/ak-archive/";

/**
 * Folders the dev server does not watch: the asset pipeline's staging trees, which hold about 100,000 files of scratch art, rigs and audio that
 * no page imports. Watching them exhausts the system's file-watch limit and the dev server dies with `ENOSPC`.
 */
const WATCH_IGNORED = ["**/tools/assets/.staging/**", "**/tools/assets/.staging-*/**"];

/**
 * This config file's own folder, which is the repo root. Resolved from the file's URL rather than `process.cwd()`, so it holds regardless of
 * where `vite` was launched from.
 */
const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));

/** The generated story folder. Its groups and stories are served as static files, so no page carries a map of ~2,000 URLs. */
const STORY_DATA_DIR = path.join(REPO_ROOT, "src/data/story");

/** Where the story files are served, under the base. */
const STORY_DATA_PREFIX = "data/story/";

/**
 * The dev routes that serve files straight from disk: operator rigs under `__spine/`, enemy rigs under `__spine-enemies/` and story art and
 * audio under `__story/`, all from the offline pipeline's staging folders, plus the story files under `data/story/`, which a build copies instead.
 */
const STAGED_ROUTES: ReadonlyArray<{ prefix: string; root: string }> = [
	{ prefix: "__spine/", root: path.join(REPO_ROOT, "tools/assets/.staging/assets/spine") },
	{ prefix: "__spine-enemies/", root: path.join(REPO_ROOT, "tools/assets/.staging/assets/spine-enemies") },
	{ prefix: "__story/", root: path.join(REPO_ROOT, "tools/assets/.staging-story/assets") },
	{ prefix: STORY_DATA_PREFIX, root: STORY_DATA_DIR }
];

/** Content type served for each staged file extension. */
const STAGED_CONTENT_TYPES: Record<string, string> = {
	".png": "image/png",
	".atlas": "text/plain; charset=utf-8",
	".skel": "application/octet-stream",
	".json": "application/json",
	".webp": "image/webp",
	".mp3": "audio/mpeg"
};

/**
 * Resolves one staged file under `root` and writes it to the response. Answers 403 for a path that resolves outside the staging
 * folder and 404 for one that does not exist.
 *
 * @param root The staging folder this route serves.
 * @param rawPath The request path after the route's prefix, still URL-encoded and possibly carrying a query string.
 * @param res The response to write to.
 * @param headOnly True for a HEAD request, which gets the same status and headers but no body.
 */
async function serveStagedFile(root: string, rawPath: string, res: ServerResponse, headOnly: boolean): Promise<void> {
	let relative: string;
	try {
		relative = decodeURIComponent(rawPath.split("?")[0] ?? "");
	} catch {
		res.statusCode = 400;
		res.end("Bad request");
		return;
	}
	const resolved = path.resolve(root, relative);
	if (resolved !== root && !resolved.startsWith(root + path.sep)) {
		res.statusCode = 403;
		res.end("Forbidden");
		return;
	}
	try {
		const data = await fs.readFile(resolved);
		res.setHeader("Content-Type", STAGED_CONTENT_TYPES[path.extname(resolved).toLowerCase()] ?? "application/octet-stream");
		res.end(headOnly ? undefined : data);
	} catch {
		res.statusCode = 404;
		res.end("Not found");
	}
}

/**
 * Dev-only middleware serving the files in `STAGED_ROUTES` straight from disk. The `apply: "serve"` guard keeps this out of `vite build`
 * entirely, so a production build never touches the staging folders.
 *
 * @returns The Vite plugin.
 */
function stagedFilesPlugin(): Plugin {
	return {
		name: "staged-files",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const method = req.method ?? "";
				const route = req.url && (method === "GET" || method === "HEAD") ? STAGED_ROUTES.find((entry) => req.url?.startsWith(`${server.config.base}${entry.prefix}`)) : undefined;
				if (!route || !req.url) {
					next();
					return;
				}
				void serveStagedFile(route.root, req.url.slice(`${server.config.base}${route.prefix}`.length), res, method === "HEAD");
			});
		}
	};
}

/** The virtual module the site imports for asset presence, and the id Vite resolves it to. */
const PRESENCE_MODULE = "virtual:asset-presence";
const PRESENCE_RESOLVED = `\0${PRESENCE_MODULE}`;

/** The committed asset manifest the presence module is built from, and the two data files whose ids its missing lists are taken against. */
const MANIFEST_PATH = path.join(REPO_ROOT, "src/data/assets-manifest.json");
const SEARCH_INDEX_PATH = path.join(REPO_ROOT, "src/data/search-index.json");
const ENEMIES_PATH = path.join(REPO_ROOT, "src/data/enemies.json");

/** The virtual module carrying the story files' cache-busting version. */
const STORY_DATA_MODULE = "virtual:story-data";
const STORY_DATA_RESOLVED = `\0${STORY_DATA_MODULE}`;

/** The files whose contents version the story files: a data refresh or a republish changes at least one of them. */
const STORY_VERSION_FILES = [path.join(STORY_DATA_DIR, "story-index.json"), path.join(REPO_ROOT, "src/data/story-assets.json"), path.join(REPO_ROOT, "src/data/upstream.json")];

/** The virtual module that maps each rig index bucket file to its URL, and the id Vite resolves it to. */
const RIG_INDEX_MODULE = "virtual:rig-index-urls";
const RIG_INDEX_RESOLVED = `\0${RIG_INDEX_MODULE}`;

/** The two committed rig indexes the buckets are split from, keyed by the name their bucket files take. */
const RIG_INDEX_PATHS: Record<string, string> = {
	"spine-index": path.join(REPO_ROOT, "src/data/spine-index.json"),
	"enemy-spine-index": path.join(REPO_ROOT, "src/data/enemy-spine-index.json")
};

/** The dev route the rig index buckets are served under, since the dev server cannot serve emitted files. */
const RIG_INDEX_DEV_PREFIX = "__rig-index/";

/**
 * Every operator id, enemy variant id and enemy group head id the generated data names. The presence lists are taken against the first two,
 * and the route pages are written for the operators and the group heads.
 *
 * @returns The ids, read from the search index and the enemy index.
 */
async function dataIds(): Promise<{ operators: string[]; enemies: string[]; enemyHeads: string[] }> {
	const [operators, enemies] = await Promise.all([
		fs.readFile(SEARCH_INDEX_PATH, "utf8").then((text) => JSON.parse(text) as { id: string }[]),
		fs.readFile(ENEMIES_PATH, "utf8").then((text) => JSON.parse(text) as { id: string; variants: { id: string }[] }[])
	]);
	return {
		operators: operators.map((entry) => entry.id),
		enemies: enemies.flatMap((group) => group.variants.map((variant) => variant.id)),
		enemyHeads: enemies.map((group) => group.id)
	};
}

/**
 * Every route a reader can land on directly, operators, enemies and stories, for the kit's `routePages`, which writes a real page for each so
 * a shared link answers 200.
 *
 * @returns The route paths, relative to the base.
 */
async function routePageList(): Promise<string[]> {
	const ids = await dataIds();
	const groupDir = path.join(STORY_DATA_DIR, "groups");
	const groupFiles = await fs.readdir(groupDir).catch(() => [] as string[]);
	const groups = await Promise.all(groupFiles.map(async (file) => JSON.parse(await fs.readFile(path.join(groupDir, file), "utf8")) as { id: string; stories: { id: string }[] }));
	const storyPaths = groups.flatMap((group) => group.stories.map((story) => `${group.id}/${story.id}`));
	return routePagePaths({ operatorIds: ids.operators, enemyHeadIds: ids.enemyHeads, storyPaths });
}

/**
 * Serves `virtual:asset-presence`: the asset manifest reduced at build time to what the browser reads. Bundling the whole manifest cost every
 * page about 126 KB of startup script for a handful of presence checks. A missing manifest yields `EMPTY_PRESENCE`, so nothing counts as published.
 *
 * @returns The plugin.
 */
function assetPresencePlugin(): Plugin {
	return {
		name: "asset-presence",
		resolveId(source) {
			return source === PRESENCE_MODULE ? PRESENCE_RESOLVED : null;
		},
		async load(id) {
			if (id !== PRESENCE_RESOLVED) {
				return null;
			}
			for (const file of [MANIFEST_PATH, SEARCH_INDEX_PATH, ENEMIES_PATH]) {
				this.addWatchFile(file);
			}
			let presence = EMPTY_PRESENCE;
			try {
				const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"));
				presence = slimManifest(manifest, await dataIds());
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					throw error;
				}
			}
			return `export default ${JSON.stringify(presence)};`;
		}
	};
}

/**
 * Every rig index bucket, split fresh from the committed indexes.
 *
 * @returns Each bucket's JSON text, keyed by its file name without extension, such as `spine-index-3`.
 */
async function rigIndexBuckets(): Promise<Map<string, string>> {
	const indexes = await Promise.all(Object.entries(RIG_INDEX_PATHS).map(async ([name, file]) => [name, JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>] as const));
	return new Map(indexes.flatMap(([name, index]) => splitRigIndex(index).map((bucket, number) => [`${name}-${number}`, JSON.stringify(bucket)] as const)));
}

/**
 * Serves `virtual:rig-index-urls`: the URL of each bucket of the two chibi rig indexes. A page then fetches the one bucket its operator or enemy
 * is in, about 60 KB, rather than the whole 500 KB index. A build emits each bucket under a content-hashed name, and the dev server serves them
 * from memory under `__rig-index/`.
 *
 * @returns The plugin.
 */
function rigIndexPlugin(): Plugin {
	let base = "/";
	let building = false;
	return {
		name: "rig-index",
		configResolved(config) {
			base = config.base;
			building = config.command === "build";
		},
		configureServer(server) {
			// Split once and kept until a rig index changes on disk, since one page load asks for several buckets.
			let buckets: Promise<Map<string, string>> | null = null;
			server.watcher.on("change", (file) => {
				if (Object.values(RIG_INDEX_PATHS).includes(file)) {
					buckets = null;
				}
			});
			server.middlewares.use((req, res, next) => {
				const prefix = `${server.config.base}${RIG_INDEX_DEV_PREFIX}`;
				if (!req.url?.startsWith(prefix)) {
					next();
					return;
				}
				const name =
					req.url
						.slice(prefix.length)
						.split("?")[0]
						?.replace(/\.json$/, "") ?? "";
				buckets ??= rigIndexBuckets();
				buckets.then((split) => {
					const text = split.get(name);
					res.statusCode = text === undefined ? 404 : 200;
					res.setHeader("Content-Type", "application/json");
					res.end(text ?? "Not found");
				}, next);
			});
		},
		resolveId(source) {
			return source === RIG_INDEX_MODULE ? RIG_INDEX_RESOLVED : null;
		},
		async load(id) {
			if (id !== RIG_INDEX_RESOLVED) {
				return null;
			}
			for (const file of Object.values(RIG_INDEX_PATHS)) {
				this.addWatchFile(file);
			}
			const urls: Record<string, string> = {};
			if (building) {
				for (const [name, text] of await rigIndexBuckets()) {
					const fileName = `assets/${name}-${createHash("sha256").update(text).digest("hex").slice(0, 8)}.json`;
					this.emitFile({ type: "asset", fileName, source: text });
					urls[name] = `${base}${fileName}`;
				}
			} else {
				// The dev server splits on request, so the names are all this needs.
				for (const name of Object.keys(RIG_INDEX_PATHS)) {
					for (let number = 0; number < RIG_BUCKET_COUNT; number++) {
						urls[`${name}-${number}`] = `${base}${RIG_INDEX_DEV_PREFIX}${name}-${number}.json`;
					}
				}
			}
			return `export default ${JSON.stringify(urls)};`;
		}
	};
}

/**
 * A short content hash of the files that change whenever the story data does.
 *
 * @returns The first 10 hex characters of a sha256 over the files that exist.
 */
async function storyDataVersion(): Promise<string> {
	const hash = createHash("sha256");
	for (const file of STORY_VERSION_FILES) {
		try {
			hash.update(await fs.readFile(file));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}
	}
	return hash.digest("hex").slice(0, 10);
}

/**
 * Serves the story groups and stories as static files under `data/story/`. The dev server answers from `src/data/story` through `STAGED_ROUTES`,
 * and a build copies the folder into the output. `virtual:story-data` carries a content version the site appends to each URL, so a data refresh is never read from a
 * stale cache.
 *
 * @returns The plugin.
 */
function storyDataPlugin(): Plugin {
	return {
		name: "story-data",
		resolveId(source) {
			return source === STORY_DATA_MODULE ? STORY_DATA_RESOLVED : null;
		},
		async load(id) {
			if (id !== STORY_DATA_RESOLVED) {
				return null;
			}
			for (const file of STORY_VERSION_FILES) {
				this.addWatchFile(file);
			}
			return `export default ${JSON.stringify({ version: await storyDataVersion() })};`;
		},
		async writeBundle(options, bundle) {
			if (options.dir === undefined || !Object.hasOwn(bundle, "index.html")) {
				return;
			}
			await fs.cp(STORY_DATA_DIR, path.join(options.dir, STORY_DATA_PREFIX), { recursive: true });
			this.info(`copied story data to ${STORY_DATA_PREFIX}`);
		}
	};
}

export default defineConfig({
	base: BASE,
	server: { watch: { ignored: WATCH_IGNORED } },
	// stagedFilesPlugin runs first so its middleware attaches before spaFallback's catch-all, which would otherwise answer every
	// unmatched dev request with index.html before the staging route ever saw it.
	plugins: [stagedFilesPlugin(), assetPresencePlugin(), rigIndexPlugin(), storyDataPlugin(), react(), spaFallback(), baseTrailingSlash(), routePages(routePageList)],
	build: {
		outDir: "build",
		sourcemap: true,
		rolldownOptions: {
			output: {
				// React and its router change far less often than the app, and the refresh deploys often, so they get their own long-cached chunk. MUI is left to
				// automatic splitting: one MUI chunk would pull the operator page's Slider and Tabs back into the startup script.
				codeSplitting: {
					groups: [{ name: "react", test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 10 }]
				}
			}
		}
	}
});
