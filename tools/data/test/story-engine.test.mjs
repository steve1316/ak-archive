import { test } from "node:test";
import assert from "node:assert/strict";

import { START, advance, applyCommand, choose, emptyEffects, emptyStage, fillNickname, lineNumber, lineOrder, skipToStop, upcomingArt } from "../../../src/pages/story/engine.ts";

/**
 * A line step.
 *
 * @param {string | null} name Who speaks.
 * @param {string} text The line.
 * @returns {object} The step.
 */
const line = (name, text) => ({ t: "line", name, text });

/**
 * A command step.
 *
 * @param {string} c The command.
 * @param {object} [a] Its arguments.
 * @returns {object} The step.
 */
const cmd = (c, a = {}) => ({ t: "cmd", c, a });

test("advance applies commands up to the next line and stops there, then reaches the end", () => {
	const steps = [cmd("background", { image: "bg_a", fadetime: 1 }), cmd("playmusic", { intro: "m_i", key: "m_l", volume: 0.8 }), line("Amiya", "Hi."), line(null, "Next.")];
	const first = advance(steps, START, emptyStage());
	assert.equal(first.stop.kind, "line");
	assert.equal(first.stop.line.text, "Hi.");
	assert.equal(first.stage.background.name, "bg_a");
	assert.deepEqual(first.stage.music, { intro: "m_i", loop: "m_l", volume: 0.8, crossfade: 0 });
	const second = advance(steps, first.cursor, first.stage);
	assert.equal(second.stop.line.text, "Next.");
	assert.equal(advance(steps, second.cursor, second.stage).stop.kind, "end");
});

test("character places one, two or three sprites, focuses the speaker, and clears with no names", () => {
	const effects = emptyEffects();
	assert.deepEqual(applyCommand(emptyStage(), cmd("character", { name: "a" }), effects).sprites, { m: "a" });
	const two = applyCommand(emptyStage(), cmd("character", { name: "a", name2: "b", focus: 2 }), effects);
	assert.deepEqual([two.sprites, two.focus], [{ l: "a", r: "b" }, "r"]);
	assert.deepEqual(applyCommand(emptyStage(), cmd("character", { name: "a", name2: "b", name3: "c" }), effects).sprites, { l: "a", m: "b", r: "c" });
	assert.deepEqual(applyCommand(two, cmd("character"), effects).sprites, {});
});

test("charslot fills a slot, moves the focus, empties one slot, and clears every slot", () => {
	const effects = emptyEffects();
	let stage = applyCommand(emptyStage(), cmd("charslot", { slot: "l", name: "a" }), effects);
	stage = applyCommand(stage, cmd("charslot", { slot: "r", name: "b", focus: "r" }), effects);
	assert.deepEqual([stage.sprites, stage.focus], [{ l: "a", r: "b" }, "r"]);
	assert.deepEqual(applyCommand(stage, cmd("charslot", { slot: "l" }), effects).sprites, { r: "b" });
	assert.deepEqual(applyCommand(stage, cmd("charslot"), effects).sprites, {});
});

test("a choice stops the walk, and predicates show only the picked branch until a bare predicate rejoins", () => {
	const steps = [
		cmd("dialog"),
		{ t: "decision", options: ["A", "B"], values: ["1", "2"] },
		{ t: "predicate", refs: ["1"] },
		line(null, "picked A"),
		{ t: "predicate", refs: ["2"] },
		line(null, "picked B"),
		{ t: "predicate", refs: null },
		line(null, "both")
	];
	const atChoice = advance(steps, START, emptyStage());
	assert.equal(atChoice.stop.kind, "decision");
	assert.deepEqual(atChoice.stop.decision.options, ["A", "B"]);
	const afterB = advance(steps, choose(atChoice.cursor, "2"), atChoice.stage);
	assert.equal(afterB.stop.line.text, "picked B");
	assert.equal(advance(steps, afterB.cursor, afterB.stage).stop.line.text, "both");
	const afterA = advance(steps, choose(atChoice.cursor, "1"), atChoice.stage);
	assert.equal(afterA.stop.line.text, "picked A");
	assert.equal(advance(steps, afterA.cursor, afterA.stage).stop.line.text, "both");
});

