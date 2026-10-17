import { test } from "node:test";
import assert from "node:assert/strict";

import { shakeFrames } from "../../../src/pages/story/shake.ts";
import { START, advance, applyCommand, choose, emptyEffects, emptyStage, fillNickname, linesAhead, skipToStop, upcomingArt } from "../../../src/pages/story/engine.ts";

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

test("charslot fills a slot, moves the focus, keeps a slot that is only focused or moved, and clears every slot", () => {
	const effects = emptyEffects();
	let stage = applyCommand(emptyStage(), cmd("charslot", { slot: "l", name: "a" }), effects);
	stage = applyCommand(stage, cmd("charslot", { slot: "r", name: "b", focus: "r" }), effects);
	assert.deepEqual([stage.sprites, stage.focus], [{ l: "a", r: "b" }, "r"]);
	assert.deepEqual(applyCommand(stage, cmd("charslot", { slot: "l" }), effects).sprites, { r: "b" });
	assert.deepEqual(applyCommand(stage, cmd("charslot", { slot: "l", focus: "l" }), effects).sprites, { l: "a", r: "b" });
	assert.deepEqual(applyCommand(stage, cmd("charslot", { slot: "l", posfrom: "0,0", posto: "10,0" }), effects).sprites, { l: "a", r: "b" });
	assert.deepEqual(applyCommand(stage, cmd("charslot", { slot: "l", ato: 0 }), effects).sprites, { r: "b" });
	assert.deepEqual(applyCommand(stage, cmd("charslot"), effects).sprites, {});
});

