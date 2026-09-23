// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Story data and assets

/**
 * Loading the story data and building story asset URLs. The index and the asset manifest are hashed files from the glob below. Groups and
 * stories are static files under `data/story/`, versioned by `virtual:story-data`, since mapping ~2,000 of them would bloat the story chunk.
 * Only the story pages import this module, so none of it reaches the startup bundle.
 */

import { createDataStore } from "archive-kit";
import storyData from "virtual:story-data";

import { spriteKey } from "../../tools/story/keys.mjs";
import { storyAssets } from "./assets.js";
import type { StoryAssets, StoryFile, StoryGroup, StoryIndex } from "../types/story.js";

/** The kinds of story image: art the manifest records by sprite key, plus covers and map art recorded by group id. */
type StoryAssetKind = "backgrounds" | "images" | "sprites" | "covers" | "maps";

/** Which story assets are published. Anything absent renders nothing. */
export interface StoryPresence {
	/** Whether an image, cover or map art is published. */
	has: (kind: StoryAssetKind, name: string) => boolean;
	/** Whether an audio reference is published. */
	hasAudio: (ref: string) => boolean;
}

/** Hashed URLs of the story index and the asset manifest, keyed by bare file name. */
const INDEX_URLS = Object.fromEntries(
	Object.entries(import.meta.glob<string>(["../data/story/story-index.json", "../data/story-assets.json"], { query: "?url", import: "default", eager: true })).map(([file, url]) => [
		file.replace(/^.*\/|\.json$/g, ""),
		url
	])
);

/** The store owns fetching and the cache that drops a failed load so a retry actually retries. */
const store = createDataStore({ urls: INDEX_URLS });

/** Where the static story files are served. */
const STORY_FILE_BASE = `${import.meta.env.BASE_URL}data/story/`;

/**
 * The key an image is published under, the same rule as `manifest_key` in `tools/assets/story_names.py`.
 *
 * @param kind What it is.
 * @param name The reference, or the group id for covers and maps.
 * @returns The key.
 */
function assetKey(kind: StoryAssetKind, name: string): string {
	return kind === "covers" || kind === "maps" ? name : spriteKey(name);
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Loading

/**
 * Fetch one static story file.
 *
 * @param file The path under `data/story/`, such as `groups/main_0.json`.
 * @returns The parsed JSON.
 * @throws When the request fails or the body is not JSON.
 */
async function fetchStoryFile<T>(file: string): Promise<T> {
	const url = `${STORY_FILE_BASE}${file}?v=${storyData.version}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`${file} failed to load with HTTP ${response.status}`);
	}
	return (await response.json()) as T;
}

/**
 * Load the story index.
 *
 * @returns The index.
 */
export function loadStoryIndex(): Promise<StoryIndex> {
	return store.loadFile<StoryIndex>("story-index");
}

/**
 * Load one group's story list.
 *
 * @param id The group id.
 * @returns The group.
 */
export function loadStoryGroup(id: string): Promise<StoryGroup> {
	return store.loadOnce(`group:${id}`, () => fetchStoryFile<StoryGroup>(`groups/${encodeURIComponent(id)}.json`));
}

/**
 * Load one story.
 *
 * @param id The story id.
 * @returns The story.
 */
export function loadStory(id: string): Promise<StoryFile> {
	return store.loadOnce(`story:${id}`, () => fetchStoryFile<StoryFile>(`stories/${encodeURIComponent(id)}.json`));
}

/**
 * Load which story assets are published.
 *
 * @returns Presence checks over the manifest. An empty manifest, before the first publish, reports nothing as published.
 */
export function loadStoryPresence(): Promise<StoryPresence> {
	return store.loadOnce("presence", async () => {
		const manifest = Object.hasOwn(INDEX_URLS, "story-assets") ? await store.loadFile<StoryAssets>("story-assets") : null;
		const sets = new Map((["backgrounds", "images", "sprites", "covers", "maps", "audio"] as const).map((kind) => [kind, new Set(manifest?.[kind] ?? [])]));
		return {
			has: (kind, name) => sets.get(kind)?.has(assetKey(kind, name)) ?? false,
			hasAudio: (ref) => sets.get("audio")?.has(ref.toLowerCase()) ?? false
		};
	});
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// URLs

/**
 * The URL of a published story image, cover or map art.
 *
 * @param kind What it is.
 * @param name The reference, or the group id for covers and maps.
 * @param presence Which assets are published.
 * @returns The URL, or null when it is not published.
 */
export function storyAssetUrl(kind: StoryAssetKind, name: string, presence: StoryPresence): string | null {
	if (!presence.has(kind, name)) {
		return null;
	}
	return storyAssets.url(`${kind}/${assetKey(kind, name)}.webp`);
}

/**
 * The URL of a published sound or track.
 *
 * @param ref The reference, such as `Sound_Beta_2/Music/beta2_180603/m_dia_escape_loop`.
 * @param presence Which assets are published.
 * @returns The URL, or null when it is not published.
 */
export function storyAudioUrl(ref: string, presence: StoryPresence): string | null {
	return presence.hasAudio(ref) ? storyAssets.url(`audio/${ref.toLowerCase()}.mp3`) : null;
}