test("a predicate listing every value shows its lines whatever was picked", () => {
	const steps = [{ t: "decision", options: ["A", "B"], values: ["1", "2"] }, { t: "predicate", refs: ["1", "2"] }, line(null, "shared")];
	const atChoice = advance(steps, START, emptyStage());
	assert.equal(advance(steps, choose(atChoice.cursor, "2"), atChoice.stage).stop.line.text, "shared");
});

test("effects collect sounds, shakes, pauses and a cleared box on the way to a line", () => {
	const steps = [cmd("playsound", { key: "s_a", volume: 0.5 }), cmd("camerashake", { duration: 1 }), cmd("delay", { time: 0.6 }), cmd("dialog"), line(null, "x")];
	const { effects } = advance(steps, START, emptyStage());
	assert.deepEqual(effects, { sounds: [{ kind: "play", key: "s_a", volume: 0.5, loop: false, channel: null }], musicFade: 0, shake: 1, delay: 0.6, clearText: true });
});

test("blockers, art scenes with their tween, grayscale and unknown commands fold into the stage", () => {
	const effects = emptyEffects();
	let stage = applyCommand(emptyStage(), cmd("blocker", { a: 1, r: 0, g: 0, b: 0, fadetime: 0.6 }), effects);
	assert.deepEqual(stage.blocker, { color: "rgb(0, 0, 0)", alpha: 1, fade: 0.6 });
	stage = applyCommand(stage, cmd("image", { image: "avg_1_3", x: 0, y: -20, xscale: 1.1, yscale: 1.1, fadetime: 1 }), effects);
	stage = applyCommand(stage, cmd("imagetween", { xfrom: 0, yfrom: -20, xto: 0, yto: 0, xscalefrom: 1.1, yscalefrom: 1.1, xscaleto: 1, yscaleto: 1, duration: 4 }), effects);
	assert.deepEqual(stage.image, { name: "avg_1_3", kind: "images", from: { x: 0, y: -20, xScale: 1.1, yScale: 1.1 }, to: { x: 0, y: 0, xScale: 1, yScale: 1 }, duration: 4, fade: 1 });
	stage = applyCommand(stage, cmd("cameraeffect", { effect: "Grayscale", amount: 0.8 }), effects);
	assert.equal(stage.grayscale, true);
	assert.equal(applyCommand(stage, { t: "unknown", c: "video", a: {} }, effects), stage);
	assert.equal(applyCommand(stage, cmd("image"), effects).image, null);
});

test("skipToStop runs to the next choice or the end and returns every line passed", () => {
	const steps = [line(null, "a"), line(null, "b"), { t: "decision", options: ["X"], values: ["1"] }, line(null, "c")];
	const first = advance(steps, START, emptyStage());
	const skipped = skipToStop(steps, first.cursor, first.stage);
	assert.equal(skipped.result.stop.kind, "decision");
	assert.deepEqual(
		skipped.lines.map((entry) => entry.text),
		["b"]
	);
	const toEnd = skipToStop(steps, choose(skipped.result.cursor, "1"), skipped.result.stage);
	assert.equal(toEnd.result.stop.kind, "end");
	assert.deepEqual(
		toEnd.lines.map((entry) => entry.text),
		["c"]
	);
});

test("each layer records the asset kind its art is published under, so a large background finds its art in images", () => {
	const effects = emptyEffects();
	assert.equal(applyCommand(emptyStage(), cmd("background", { image: "bg_a" }), effects).background.kind, "backgrounds");
	assert.equal(applyCommand(emptyStage(), cmd("largebg", { imagegroup: "bg_b/bg_c" }), effects).background.kind, "images");
	assert.equal(applyCommand(emptyStage(), cmd("image", { image: "avg_1" }), effects).image.kind, "images");
});

