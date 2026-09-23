/// <reference types="vite/client" />

/**
 * Turns off Vite's catch-all `[key: string]: any` on `ImportMetaEnv`.
 *
 * Without it every `import.meta.env.WHATEVER` typechecks as `any`, so a typo in a variable name is only found by looking at a broken page. With
 * it, only the variables declared below exist, and a misspelt one is a build error.
 */
interface ViteTypeOptions {
	/** The presence of this key is the switch. Its type is never read. */
	strictImportMetaEnv: unknown;
}

/** The environment variables this app reads, on top of Vite's own `BASE_URL`, `MODE`, `DEV`, `PROD` and `SSR`. */
interface ImportMetaEnv {
	/** Base URL of the asset host, set in `.env`. Every asset URL is built from it, so an empty one makes every image path relative. */
	readonly VITE_ASSET_BASE_URL: string;
	/** Base URL of the story asset repo, with a trailing slash. A dev checkout can point it at the local `__story/` route. */
	readonly VITE_STORY_ASSET_BASE_URL?: string;
}

/** Vite's own `import.meta`, redeclared so the typed `env` above is what the app sees. */
interface ImportMeta {
	/** The environment variables above, inlined into the bundle at build time. */
	readonly env: ImportMetaEnv;
}

/** The asset manifest reduced to what the browser reads, built by `assetPresencePlugin` in `vite.config.ts`. */
declare module "virtual:asset-presence" {
	const presence: import("../tools/data/lib/presence.mjs").AssetPresence;
	export default presence;
}

/** The URL of each chibi rig index bucket, keyed by file name such as `spine-index-3`, built by `rigIndexPlugin` in `vite.config.ts`. */
declare module "virtual:rig-index-urls" {
	const urls: Record<string, string>;
	export default urls;
}

/** The story files' content version, built by `storyDataPlugin` in `vite.config.ts`. */
declare module "virtual:story-data" {
	const storyData: { version: string };
	export default storyData;
}
