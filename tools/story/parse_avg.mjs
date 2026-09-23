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

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Module constants

/** A command's head: its name, then `(` for an argument list, `=` for the `[name="X"]` form, or `]` for a bare command. */
const COMMAND_HEAD = /^\[(\w+)\s*([(=\]])/;

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