test("each subtitle with text is a stop the reader clicks past, and a bare subtitle clears it", () => {
	const steps = [cmd("subtitle", { text: "Nightfall." }), cmd("subtitle", { text: "The boilers rumble." }), cmd("subtitle"), line(null, "After.")];
	const first = advance(steps, START, emptyStage());
	assert.deepEqual([first.stop.kind, first.stop.text, first.stage.subtitle.text], ["caption", "Nightfall.", "Nightfall."]);
	const second = advance(steps, first.cursor, first.stage);
	assert.deepEqual([second.stop.kind, second.stop.text], ["caption", "The boilers rumble."]);
	const third = advance(steps, second.cursor, second.stage);
	assert.deepEqual([third.stop.kind, third.stage.subtitle], ["line", null]);
});

test("stickers stack by id, multi appends to its id, block=false does not stop, and an id with no text or stickerclear removes them", () => {
	const steps = [
		cmd("sticker", { id: "st1", multi: true, block: true, text: "Dear K," }),
		cmd("sticker", { id: "st1", multi: true, block: true, text: "\n\nI write." }),
		cmd("sticker", { id: "st2", block: false, text: "Seal" }),
		cmd("sticker", { id: "st3", text: "P.S." }),
		cmd("sticker", { id: "st1" }),
		line(null, "Read."),
		cmd("stickerclear"),
		line(null, "Cleared.")
	];
	const first = advance(steps, START, emptyStage());
	assert.deepEqual([first.stop.kind, first.stop.text, first.stage.stickers], ["caption", "Dear K,", [{ id: "st1", text: "Dear K," }]]);
	const second = advance(steps, first.cursor, first.stage);
	assert.deepEqual([second.stop.text, second.stage.stickers[0].text], ["I write.", "Dear K,\n\nI write."]);
	const third = advance(steps, second.cursor, second.stage);
	assert.deepEqual([third.stop.text, third.stage.stickers.map((entry) => entry.id)], ["P.S.", ["st1", "st2", "st3"]]);
	const fourth = advance(steps, third.cursor, third.stage);
	assert.deepEqual([fourth.stop.kind, fourth.stage.stickers.map((entry) => entry.id)], ["line", ["st2", "st3"]]);
	assert.deepEqual(advance(steps, fourth.cursor, fourth.stage).stage.stickers, []);
});

test("skipToStop passes captions too and returns their text with the lines", () => {
	const steps = [line(null, "a"), cmd("subtitle", { text: "Narration." }), line("K", "b")];
	const first = advance(steps, START, emptyStage());
	const skipped = skipToStop(steps, first.cursor, first.stage);
	assert.equal(skipped.result.stop.kind, "end");
	assert.deepEqual(skipped.lines, [
		{ name: null, text: "Narration." },
		{ name: "K", text: "b" }
	]);
});

test("fillNickname puts the reader's name into a line's text and every styled run", () => {
	assert.equal(fillNickname("Hello, {@nickname}. {@nickname}?", "Kal"), "Hello, Kal. Kal?");
	assert.deepEqual(fillNickname({ text: "Hi {@nickname}", spans: [{ text: "Hi " }, { text: "{@nickname}", i: true }] }, "Kal"), {
		text: "Hi Kal",
		spans: [{ text: "Hi " }, { text: "Kal", i: true }]
	});
});

test("sound cues keep their order, loop flag and channel, and stopsound stops one channel or all of them with its fade", () => {
	const steps = [
		cmd("playsound", { key: "rain", loop: true, channel: "bgs", volume: 0.4 }),
		cmd("stopsound", { channel: "bgs", fadetime: 1.5 }),
		cmd("playsound", { key: "door" }),
		cmd("stopsound"),
		line(null, "x")
	];
	assert.deepEqual(advance(steps, START, emptyStage()).effects.sounds, [
		{ kind: "play", key: "rain", volume: 0.4, loop: true, channel: "bgs" },
		{ kind: "stop", channel: "bgs", fade: 1.5 },
		{ kind: "play", key: "door", volume: 1, loop: false, channel: null },
		{ kind: "stop", channel: null, fade: 0 }
	]);
});

