import fs from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

import { baseTrailingSlash, spaFallback } from "archive-kit/config";

import { EMPTY_PRESENCE, slimManifest } from "./tools/data/lib/presence.mjs";

// Pages serves the site from /ak-archive/, while Docker and local previews serve it from the root. VITE_BASE lets the same source produce both.
const BASE = process.env.VITE_BASE ?? "/ak-archive/";

/**
 * This config file's own folder, which is the repo root. Resolved from the file's URL rather than `process.cwd()`, so it holds regardless of
 * where `vite` was launched from.
 */
const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * The dev routes that serve staged Spine rigs straight from the offline pipeline's staging folder:
 * operator rigs under `__spine/` and enemy rigs under `__spine-enemies/`. Never bundled.
 */
const SPINE_STAGING_ROUTES: ReadonlyArray<{ prefix: string; root: string }> = [
	{ prefix: "__spine/", root: path.join(REPO_ROOT, "tools/assets/.staging/assets/spine") },
	{ prefix: "__spine-enemies/", root: path.join(REPO_ROOT, "tools/assets/.staging/assets/spine-enemies") }
];

/** Content type served for each staged Spine file extension. */
const SPINE_CONTENT_TYPES: Record<string, string> = {
	".png": "image/png",
	".atlas": "text/plain; charset=utf-8",
	".skel": "application/octet-stream"
};

/**
 * Resolves one staged Spine file under `root` and writes it to the response. Answers 403 for a path that resolves outside the staging
 * folder and 404 for one that does not exist.
 *
 * @param root The staging folder this route serves.
 * @param rawPath The request path after the route's prefix, still URL-encoded and possibly carrying a query string.
 * @param res The response to write to.
 * @param headOnly True for a HEAD request, which gets the same status and headers but no body.
 */
async function serveStagedSpineFile(root: string, rawPath: string, res: ServerResponse, headOnly: boolean): Promise<void> {
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
		res.setHeader("Content-Type", SPINE_CONTENT_TYPES[path.extname(resolved).toLowerCase()] ?? "application/octet-stream");
		res.end(headOnly ? undefined : data);
	} catch {
		res.statusCode = 404;
		res.end("Not found");
	}
}

/**
 * Dev-only middleware serving staged Spine rig files under `<base>__spine/` and `<base>__spine-enemies/`, straight from the offline
 * pipeline's staging folder. The `apply: "serve"` guard keeps this out of `vite build` entirely, so a production build never touches the staging folder.
 *
 * @returns The Vite plugin.
 */
function spineStagingPlugin(): Plugin {
	return {
		name: "spine-staging",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const method = req.method ?? "";
				const route = req.url && (method === "GET" || method === "HEAD") ? SPINE_STAGING_ROUTES.find((entry) => req.url?.startsWith(`${server.config.base}${entry.prefix}`)) : undefined;
				if (!route || !req.url) {
					next();
					return;
				}
				void serveStagedSpineFile(route.root, req.url.slice(`${server.config.base}${route.prefix}`.length), res, method === "HEAD");
			});
		}
	};
}

/** The virtual module the site imports for asset presence, and the id Vite resolves it to. */
const PRESENCE_MODULE = "virtual:asset-presence";
const PRESENCE_RESOLVED = `\0${PRESENCE_MODULE}`;

/** The committed asset manifest the presence module is built from. */
const MANIFEST_PATH = path.join(REPO_ROOT, "src/data/assets-manifest.json");

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
			this.addWatchFile(MANIFEST_PATH);
			let presence = EMPTY_PRESENCE;
			try {
				presence = slimManifest(JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8")));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					throw error;
				}
			}
			return `export default ${JSON.stringify(presence)};`;
		}
	};
}

export default defineConfig({
	base: BASE,
	// spineStagingPlugin runs first so its middleware attaches before spaFallback's catch-all, which would otherwise answer every
	// unmatched dev request with index.html before the staging route ever saw it.
	plugins: [spineStagingPlugin(), assetPresencePlugin(), react(), spaFallback(), baseTrailingSlash()],
	build: {
		outDir: "build",
		sourcemap: true
	}
});
