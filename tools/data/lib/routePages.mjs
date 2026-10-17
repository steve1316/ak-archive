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

/** The words a story id starts with once its group id is gone, such as the `level_` of `act40side_level_act40side_01_beg`. */
const STORY_KIND = /^(level|story)_/;

/**
 * The short name a story's URL ends in, with every part the URL already says dropped: the group id, `level_` or `story_`, and the group id
 * or `main_` again. So `act40side_level_act40side_01_beg` becomes `01_beg` and `main_10_level_main_10-01_beg` becomes `10-01_beg`. A group
 * with one story needs no name at all, which is nearly every operator record. `check.mjs` keeps the names unique within each group.
 *
 * @param {{id: string, stories: {id: string}[]}} group The story group.
 * @param {string} story The story id.
 * @returns {string} The short name, or an empty string for a group's only story.
 */
export function storySlug(group, story) {
	if (group.stories.length === 1) {
		return "";
	}
	const rest = (story.startsWith(`${group.id}_`) ? story.slice(group.id.length + 1) : story).replace(STORY_KIND, "");
	const repeat = [`${group.id}_`, "main_"].find((prefix) => rest.startsWith(prefix));
	return repeat ? rest.slice(repeat.length) : rest;
}

/**
 * A story's route under the site's base, without a leading slash: the group alone for its only story, or the group and the short name.
 *
 * @param {{id: string, stories: {id: string}[]}} group The story group.
 * @param {string} story The story id.
 * @returns {string} The route, such as `story/story_angel_set_1` or `story/act40side/01_beg`.
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
 * @param {{operatorIds: string[], enemyHeadIds: string[], storyGroups?: {id: string, stories: {id: string}[]}[]}} ids Every operator id,
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