test("charslot reads left, right and middle in any case as slots and focus", () => {
	const effects = emptyEffects();
	let stage = applyCommand(emptyStage(), cmd("charslot", { slot: "left", name: "a" }), effects);
	stage = applyCommand(stage, cmd("charslot", { slot: "Right", name: "b", focus: "R" }), effects);
	stage = applyCommand(stage, cmd("charslot", { slot: "MIDDLE", name: "c" }), effects);
	assert.deepEqual([stage.sprites, stage.focus], [{ l: "a", r: "b", m: "c" }, "r"]);
	assert.equal(applyCommand(stage, cmd("charslot", { slot: "left", focus: "left" }), effects).focus, "l");
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

test("effects collect sounds, shakes and a cleared box on the way to a line, across a pause", () => {
	const steps = [cmd("playsound", { key: "s_a", volume: 0.5 }), cmd("camerashake", { duration: 1 }), cmd("delay", { time: 0.6 }), cmd("dialog"), line(null, "x")];
	const { effects } = advance(steps, START, emptyStage());
	assert.deepEqual(effects, {
		sounds: [{ kind: "play", key: "s_a", volume: 0.5, loop: false, channel: null, delay: 0 }],
		musicFade: 0,
		shake: { duration: 1, x: 0, y: 0, vibrato: 10, randomness: 90, fadeOut: false },
		clearText: true
	});
});

test("blockers, art scenes with their tween, grayscale and unknown commands fold into the stage", () => {
	const effects = emptyEffects();
	let stage = applyCommand(emptyStage(), cmd("blocker", { a: 1, r: 0, g: 0, b: 0, fadetime: 0.6 }), effects);
	assert.deepEqual(stage.blocker, { color: "rgb(0, 0, 0)", alpha: 1, fade: 0.6, from: null, wipe: null, cue: 1 });
	stage = applyCommand(stage, cmd("image", { image: "avg_1_3", x: 0, y: -20, xscale: 1.1, yscale: 1.1, fadetime: 1 }), effects);
	stage = applyCommand(stage, cmd("imagetween", { xfrom: 0, yfrom: -20, xto: 0, yto: 0, xscalefrom: 1.1, yscalefrom: 1.1, xscaleto: 1, yscaleto: 1, duration: 4 }), effects);
	assert.deepEqual(stage.image, { name: "avg_1_3", kind: "images", from: { x: 0, y: -20, xScale: 1.1, yScale: 1.1 }, to: { x: 0, y: 0, xScale: 1, yScale: 1 }, duration: 4, fade: 1, fit: "cover" });
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

test("subtitles and stickers keep their placement, a multi sticker keeps its first placement, and styled runs append", () => {
	const effects = emptyEffects();
	const subtitle = applyCommand(emptyStage(), cmd("subtitle", { text: "Hi.", x: 200, y: 360, width: 900, size: 26, alignment: "left" }), effects).subtitle;
	assert.deepEqual(subtitle, { text: "Hi.", x: 200, y: 360, width: 900, size: 26, align: "left", typing: 0 });
	assert.deepEqual(applyCommand(emptyStage(), cmd("subtitle", { text: "Hi." }), effects).subtitle, { text: "Hi.", x: 300, y: 370, width: 700, size: 24, align: "center", typing: 0 });
	let stage = applyCommand(emptyStage(), cmd("sticker", { id: "st1", multi: true, text: "Dear K,", x: 180, y: 170, width: 700, size: 24, alignment: "left" }), effects);
	stage = applyCommand(stage, cmd("sticker", { id: "st1", multi: true, text: "\n\nRed.", x: 380, spans: [{ text: "\n\n" }, { text: "Red.", color: "#ff0000" }] }), effects);
	assert.deepEqual(stage.stickers, [
		{ id: "st1", text: "Dear K,\n\nRed.", spans: [{ text: "Dear K," }, { text: "\n\n" }, { text: "Red.", color: "#ff0000" }], x: 180, y: 170, width: 700, size: 24, align: "left", typing: 0 }
	]);
});

test("a walk keeps the stage at each wait as a beat, so fades and pauses play in order before the stop", () => {
	const steps = [
		cmd("stopmusic", { fadetime: 2 }),
		cmd("blocker", { a: 1, fadetime: 2, block: true }),
		cmd("delay", { time: 1 }),
		cmd("background", { image: "bg_ship" }),
		cmd("blocker", { a: 0, fadetime: 2, block: true }),
		cmd("delay", { time: 1 }),
		cmd("playmusic", { key: "m_dark" }),
		cmd("blocker", { a: 0.6, fadetime: 2, block: true }),
		cmd("blocker", { a: 0.6, fadetime: 1, block: false }),
		cmd("camerashake", { duration: 0.5, block: false }),
		cmd("subtitle", { text: "It's time." })
	];
	const walk = advance(steps, START, emptyStage());
	const beats = walk.beats.map((beat) => [beat.stage.blocker.alpha, beat.stage.background?.name ?? null, beat.stage.music?.loop ?? null, beat.wait]);
	assert.deepEqual(beats, [
		[1, null, null, 2],
		[1, null, null, 1],
		[0, "bg_ship", null, 2],
		[0, "bg_ship", null, 1],
		[0.6, "bg_ship", "m_dark", 2],
		[0.6, "bg_ship", "m_dark", 0]
	]);
	assert.equal(walk.beats.at(-1).stage, walk.stage);
	assert.deepEqual([walk.beats[0].effects.musicFade, walk.beats[5].effects.shake?.duration, walk.effects.musicFade, walk.effects.shake?.duration], [2, 0.5, 2, 0.5]);
	assert.equal(advance([line(null, "a")], START, emptyStage()).beats.length, 1);
});

test("animtext shows a location stamp at its offset until animtextclean fades it", () => {
	const effects = emptyEffects();
	const stage = applyCommand(emptyStage(), cmd("animtext", { id: "at1", style: "avg_both", pos: "-400,-200", place: "Wreck of the Gloriana", time: "1098" }), effects);
	assert.deepEqual(stage.stamp, { place: "Wreck of the Gloriana", time: "1098", x: -400, y: -200 });
	assert.deepEqual(applyCommand(emptyStage(), cmd("animtext", { time: "3:17 P.M." }), effects).stamp, { place: null, time: "3:17 P.M.", x: -400, y: -200 });
	assert.equal(applyCommand(stage, cmd("animtextclean"), effects).stamp.leaving, true);
});

test("musicvolume sets the track's level until the next track, and soundvolume queues a volume cue for its channel", () => {
	const effects = emptyEffects();
	let stage = applyCommand(emptyStage(), cmd("playmusic", { key: "m_a", volume: 0.6 }), effects);
	stage = applyCommand(stage, cmd("musicvolume", { volume: 0.2, fadetime: 1 }), effects);
	assert.deepEqual([stage.music.volume, stage.musicVolume], [0.6, { volume: 0.2, fade: 1 }]);
	assert.equal(applyCommand(stage, cmd("playmusic", { key: "m_b" }), effects).musicVolume, null);
	assert.equal(applyCommand(stage, cmd("stopmusic"), effects).musicVolume, null);
	applyCommand(stage, cmd("soundvolume", { channel: "bgs", volume: 0.3, fadetime: 2 }), effects);
	applyCommand(stage, cmd("soundvolume", { volume: 0 }), effects);
	assert.deepEqual(effects.sounds, [
		{ kind: "volume", channel: "bgs", volume: 0.3, fade: 2 },
		{ kind: "volume", channel: null, volume: 0, fade: 0 }
	]);
});

test("characteraction moves by deltas, zooms, jumps, shakes and exits a slot's sprite, and a new character resets it", () => {
	const effects = emptyEffects();
	const act = (stage, a) => applyCommand(stage, cmd("characteraction", a), effects);
	let stage = applyCommand(emptyStage(), cmd("charslot", { slot: "m", name: "avg_a_1#1$1" }), effects);
	stage = act(stage, { name: "middle", type: "move", xpos: -100, fadetime: 0.05 });
	stage = act(stage, { name: "middle", type: "move", xpos: 200, ypos: 30, fadetime: 0.1 });
	assert.deepEqual(stage.motion.m, { x: 100, y: 30, scale: 1, duration: 0.1, from: null, pivot: { x: 0.5, y: 0.5 }, jump: null, shake: 0, shakeSwing: { power: 6, times: 5 }, cue: 0, gone: false });
	stage = act(stage, { name: "middle", type: "zoom", scale: 1.2, fadetime: 1 });
	stage = act(stage, { name: "middle", type: "jump", power: 20, times: 2, fadetime: 0.5 });
	assert.deepEqual([stage.motion.m.scale, stage.motion.m.jump, stage.motion.m.cue], [1.2, { power: 20, times: 2, duration: 0.5 }, 1]);
	stage = act(stage, { name: "middle", type: "shake", fadetime: 0.4 });
	assert.deepEqual([stage.motion.m.jump, stage.motion.m.shake, stage.motion.m.cue], [null, 0.4, 2]);
	assert.equal(applyCommand(stage, cmd("charslot", { slot: "m", name: "avg_a_1#3$1" }), effects).motion.m.x, 100);
	assert.equal(applyCommand(stage, cmd("charslot", { slot: "m", name: "avg_b_1#1$1" }), effects).motion.m, undefined);
	const gone = act(stage, { name: "middle", type: "exit", direction: "left", fadetime: 0.5 });
	assert.deepEqual([gone.motion.m.gone, gone.motion.m.x < -1000, gone.sprites.m], [true, true, "avg_a_1#1$1"]);
	assert.equal(applyCommand(gone, cmd("charslot", { slot: "m", name: "avg_a_1#2$1" }), effects).motion.m, undefined);
	assert.deepEqual(applyCommand(stage, cmd("charslot"), effects).motion, {});
	assert.deepEqual(applyCommand(stage, cmd("character", { name: "x" }), effects).motion, {});
});

test("focusout blurs its layer over its duration, and curtain draws, resizes and clears letterbox bars", () => {
	const effects = emptyEffects();
	let stage = applyCommand(emptyStage(), cmd("focusout", { type: "bg", from: 0, to: 1, duration: 1.5 }), effects);
	stage = applyCommand(stage, cmd("focusout", { type: "char", from: 0, to: 0.5, duration: 1 }), effects);
	assert.deepEqual(stage.blur, { background: { amount: 1, duration: 1.5 }, sprites: { amount: 0.5, duration: 1 } });
	assert.deepEqual(applyCommand(stage, cmd("focusout", { type: "cgitem", to: 0.3 }), effects).blur.image, { amount: 0.3, duration: 0 });
	stage = applyCommand(stage, cmd("curtain", { direction: 0, fillfrom: 0.2, fillto: 0.05, fadetime: 2, grad: true }), effects);
	stage = applyCommand(stage, cmd("curtain", { direction: 4, fillfrom: 0.2, fillto: 0.05, fadetime: 2 }), effects);
	stage = applyCommand(stage, cmd("curtain", { direction: 0, fillfrom: 0.05, fillto: 0.1, fadetime: 1 }), effects);
	assert.deepEqual(stage.curtains, {
		top: { from: 0.05, to: 0.1, fade: 1, grad: false, cue: 2 },
		bottom: { from: 0.2, to: 0.05, fade: 2, grad: false, cue: 1 }
	});
	assert.deepEqual(applyCommand(stage, cmd("curtain", { direction: 3, fillto: 0.5 }), effects).curtains, stage.curtains);
	assert.deepEqual(applyCommand(stage, cmd("curtain"), effects).curtains, {});
});

test("animtextclean fades the stamp out rather than dropping it", () => {
	const effects = emptyEffects();
	const shown = applyCommand(emptyStage(), cmd("animtext", { place: "Wreck" }), effects);
	assert.equal(applyCommand(shown, cmd("animtextclean"), effects).stamp.leaving, true);
	assert.equal(applyCommand(emptyStage(), cmd("animtextclean"), effects).stamp, null);
});

test("charslot and character fade a new character in and a removed one out over their duration", () => {
	const effects = emptyEffects();
	let stage = applyCommand(emptyStage(), cmd("charslot", { slot: "left", name: "avg_a_1#1$1", duration: 1 }), effects);
	assert.deepEqual([stage.fadeIn.l, stage.leaving], [1, {}]);
	stage = applyCommand(stage, cmd("charslot", { slot: "l", name: "avg_a_1#2$1" }), effects);
	assert.equal(stage.fadeIn.l, 1);
	const cleared = applyCommand(stage, cmd("charslot", { slot: "l", duration: 0.5 }), effects);
	assert.deepEqual([cleared.sprites, cleared.leaving.l], [{}, { name: "avg_a_1#2$1", fade: 0.5 }]);
	assert.deepEqual(applyCommand(cleared, cmd("charslot", { slot: "l", name: "avg_b_1#1$1" }), effects).leaving, {});
	assert.deepEqual(applyCommand(stage, cmd("charslot", { slot: "l" }), effects).leaving, {});
	const all = applyCommand(applyCommand(stage, cmd("charslot", { slot: "r", name: "avg_c" }), effects), cmd("charslot", { duration: 1 }), effects);
	assert.deepEqual(all.leaving, { l: { name: "avg_a_1#2$1", fade: 1 }, r: { name: "avg_c", fade: 1 } });
	const swapped = applyCommand(stage, cmd("character", { name: "avg_d", fadetime: 0.6 }), effects);
	assert.deepEqual([swapped.fadeIn.m, swapped.leaving.l], [0.6, { name: "avg_a_1#2$1", fade: 0.6 }]);
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
	assert.deepEqual([first.stop.kind, first.stop.text, first.stage.stickers.map((entry) => [entry.id, entry.text])], ["caption", "Dear K,", [["st1", "Dear K,"]]]);
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
		cmd("playsound", { key: "door", delay: 0.3 }),
		cmd("stopsound"),
		line(null, "x")
	];
	assert.deepEqual(advance(steps, START, emptyStage()).effects.sounds, [
		{ kind: "play", key: "rain", volume: 0.4, loop: true, channel: "bgs", delay: 0 },
		{ kind: "stop", channel: "bgs", fade: 1.5 },
		{ kind: "play", key: "door", volume: 1, loop: false, channel: null, delay: 0.3 },
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

test("linesAhead counts the lines and captions still to come on the path being read, the longest answer at a choice not yet made", () => {
	// Answer A runs two lines to B's one, so until the reader picks, the count takes A.
	const steps = [
		cmd("playmusic", { key: "m_l" }),
		line("Amiya", "One."),
		cmd("subtitle", { text: "Two." }),
		cmd("sticker", { id: "s", text: "Not a stop.", block: false }),
		{ t: "decision", options: ["A", "B"], values: ["1", "2"] },
		{ t: "predicate", refs: ["1"] },
		line(null, "Three, on A."),
		line(null, "Four, on A."),
		{ t: "predicate", refs: ["2"] },
		line(null, "Three, on B."),
		{ t: "predicate", refs: null },
		line(null, "Last.")
	];
	const first = advance(steps, START, emptyStage());
	// "Two.", A's two lines and "Last." lie ahead of the first line.
	assert.equal(linesAhead(steps, first.cursor), 4);
	const caption = advance(steps, first.cursor, first.stage);
	assert.equal(linesAhead(steps, caption.cursor), 3);
	const decision = advance(steps, caption.cursor, caption.stage);
	assert.equal(decision.stop.kind, "decision");
	assert.equal(linesAhead(steps, decision.cursor, decision.stop.decision), 3);
	// Picking the shorter answer drops the total by one, and nothing ahead is skipped.
	const onB = advance(steps, choose(decision.cursor, "2"), decision.stage);
	assert.equal(onB.stop.line.text, "Three, on B.");
	assert.equal(linesAhead(steps, onB.cursor), 1);
	const onA = advance(steps, choose(decision.cursor, "1"), decision.stage);
	assert.equal(linesAhead(steps, onA.cursor), 2);
	const end = advance(steps, advance(steps, onB.cursor, onB.stage).cursor, onB.stage);
	assert.equal(end.stop.kind, "end");
	assert.equal(linesAhead(steps, end.cursor), 0);
});

test("linesAhead walks each later choice once, taking its longest answer, so a long run of choices stays cheap", () => {
	const steps = [];
	for (let round = 0; round < 40; round++) {
		steps.push({ t: "decision", options: ["A", "B", "C"], values: ["1", "2", "3"] });
		steps.push({ t: "predicate", refs: ["1"] }, line(null, "a"));
		steps.push({ t: "predicate", refs: ["2"] }, line(null, "b"), line(null, "b"));
		steps.push({ t: "predicate", refs: ["3"] }, line(null, "c"));
		steps.push({ t: "predicate", refs: null });
	}
	const decision = advance(steps, START, emptyStage());
	assert.equal(linesAhead(steps, decision.cursor, decision.stop.decision), 80);
});

test("skipToStop reports the last line it passed, or null when a caption came after it", () => {
	const decision = { t: "decision", options: ["A", "B"], values: ["1", "2"] };
	const onLine = skipToStop([line("Amiya", "One."), line("Kal'tsit", "Two."), decision], START, emptyStage());
	assert.equal(onLine.result.stop.kind, "decision");
	assert.deepEqual(onLine.last, line("Kal'tsit", "Two."));
	const onCaption = skipToStop([line("Amiya", "One."), line(null, "Two."), cmd("subtitle", { text: "Three." }), decision], START, emptyStage());
	assert.equal(onCaption.last, null);
});

test("background and image fit the stage by their screenadapt: showall shows all of the art, anything else covers", () => {
	const effects = emptyEffects();
	const fit = (command, args) => applyCommand(emptyStage(), cmd(command, args), effects)[command].fit;
	assert.equal(fit("background", { image: "bg_a", screenadapt: "showall" }), "contain");
	assert.equal(fit("background", { image: "bg_a", screenadapt: "coverall" }), "cover");
	assert.equal(fit("background", { image: "bg_a" }), "cover");
	assert.equal(fit("image", { image: "cg_a", screenadapt: "showall" }), "contain");
});

test("charslot places a sprite at posto, sliding from posfrom, and fades one out to nothing even when it names the sprite", () => {
	const effects = emptyEffects();
	let stage = applyCommand(emptyStage(), cmd("charslot", { slot: "m", name: "avg_a_1#1$1", posfrom: "300,0", posto: "0,0", duration: 1 }), effects);
	assert.deepEqual([stage.motion.m.x, stage.motion.m.from, stage.motion.m.duration], [0, { x: 300, y: 0 }, 1]);
	stage = applyCommand(stage, cmd("charslot", { slot: "m", name: "avg_a_1#2$1", posfrom: "-350,0", posto: "-350,0", duration: 0 }), effects);
	assert.deepEqual([stage.motion.m.x, stage.motion.m.from], [-350, null]);
	assert.equal(stage.sprites.m, "avg_a_1#2$1");
	stage = applyCommand(stage, cmd("charslot", { slot: "m", posfrom: "0,0", posto: "0,0", focus: "m" }), effects);
	assert.deepEqual([stage.motion.m.x, stage.sprites.m], [0, "avg_a_1#2$1"]);
	const faded = applyCommand(stage, cmd("charslot", { slot: "m", name: "avg_a_1#2$1", afrom: 1, ato: 0, duration: 0.5 }), effects);
	assert.deepEqual([faded.sprites, faded.leaving.m.fade], [{}, 0.5]);
	const partial = applyCommand(stage, cmd("charslot", { slot: "m", name: "avg_a_1#2$1", afrom: 1, ato: 0.7, duration: 0.5 }), effects);
	assert.equal(partial.sprites.m, "avg_a_1#2$1");
});

test("camerashake keeps its strengths, jolts and fade, and shakeFrames makes a repeatable shake that comes to rest", () => {
	const effects = emptyEffects();
	applyCommand(emptyStage(), cmd("camerashake", { duration: 0.3, xstrength: 10, ystrength: 12, vibrato: 30, randomness: 90, fadeout: true }), effects);
	assert.deepEqual(effects.shake, { duration: 0.3, x: 10, y: 12, vibrato: 30, randomness: 90, fadeOut: true });
	const frames = shakeFrames(effects.shake, 3);
	assert.equal(frames.length, 10);
	assert.deepEqual([frames[0].transform, frames.at(-1).transform], ["translate(0, 0)", "translate(0, 0)"]);
	assert.deepEqual(shakeFrames(effects.shake, 3), frames);
	assert.notDeepEqual(shakeFrames(effects.shake, 4), frames);
});

test("a subtitle or sticker's delay is how long each of its characters takes to appear", () => {
	const effects = emptyEffects();
	assert.equal(applyCommand(emptyStage(), cmd("subtitle", { text: "Hi.", delay: 0.04 }), effects).subtitle.typing, 0.04);
	assert.equal(applyCommand(emptyStage(), cmd("sticker", { id: "s", text: "Hi.", delay: 0 }), effects).stickers[0].typing, 0);
});

test("a caption stop says how long its text takes to type, and 0 when it shows at once", () => {
	const typed = advance([cmd("sticker", { id: "s", text: "Hello", delay: 0.04 })], START, emptyStage());
	assert.ok(Math.abs(typed.stop.typeTime - 0.2) < 1e-9);
	assert.equal(advance([cmd("sticker", { id: "s", text: "Hello", delay: 0.001 })], START, emptyStage()).stop.typeTime, 0);
	assert.equal(advance([cmd("subtitle", { text: "Hello" })], START, emptyStage()).stop.typeTime, 0);
});

test("bstart and bend give a sprite its own out-of-focus and in-focus brightness, and a new character or an empty slot loses them", () => {
	const effects = emptyEffects();
	let stage = applyCommand(emptyStage(), cmd("charslot", { slot: "l", name: "avg_a_1#1$1", bstart: 0.2, bend: 0.7, focus: "l" }), effects);
	assert.deepEqual(stage.light, { l: { dim: 0.2, lit: 0.7 } });
	stage = applyCommand(stage, cmd("charslot", { slot: "l", name: "avg_a_1#2$1", focus: "l" }), effects);
	assert.deepEqual(stage.light.l, { dim: 0.2, lit: 0.7 });
	assert.deepEqual(applyCommand(stage, cmd("charslot", { slot: "l", name: "avg_b_1#1$1" }), effects).light, {});
	assert.deepEqual(applyCommand(stage, cmd("charslot", { slot: "l" }), effects).light, {});
	const pair = applyCommand(emptyStage(), cmd("character", { name: "avg_a", name2: "avg_b", blackstart: 0.2, blackend: 0.7, blackstart2: 0.3, blackend2: 0.9 }), effects);
	assert.deepEqual(pair.light, { l: { dim: 0.2, lit: 0.7 }, r: { dim: 0.3, lit: 0.9 } });
});

test("a charslot action zooms about its pivot, jumps to posto, and shakes by its power and times", () => {
	const effects = emptyEffects();
	let stage = applyCommand(emptyStage(), cmd("charslot", { slot: "m", name: "avg_a_1#1$1" }), effects);
	stage = applyCommand(stage, cmd("charslot", { slot: "m", action: "zoom", poszoom: "0.5,0.65", scale: 1.4, duration: 0.5 }), effects);
	assert.deepEqual([stage.motion.m.scale, stage.motion.m.pivot, stage.motion.m.duration], [1.4, { x: 0.5, y: 0.65 }, 0.5]);
	stage = applyCommand(stage, cmd("charslot", { slot: "m", action: "jump", posfrom: "0,0", posto: "-80,0", power: 5, times: 2, duration: 0.4 }), effects);
	assert.deepEqual([stage.motion.m.x, stage.motion.m.from, stage.motion.m.jump], [-80, { x: 0, y: 0 }, { power: 5, times: 2, duration: 0.4 }]);
	stage = applyCommand(stage, cmd("charslot", { slot: "m", action: "shake", power: 8, times: 100, duration: 0.5 }), effects);
	assert.deepEqual([stage.motion.m.jump, stage.motion.m.shake, stage.motion.m.shakeSwing], [null, 0.5, { power: 8, times: 100 }]);
	assert.equal(applyCommand(emptyStage(), cmd("charslot", { slot: "m", action: "shake", power: 8 }), effects).motion.m, undefined);
});

test("a blocker keeps the colour and opacity it starts from, and the slider style wipes in the direction the script sweeps", () => {
	const effects = emptyEffects();
	let stage = applyCommand(emptyStage(), cmd("blocker", { a: 1, r: 1, g: 1, b: 1, afrom: 0, rfrom: 0.8, gfrom: 0.8, bfrom: 0.8, fadetime: 0.3 }), effects);
	assert.deepEqual([stage.blocker.color, stage.blocker.from, stage.blocker.wipe], ["rgb(255, 255, 255)", { color: "rgb(204, 204, 204)", alpha: 0 }, null]);
	stage = applyCommand(stage, cmd("blocker", { a: 1, r: 0, g: 0, b: 0, style: "slider", inverse: true, fadetime: 2 }), effects);
	assert.deepEqual([stage.blocker.wipe, stage.blocker.from, stage.blocker.cue], ["backward", null, 2]);
	assert.equal(applyCommand(stage, cmd("blocker", { a: 0, r: 0, g: 0, b: 0, style: "slider", inverse: false, fadetime: 1 }), effects).blocker.wipe, "forward");
});
