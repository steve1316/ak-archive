/**
 * The route numbers the site's URLs use, and every route a reader can land on directly.
 *
 * GitHub Pages has no rewrite rules, so a deep link used to be served by the app's `404.html` with an HTTP 404 status: the page rendered, but
 * search engines and link previews saw "not found". The build writes a copy of `index.html` for each path listed here, so every one answers 200.
 * `src/lib/routes.ts` reads its numbers from here too, so the pages written and the links the app makes cannot disagree.
 */

/** An operator id's number, as in `char_010_chen`. */
const OPERATOR_NUMBER = /^char_(\d+)_/;

/** An enemy id's number, as in `enemy_1506_patrt`. */
const ENEMY_NUMBER = /^enemy_(\d+)_/;

/**
 * The number a pattern captures from an id, without leading zeros.
 *
 * @param {RegExp} pattern The id pattern, capturing the number.
 * @param {string} id The upstream id.
 * @returns {string} The number, or the id unchanged when it has no number.
 */
function numberIn(pattern, id) {
	const match = pattern.exec(id);
	return match?.[1] === undefined ? id : String(Number(match[1]));
}

/**
 * The short number an operator's URL uses, so `char_010_chen` becomes `10`.
 *
 * @param {string} id The upstream operator id.
 * @returns {string} The number, or the id unchanged when it has none.
 */
export function operatorNumber(id) {
	return numberIn(OPERATOR_NUMBER, id);
}

/**
 * The short number an enemy group's URL uses, so `enemy_1023_jmage` becomes `1023`.
 *
 * @param {string} id The upstream enemy id.
 * @returns {string} The number, or the id unchanged when it has none.
 */
export function enemyNumber(id) {
	return numberIn(ENEMY_NUMBER, id);
}

/**
 * The parts of a story group a story's URL is built from: its id, and each story's id with the stage code and tag its short name uses.
 *
 * @typedef {{id: string, stories: {id: string, code: string | null, tag: string}[]}} StoryGroupIds
 */

/** The words a story id starts with once its group id is gone, such as the `level_` of `act40side_level_act40side_01_beg`. */
const STORY_KIND = /^(level|story)_/;

/**
 * A story's short name in the form the first short URLs used, built from its file name: the id with every part the URL already says dropped.
 * So `act40side_level_act40side_01_beg` becomes `01_beg`. Main story files count battles apart from story-only stages, so this name can be
 * a number off what a reader sees, and links in this form now only redirect.
 *
 * @param {{id: string}} group The story group.
 * @param {string} story The story id.
 * @returns {string} The file-based short name.
 */
export function fileStorySlug(group, story) {
	const rest = (story.startsWith(`${group.id}_`) ? story.slice(group.id.length + 1) : story).replace(STORY_KIND, "");
	const repeat = [`${group.id}_`, "main_"].find((prefix) => rest.startsWith(prefix));
	return repeat ? rest.slice(repeat.length) : rest;
}

/** The word a story's tag adds to its short name, so the two stories around one battle differ. */
const TAG_WORDS = new Map([
	["Before Operation", "before"],
	["After Operation", "after"]
]);

/** Each group's short names, built once per group object. */
const slugCache = new WeakMap();

/**
 * Every story's short name in a group, from the stage code a reader sees, such as `10-2-before` for `main_10_level_main_10-01_beg` or
 * `or-1-after`. A story with no code keeps its {@link fileStorySlug}. A name already taken gets `-2`, `-3` and so on, as the alternate
 * endings of 15-17 do. A group with one story needs no name at all, which is nearly every operator record.
 *
 * @param {StoryGroupIds} group The story group.
 * @returns {Map<string, string>} The short names by story id, empty for a group with one story.
 */
function storySlugs(group) {
	let slugs = slugCache.get(group);
	if (slugs) {
		return slugs;
	}
	slugs = new Map();
	if (group.stories.length > 1) {
		const used = new Set();
		for (const story of group.stories) {
			const tag = TAG_WORDS.get(story.tag);
			const base = story.code ? [story.code.toLowerCase(), tag].filter(Boolean).join("-") : fileStorySlug(group, story.id);
			let slug = base;
			for (let n = 2; used.has(slug); n++) {
				slug = `${base}-${n}`;
			}
			used.add(slug);
			slugs.set(story.id, slug);
		}
	}
	slugCache.set(group, slugs);
	return slugs;
}

/**
 * The short name a story's URL ends in. See `storySlugs` for how it is built.
 *
 * @param {StoryGroupIds} group The story group.
 * @param {string} story The story id.
 * @returns {string} The short name, or an empty string for a group's only story.
 */
export function storySlug(group, story) {
	return storySlugs(group).get(story) ?? "";
}

/**
 * A story's route under the site's base, without a leading slash: the group alone for its only story, or the group and the short name.
 *
 * @param {StoryGroupIds} group The story group.
 * @param {string} story The story id.
 * @returns {string} The route, such as `story/story_angel_set_1` or `story/act40side/or-1-before`.
 */
export function storyRoute(group, story) {
	const slug = storySlug(group, story);
	return slug ? `story/${group.id}/${slug}` : `story/${group.id}`;
}

/**
 * Every route a reader can land on directly, relative to the site's base and without a leading slash, sorted and deduplicated.
 *
 * The art viewer, `operator/<n>/art`, is left out on purpose. Its page would need an `operator/<n>/` folder beside `operator/<n>.html`, and GitHub
 * Pages would then answer the operator page with a trailing-slash redirect. The viewer still works through `404.html`, as every route did before.
 *
 * The story picker gets a page, and so does every story at its {@link storyRoute}. A group's only story sits at `story/<group>` and a longer
 * group's stories in a `story/<group>/` folder, so the two never meet. `/stories/<group>` gets no page: it would need a `stories/` folder
 * beside `stories.html`, which is the same trailing-slash clash as the art viewer's.
 *
 * @param {{operatorIds: string[], enemyHeadIds: string[], storyGroups?: StoryGroupIds[]}} ids Every operator id,
 * every enemy group's head id, and every story group.
 * @returns {string[]} The paths, such as `operator/10` and `enemy/1506`.
 */
export function routePagePaths({ operatorIds, enemyHeadIds, storyGroups = [] }) {
	const paths = new Set(["operators", "enemies"]);
	for (const id of operatorIds) {
		paths.add(`operator/${operatorNumber(id)}`);
	}
	for (const id of enemyHeadIds) {
		paths.add(`enemy/${enemyNumber(id)}`);
	}
	if (storyGroups.length) {
		paths.add("stories");
	}
	for (const group of storyGroups) {
		for (const story of group.stories) {
			paths.add(storyRoute(group, story.id));
		}
	}
	return [...paths].sort();
}
