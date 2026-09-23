import { test } from "node:test";
import assert from "node:assert/strict";

import { parseArgs, parseLine } from "../../story/parse_avg.mjs";

test("parseArgs reads quoted strings with commas and escapes, numbers, booleans and bare words, and lowercases keys", () => {
	const args = parseArgs('image="bg_a, b", x=-20, xScale=1.1, block = true, fit=BLACK_MASK, text="a\\nb \\"q\\""');
	assert.deepEqual(args, { image: "bg_a, b", x: -20, xscale: 1.1, block: true, fit: "BLACK_MASK", text: 'a\nb "q"' });
});

test("parseLine reads a spoken line's name and text", () => {
	assert.deepEqual(parseLine('[name="Amiya"]  Hello.'), { kind: "command", name: "name", args: { name: "Amiya" }, rest: "Hello." });
});

test("parseLine reads a bare command, and parentheses inside quoted arguments", () => {
	assert.deepEqual(parseLine("[Dialog]"), { kind: "command", name: "Dialog", args: {}, rest: "" });
	assert.deepEqual(parseLine('[Decision(options="Wait (quietly);Go", values="1;2")]'), {
		kind: "command",
		name: "Decision",
		args: { options: "Wait (quietly);Go", values: "1;2" },
		rest: ""
	});
});

test("parseLine keeps narration and a bracketed non-command as text, and skips blank lines", () => {
	assert.deepEqual(parseLine("6:30 a.m."), { kind: "text", text: "6:30 a.m." });
	assert.deepEqual(parseLine("[Static noise]"), { kind: "text", text: "[Static noise]" });
	assert.equal(parseLine("   "), null);
});
