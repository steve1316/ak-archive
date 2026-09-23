import { test } from "node:test";
import assert from "node:assert/strict";

import { parseArgs, parseLine, parseScript, toSpans } from "../../story/parse_avg.mjs";

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

test("toSpans turns italics and colours into spans, drops size tags, and keeps a bracketed title as its words", () => {
	assert.deepEqual(toSpans("<color=#ff6237>Warning</color> ahead"), { text: "Warning ahead", spans: [{ text: "Warning", color: "#ff6237" }, { text: " ahead" }] });
	assert.deepEqual(toSpans("<i>Quiet</> now"), { text: "Quiet now", spans: [{ text: "Quiet", i: true }, { text: " now" }] });
	assert.deepEqual(toSpans("<p=1>Big</> <PRTS's First Functional Test>"), { text: "Big PRTS's First Functional Test" });
	assert.deepEqual(toSpans("Plain."), { text: "Plain." });
});

test("parseScript turns a script into flat steps, resolving variables and keeping unknown commands and choices", () => {
	const script = [
		'[HEADER(key="title_test", is_skippable=true)]',
		'[PlayMusic(intro="$escape_intro", key="$escape_loop", volume=0.8)]',
		'[Character(name="char_002_amiya_1#5", name2="char_130_doberm_ex", focus=1)]',
		'[name="Amiya"]  Hello, <i>Doctor</i> {@nickname}.',
		"Narration line.",
		'[multiline(name="Amiya")]And more.',
		'[Decision(options="Yes.;No.", values="1;2")]',
		'[Predicate(references="1")]',
		'[playsound(key="$missing_var")]',
		"[FancyNewThing(power=3)]",
		"[Static noise]",
		""
	].join("\r\n");
	const variables = { escape_intro: "Sound_Beta_2/Music/m_intro", escape_loop: "Sound_Beta_2/Music/m_loop" };
	assert.deepEqual(parseScript(script, variables), [
		{ t: "cmd", c: "header", a: { key: "title_test", is_skippable: true } },
		{ t: "cmd", c: "playmusic", a: { intro: "Sound_Beta_2/Music/m_intro", key: "Sound_Beta_2/Music/m_loop", volume: 0.8 } },
		{ t: "cmd", c: "character", a: { name: "char_002_amiya_1#5", name2: "char_130_doberm_ex", focus: 1 } },
		{ t: "line", name: "Amiya", text: "Hello, Doctor {@nickname}.", spans: [{ text: "Hello, " }, { text: "Doctor", i: true }, { text: " {@nickname}." }] },
		{ t: "line", name: null, text: "Narration line." },
		{ t: "line", name: "Amiya", text: "And more.", append: true },
		{ t: "decision", options: ["Yes.", "No."], values: ["1", "2"] },
		{ t: "predicate", refs: ["1"] },
		{ t: "cmd", c: "playsound", a: { key: "$missing_var" } },
		{ t: "unknown", c: "fancynewthing", a: { power: 3 } },
		{ t: "line", name: null, text: "[Static noise]" }
	]);
});

test("parseScript treats PlaySound and playsound as the same command", () => {
	const [upper, lower] = parseScript('[PlaySound(key="a")]\n[playsound(key="a")]');
	assert.deepEqual(upper, lower);
});
