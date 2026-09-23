/**
 * Parser for the game's AVG story scripts, the `.txt` files under `gamedata/story/` in the upstream data.
 *
 * A script is one command a line. `[Command(key=value, ...)]` is a stage direction, `[name="Amiya"]  text` is a spoken line,
 * `[multiline(name="Amiya")]text` continues the speaker's box, and a bare line is narration. Command names come in mixed case in the data, so
 * they are matched lowercased. A command this module does not know is kept as an `unknown` step with its arguments rather than dropped, so
 * `check.mjs` can count it and the player can skip it.
 *
 * Choices stay flat. `Decision` offers the options and `Predicate` filters what follows by the picked value, up to the next `Predicate` - the
 * same way the game runs them - so the player, not this module, decides what to show.
 *
 * This module is pure: it takes script text and returns steps, so it is tested without the network.
 */

import { CONTENT_TAG } from "../data/lib/text.mjs";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Module constants

/** A command's head: its name, then `(` for an argument list, `=` for the `[name="X"]` form, or `]` for a bare command. */
const COMMAND_HEAD = /^\[(\w+)\s*([(=\]])/;

/**
 * Every command the player knows, lowercased. Measured across 60 scripts sampled from every story type at the pinned sha, minus the four that
 * `parseScript` turns into their own steps (`name`, `multiline`, `decision`, `predicate`).
 */
export const KNOWN_COMMANDS = new Set([
	"animtext",
	"animtextclean",
	"avgdisplay",
	"background",
	"backgroundtween",
	"bgeffect",
	"blocker",
	"cameraeffect",
	"camerashake",
	"cgitem",
	"character",
	"characteraction",
	"charslot",
	"curtain",
	"delay",
	"dialog",
	"effect",
	"focusout",
	"header",
	"hidecgitem",
	"hideitem",
	"image",
	"imagerotate",
	"imagetween",
	"interlude",
	"largebg",
	"largebgtween",
	"musicvolume",
	"playmusic",
	"playsound",
	"showitem",
	"soundvolume",
	"sticker",
	"stopmusic",
	"stopsound",
	"subtitle",
	"theater"
]);

/** Every step type `parseScript` emits. `check.mjs` rejects any other. */
export const STEP_TYPES = new Set(["line", "cmd", "unknown", "decision", "predicate"]);

/**
 * The inline tags a line can carry: `<i>` and `<color=...>` with their closers, which become spans, any other closer such as `</>`, a size tag
 * `<p=...>` that is dropped, and a bracketed title such as `<PRTS's First Functional Test>`, which keeps its words. Built on `CONTENT_TAG` so
 * titles are recognised exactly as the operator text's are.
 */
const INLINE_TAG = new RegExp(String.raw`<(\/?)(i|color)(?:=([^>]*))?>|<\/[^>]*>|<p=[^>]*>|` + CONTENT_TAG.source, "gi");

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Lines and arguments

/**
 * Find the next unquoted `close` character, skipping anything inside double quotes and any escaped character within them.
 *
 * @param {string} source The text to scan.
 * @param {number} from Where to start.
 * @param {string} close The character to find.
 * @returns {number} Its index, or -1 when there is none.
 */
function findClose(source, from, close) {
	let quoted = false;
	for (let index = from; index < source.length; index++) {
		const char = source[index];
		if (quoted && char === "\\") {
			index++;
			continue;
		}
		if (char === '"') {
			quoted = !quoted;
		} else if (char === close && !quoted) {
			return index;
		}
	}
	return -1;
}

/**
 * Parse a command's argument list, such as `image="bg_a", x=-20, block=true`.
 *
 * Quoted values keep commas and turn `\n` into a line break and `\"` into a quote. Unquoted values become numbers or booleans when they read as
 * one, and stay strings otherwise. Keys are lowercased, since the data spells the same key in several cases.
 *
 * @param {string} source The text between the parentheses.
 * @returns {Record<string, string | number | boolean>} The arguments.
 */
export function parseArgs(source) {
	const args = {};
	let index = 0;
	while (index < source.length) {
		while (index < source.length && /[\s,]/.test(source[index])) {
			index++;
		}
		const keyStart = index;
		while (index < source.length && /\w/.test(source[index])) {
			index++;
		}
		const key = source.slice(keyStart, index).toLowerCase();
		while (index < source.length && /\s/.test(source[index])) {
			index++;
		}
		if (source[index] !== "=") {
			// A bare word with no value, or a stray character. Step past it so the loop always advances.
			if (key) {
				args[key] = true;
			} else {
				index++;
			}
			continue;
		}
		index++;
		while (index < source.length && /\s/.test(source[index])) {
			index++;
		}
		let value;
		if (source[index] === '"') {
			index++;
			let text = "";
			while (index < source.length && source[index] !== '"') {
				if (source[index] === "\\" && index + 1 < source.length) {
					text += source[index + 1] === "n" ? "\n" : source[index + 1];
					index += 2;
					continue;
				}
				text += source[index++];
			}
			index++;
			value = text;
		} else {
			const start = index;
			while (index < source.length && source[index] !== ",") {
				index++;
			}
			const raw = source.slice(start, index).trim();
			value = raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
		}
		if (key) {
			args[key] = value;
		}
	}
	return args;
}

/**
 * Split one script line into a command or a piece of text.
 *
 * A line is a command only when it opens with `[name(`, `[name=` or `[name]`. Anything else, including a bracketed aside such as
 * `[Static noise]`, is text, so it reaches the reader instead of being mistaken for an unknown command.
 *
 * @param {string} line One line of a script.
 * @returns {null | {kind: "text", text: string} | {kind: "command", name: string, args: Record<string, string | number | boolean>, rest: string}}
 * Null for a blank line.
 */
export function parseLine(line) {
	const trimmed = line.trim();
	if (!trimmed) {
		return null;
	}
	const head = COMMAND_HEAD.exec(trimmed);
	if (!head) {
		return { kind: "text", text: trimmed };
	}
	let args = {};
	let close;
	if (head[2] === "(") {
		const open = head[0].length - 1;
		const paren = findClose(trimmed, open + 1, ")");
		if (paren === -1) {
			return { kind: "text", text: trimmed };
		}
		args = parseArgs(trimmed.slice(open + 1, paren));
		close = findClose(trimmed, paren + 1, "]");
	} else {
		close = findClose(trimmed, 1, "]");
		// `[name="Amiya"]` writes its one argument without parentheses, so the bracket's whole body is the argument list.
		if (head[2] === "=" && close !== -1) {
			args = parseArgs(trimmed.slice(1, close));
		}
	}
	if (close === -1) {
		return { kind: "text", text: trimmed };
	}
	return { kind: "command", name: head[1], args, rest: trimmed.slice(close + 1).trim() };
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Text and steps

/**
 * Turn a line's inline markup into plain text plus styled spans, so no raw tag reaches the shipped data.
 *
 * @param {string} raw The line as the script writes it.
 * @returns {{text: string, spans?: {text: string, i?: true, color?: string}[]}} The plain text, and spans only when some of it is styled.
 */
export function toSpans(raw) {
	const spans = [];
	const colors = [];
	let italic = false;
	let last = 0;
	const push = (text) => {
		if (!text) {
			return;
		}
		const style = { ...(italic ? { i: true } : {}), ...(colors.length ? { color: colors[colors.length - 1] } : {}) };
		const previous = spans[spans.length - 1];
		if (previous && previous.i === style.i && previous.color === style.color) {
			previous.text += text;
		} else {
			spans.push({ text, ...style });
		}
	};
	for (const match of raw.matchAll(INLINE_TAG)) {
		push(raw.slice(last, match.index));
		last = match.index + match[0].length;
		const [whole, closing, name, value, title] = match;
		if (title !== undefined) {
			push(title);
		} else if (name?.toLowerCase() === "i") {
			italic = !closing;
		} else if (name?.toLowerCase() === "color") {
			if (closing) {
				colors.pop();
			} else {
				colors.push(value ?? "");
			}
		} else if (whole.startsWith("</")) {
			// A bare closer ends the innermost style: a colour if one is open, italics otherwise.
			if (colors.length) {
				colors.pop();
			} else {
				italic = false;
			}
		}
	}
	push(raw.slice(last));
	const text = spans.map((span) => span.text).join("");
	return spans.some((span) => span.i || span.color) ? { text, spans } : { text };
}

/**
 * Build a line step.
 *
 * @param {string | null} name Who speaks, or null for narration.
 * @param {string} raw The line's text with its markup.
 * @returns {{t: "line", name: string | null, text: string, spans?: {text: string, i?: true, color?: string}[]}} The step.
 */
function lineStep(name, raw) {
	return { t: "line", name, ...toSpans(raw) };
}

/**
 * Split a `;`-separated argument, such as a decision's options, dropping empty parts.
 *
 * @param {unknown} value The argument's value.
 * @returns {string[]} The parts.
 */
function splitList(value) {
	return String(value ?? "")
		.split(";")
		.map((part) => part.trim())
		.filter((part) => part !== "");
}

/**
 * Replace each `$name` argument with its value from `story_variables.json`. An unknown variable is kept as written, so the asset pipeline
 * can report it rather than it vanishing.
 *
 * @param {Record<string, string | number | boolean>} args The command's arguments.
 * @param {Record<string, unknown>} variables The story variables table.
 * @returns {Record<string, unknown>} The arguments with variables resolved.
 */
function resolveVariables(args, variables) {
	return Object.fromEntries(
		Object.entries(args).map(([key, value]) => [key, typeof value === "string" && value.startsWith("$") && Object.hasOwn(variables, value.slice(1)) ? variables[value.slice(1)] : value])
	);
}

/**
 * Parse a whole script into steps.
 *
 * @param {string} text The script, with `\n` or `\r\n` line endings.
 * @param {Record<string, unknown>} [variables] The story variables table, for `$name` arguments.
 * @returns {Array<object>} The steps, in script order. See `STEP_TYPES` for their shapes.
 */
export function parseScript(text, variables = {}) {
	const steps = [];
	for (const raw of text.split(/\r?\n/)) {
		const parsed = parseLine(raw);
		if (!parsed) {
			continue;
		}
		if (parsed.kind === "text") {
			steps.push(lineStep(null, parsed.text));
			continue;
		}
		const command = parsed.name.toLowerCase();
		const args = resolveVariables(parsed.args, variables);
		if (command === "name") {
			steps.push(lineStep(args.name || null, parsed.rest));
		} else if (command === "multiline") {
			steps.push({ ...lineStep(args.name || null, parsed.rest), append: true });
		} else if (command === "decision") {
			steps.push({ t: "decision", options: splitList(args.options), values: splitList(args.values) });
		} else if (command === "predicate") {
			steps.push({ t: "predicate", refs: splitList(args.references) });
		} else {
			steps.push({ t: KNOWN_COMMANDS.has(command) ? "cmd" : "unknown", c: command, a: args });
		}
	}
	return steps;
}
