/**
 * Write the story data the player reads: an index, one file per group and one file per story, and the title of each track the stories play,
 * plus the list of every asset the stories reference, which the asset pipeline publishes from.
 *
 * The output is rebuilt from scratch on every import, so a story upstream removes also leaves the site. A story whose script parses to no
 * steps is treated as missing rather than shipped, since the player would open it to a blank stage.
 */

import fs from "node:fs";
import path from "node:path";

import { writeJson } from "../data/lib/json.mjs";
import { listStoryScripts, loadStoryText, mapLimit } from "../data/lib/storyFiles.mjs";
import { loadTable } from "../data/lib/upstream.mjs";
import { buildStoryIndex, withoutStories } from "./build_index.mjs";
import { addAssetRefs, emptyAssetRefs, serializeAssetRefs } from "./keys.mjs";
import { musicTitles } from "./music_titles.mjs";
import { parseScript } from "./parse_avg.mjs";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Module constants

/** How many scripts download at once on a cold cache. */
const FETCH_LIMIT = 16;

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Writing

/**
 * Parse every story and write the story data.
 *
 * @param {{lock: {repo: string, server: string, sha: string}, outDir: string, reviewTable: object, chapterTable: object, handbookDict: object}} input
 * The pinned upstream, where generated data goes, and the three tables the index is built from.
 * @returns {Promise<{stories: number, groups: number, bytes: number, missing: string[], unknown: Map<string, number>, records: Map<string, {group: string, name: string}[]>}>}
 * What was written, the scripts left out, each unknown command's count, and each operator's record sets.
 */
export async function writeStoryData({ lock, outDir, reviewTable, chapterTable, handbookDict }) {
	// `audio_data` is for the music titles. It is 9 MB, so it downloads alongside the stories rather than after them.
	const [variables, scripts, audioData] = await Promise.all([loadTable("story/story_variables", lock), listStoryScripts(lock), loadTable("audio_data", lock)]);
	const plan = buildStoryIndex({ reviewTable, chapterTable, handbookDict, scripts });
	const storyDir = path.join(outDir, "story");
	fs.rmSync(storyDir, { recursive: true, force: true });

	const refs = emptyAssetRefs();
	const unknown = new Map();
	const empty = new Set();
	let bytes = 0;
	await mapLimit(plan.stories, FETCH_LIMIT, async (story) => {
		const steps = parseScript(await loadStoryText(story.path, story.sha, lock), variables);
		if (!steps.length) {
			empty.add(story.id);
			return;
		}
		addAssetRefs(steps, refs);
		for (const step of steps) {
			if (step.t === "unknown") {
				unknown.set(step.c, (unknown.get(step.c) ?? 0) + 1);
			}
		}
		bytes += writeJson(path.join(storyDir, "stories", `${story.id}.json`), { id: story.id, steps });
	});

	const final = withoutStories(
		plan,
		empty,
		plan.stories.filter((story) => empty.has(story.id)).map((story) => story.path)
	);
	let groups = 0;
	for (const group of Object.values(final.groups)) {
		bytes += writeJson(path.join(storyDir, "groups", `${group.id}.json`), group);
		groups++;
	}
	bytes += writeJson(path.join(storyDir, "story-index.json"), final.index);
	const assetRefs = serializeAssetRefs(refs);
	bytes += writeJson(path.join(outDir, "music-titles.json"), musicTitles(assetRefs.music, audioData));
	bytes += writeJson(path.join(outDir, "story-asset-refs.json"), assetRefs);
	return { stories: final.stories.length, groups, bytes, missing: final.index.missing, unknown, records: final.records };
}
