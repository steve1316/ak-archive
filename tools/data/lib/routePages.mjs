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
 * Every route a reader can land on directly, relative to the site's base and without a leading slash, sorted and deduplicated.
 *
 * The art viewer, `operator/<n>/art`, is left out on purpose. Its page would need an `operator/<n>/` folder beside `operator/<n>.html`, and GitHub
 * Pages would then answer the operator page with a trailing-slash redirect. The viewer still works through `404.html`, as every route did before.
 *
 * The story picker gets a page, and so does every story at `story/<group>/<story>`. `/stories/<group>` does not: its page would need a
 * `stories/` folder beside `stories.html`, which is the same trailing-slash clash as the art viewer's.
 *
 * @param {{operatorIds: string[], enemyHeadIds: string[], storyPaths?: string[]}} ids Every operator id, every enemy group's head id, and every
 * story as a `<group>/<story>` pair.
 * @returns {string[]} The paths, such as `operator/10` and `enemy/1506`.
 */
export function routePagePaths({ operatorIds, enemyHeadIds, storyPaths = [] }) {
	const paths = new Set(["operators", "enemies"]);
	for (const id of operatorIds) {
		paths.add(`operator/${operatorNumber(id)}`);
	}
	for (const id of enemyHeadIds) {
		paths.add(`enemy/${enemyNumber(id)}`);
	}
	if (storyPaths.length) {
		paths.add("stories");
	}
	for (const storyPath of storyPaths) {
		paths.add(`story/${storyPath}`);
	}
	return [...paths].sort();
}
