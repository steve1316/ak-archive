/**
 * Cleaning up the text the game ships.
 *
 * Upstream writes descriptions with inline styling tags around keywords and numbers, in several shapes: `<@ba.kw>` for a keyword,
 * `<@cc.vup>` for a buffed value, `<$ba.liftoff>` for a term with a tooltip, and `</>` to close any of them. None of it is content. Left in, it
 * either renders as literal angle brackets or forces the page to parse markup from an unlicensed upstream, so it comes out here and
 * `check.mjs` fails the import if any survives.
 */

/** Every inline tag shape upstream uses. */
const MARKUP = /<[^>]*>/g;

/**
 * Strip the game's inline markup out of a string.
 *
 * Line breaks are kept. Handbook entries such as the Basic Info block are newline-separated field lists, so collapsing all whitespace turns
 * them into one unreadable run. Only spaces and tabs are squeezed, and a run of blank lines comes down to one.
 *
 * @param {string} text The raw text.
 * @returns {string} The text with tags removed and whitespace tidied.
 */
export function stripMarkup(text) {
	return (text ?? "")
		.replace(MARKUP, "")
		.replace(/[^\S\n]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** One placeholder: `{key}`, or `{key:0%}` with one of the game's .NET-style number formats. */
const PLACEHOLDER = /\{([a-zA-Z_][\w.@]*)(?::([^}]+))?\}/g;

/**
 * Format one blackboard value the way its placeholder asks.
 *
 * The game uses .NET number formats. `0%` means a ratio shown as a whole-number percentage, so 2 reads as 200%, and `0.0` means one decimal.
 * Anything unrecognised falls back to the plain number, which is what a bare `{key}` gets.
 *
 * @param {number} value The blackboard value.
 * @param {string|undefined} format The format after the colon, if there was one.
 * @returns {string} The formatted value.
 */
function formatValue(value, format) {
	if (!format) {
		return String(value);
	}
	const percent = format.endsWith("%");
	const decimals = (/\.(0+)/.exec(format) ?? ["", ""])[1].length;
	const scaled = percent ? value * 100 : value;
	return `${scaled.toFixed(decimals)}${percent ? "%" : ""}`;
}

/**
 * Fill a templated description from its blackboard.
 *
 * Trait and talent text ships with `{key}` placeholders rather than numbers, so a page would otherwise print the template. The values live in
 * the same record's `blackboard` as key/value pairs, and keys are matched case-insensitively because the text does not always agree with the
 * blackboard on case. A placeholder with no matching key is left alone, so `check.mjs` catches it rather than it becoming an empty string.
 *
 * @param {string} text The templated text.
 * @param {Array<{key: string, value: number}>} blackboard The values for this record.
 * @returns {string} The text with every known placeholder filled in.
 */
export function resolveTemplate(text, blackboard) {
	const values = new Map(blackboard.map((entry) => [entry.key.toLowerCase(), entry.value]));
	return (text ?? "").replace(PLACEHOLDER, (whole, key, format) => {
		const value = values.get(key.toLowerCase());
		return value === undefined ? whole : formatValue(value, format);
	});
}
