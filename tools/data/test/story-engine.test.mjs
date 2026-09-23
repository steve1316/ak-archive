import { test } from "node:test";
import assert from "node:assert/strict";

import { START, advance, applyCommand, choose, emptyEffects, emptyStage, skipToStop } from "../../../src/pages/story/engine.ts";

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
	assert.deepEqual(effects, { sounds: [{ key: "s_a", volume: 0.5 }], stopSounds: false, shake: 1, delay: 0.6, clearText: true });
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