test("stopmusic records its fade-out time", () => {
	const steps = [cmd("playmusic", { key: "m_loop", crossfade: 2 }), line(null, "a"), cmd("stopmusic", { fadetime: 3 }), line(null, "b")];
	const first = advance(steps, START, emptyStage());
	assert.equal(first.stage.music.crossfade, 2);
	const second = advance(steps, first.cursor, first.stage);
	assert.deepEqual([second.stage.music, second.effects.musicFade], [null, 3]);
});

test("upcomingArt lists the art the next few stops show, once each, and stops looking at a choice", () => {
	const steps = [
		line(null, "now"),
		cmd("background", { image: "bg_a" }),
		cmd("character", { name: "char_1", name2: "char_2" }),
		line(null, "one"),
		cmd("largebg", { imagegroup: "bg_b/bg_c" }),
		cmd("character", { name: "char_1" }),
		line(null, "two"),
		{ t: "decision", options: ["X"], values: ["1"] },
		cmd("image", { image: "avg_hidden" }),
		line(null, "three")
	];
	const first = advance(steps, START, emptyStage());
	assert.deepEqual(upcomingArt(steps, first.cursor, first.stage, 5), [
		{ kind: "backgrounds", name: "bg_a" },
		{ kind: "sprites", name: "char_1" },
		{ kind: "sprites", name: "char_2" },
		{ kind: "images", name: "bg_b" }
	]);
	assert.deepEqual(upcomingArt(steps, first.cursor, first.stage, 1).length, 3);
});

test("fillNickname drops the Dr. before a reader named Doctor, so no line reads Dr. Doctor", () => {
	assert.equal(fillNickname("Hello, Dr. {@nickname}. Dr.{@nickname}? {@nickname}!", "Doctor"), "Hello, Doctor. Doctor? Doctor!");
	assert.equal(fillNickname("Hello, Dr. {@nickname}.", "Kal"), "Hello, Dr. Kal.");
});

test("lineOrder counts lines and captions in script order, both sides of a branch, and lineNumber reads the count at each stop", () => {
	const steps = [
		cmd("playmusic", { key: "m_l" }),
		line("Amiya", "One."),
		cmd("subtitle", { text: "Two." }),
		cmd("sticker", { id: "s", text: "Not a stop.", block: false }),
		{ t: "decision", options: ["A", "B"], values: ["1", "2"] },
		{ t: "predicate", refs: ["1"] },
		line(null, "Three, on A."),
		{ t: "predicate", refs: ["2"] },
		line(null, "Four, on B."),
		{ t: "predicate", refs: null },
		line(null, "Five.")
	];
	const order = lineOrder(steps);
	assert.equal(order.total, 5);
	const first = advance(steps, START, emptyStage());
	assert.equal(lineNumber(order, first.cursor), 1);
	const caption = advance(steps, first.cursor, first.stage);
	assert.equal(caption.stop.kind, "caption");
	assert.equal(lineNumber(order, caption.cursor), 2);
	const decision = advance(steps, caption.cursor, caption.stage);
	assert.equal(decision.stop.kind, "decision");
	assert.equal(lineNumber(order, decision.cursor), 2);
	// Picking A leaves B's line unread, so the count jumps from 3 to 5.
	const onA = advance(steps, choose(decision.cursor, "1"), decision.stage);
	assert.equal(lineNumber(order, onA.cursor), 3);
	const rejoined = advance(steps, onA.cursor, onA.stage);
	assert.equal(rejoined.stop.line.text, "Five.");
	assert.equal(lineNumber(order, rejoined.cursor), 5);
	const end = advance(steps, rejoined.cursor, rejoined.stage);
	assert.equal(end.stop.kind, "end");
	assert.equal(lineNumber(order, end.cursor), 5);
});
