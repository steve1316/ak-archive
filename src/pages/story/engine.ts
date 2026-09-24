// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Story engine

/**
 * The story player's state machine. It walks a story's flat steps from one stop to the next and folds every command in between into the stage.
 *
 * A stop is a line, a caption (a subtitle or sticker the reader clicks past), a choice, or the end. Everything else - backgrounds, art scenes,
 * sprites, fades, music, sounds, shakes, pauses - is applied on the way and never waits for the reader. Choices follow the game's rule: `Predicate`
 * shows what follows only when the last picked value is in its refs, up to the next `Predicate`, and a bare `Predicate` (null refs) rejoins every branch.
 *
 * This module is pure and imports only types, so `tools/data/test/story-engine.test.mjs` runs it under Node's type stripping.
 */

import type { CommandStep, DecisionStep, LineStep, Span, Step } from "../../types/story.js";

/** A sprite position on stage: left, middle or right. */
export type Slot = "l" | "m" | "r";

/** Where a layer sits: an offset in the game's 1920x1080 units, and a scale. */
export interface Placement {
	/** Horizontal offset, positive to the right. */
	x: number;
	/** Vertical offset, positive upwards. */
	y: number;
	/** Horizontal scale. */
	xScale: number;
	/** Vertical scale. */
	yScale: number;
}

/** A background or art scene on stage. */
export interface LayerState {
	/** The asset reference. */
	name: string;
	/** Which asset folder its art is published under, matching `ASSET_ARGS` in `tools/story/keys.mjs`. */
	kind: "backgrounds" | "images";
	/** Where it starts. */
	from: Placement;
	/** Where a tween moves it, or null when it stays put. */
	to: Placement | null;
	/** How long the tween takes, in seconds. */
	duration: number;
	/** How long it fades in, in seconds. */
	fade: number;
}

/** Everything the stage shows between stops. */
export interface StageState {
	/** The background, or null for black. */
	background: LayerState | null;
	/** The art scene over it, or null. */
	image: LayerState | null;
	/** The sprite in each occupied slot, by upstream sprite name. */
	sprites: Partial<Record<Slot, string>>;
	/** The lit slot, or `all` when nobody is dimmed. */
	focus: Slot | "all";
	/** The full-screen fade. */
	blocker: { color: string; alpha: number; fade: number };
	/** The playing track, or null for silence. */
	music: { intro: string | null; loop: string; volume: number; crossfade: number } | null;
	/** Centred narration, or null. */
	subtitle: { text: string; spans?: Span[] } | null;
	/** Letter-style text shown over the scene, in the order it appeared, keyed by the script's sticker id. */
	stickers: { id: string; text: string }[];
	/** Whether the scene is drawn in grey. */
	grayscale: boolean;
}

/** One sound cue: play a sound, or stop the sounds on one channel, or on every channel when `channel` is null. */
export type SoundCue = { kind: "play"; key: string; volume: number; loop: boolean; channel: string | null } | { kind: "stop"; channel: string | null; fade: number };

/** One-off effects met on the way to a stop. */
export interface Effects {
	/** Sound cues, in script order. */
	sounds: SoundCue[];
	/** How long the music fades out over when a `stopmusic` was met, in seconds. */
	musicFade: number;
	/** How long the stage shakes, in seconds, or 0. */
	shake: number;
	/** Pauses met, in seconds, which AUTO waits out. */
	delay: number;
	/** Whether the text box was cleared. */
	clearText: boolean;
}

/** Where the walk stands in a story. */
export interface Cursor {
	/** The next step to read. */
	index: number;
	/** The last picked choice value, or null before any choice. */
	pick: string | null;
	/** Whether a predicate is hiding the steps being read. */
	hidden: boolean;
}

/** Where a walk stopped. */
export type Stop = { kind: "line"; line: LineStep } | { kind: "caption"; text: string } | { kind: "decision"; decision: DecisionStep } | { kind: "end" };

/** The result of one walk. */
export interface Advance {
	/** Where to continue from. */
	cursor: Cursor;
	/** The stage at the stop. */
	stage: StageState;
	/** Why the walk stopped. */
	stop: Stop;
	/** Effects met on the way. */
	effects: Effects;
}

/** Where a story's stops fall among its lines, from `lineOrder`. */
export interface LineOrder {
	/** Every line and caption in the script, both sides of each branch included. */
	total: number;
	/** How many lines and captions sit before each step index: entry `i` counts steps 0 to i - 1. It runs one past the last step. */
	before: number[];
}

/** A layer that has not moved. */
const PLACEMENT: Placement = { x: 0, y: 0, xScale: 1, yScale: 1 };

/** Which slots `character` fills for one, two and three names. */
const CHARACTER_SLOTS: Record<number, Slot[]> = { 1: ["m"], 2: ["l", "r"], 3: ["l", "m", "r"] };

/** The start of a story. */
export const START: Cursor = { index: 0, pick: null, hidden: false };

/** The tag the scripts write where the reader's name goes. */
const NICKNAME_TAG = "{@nickname}";

/** The title the scripts put before the name, which a reader named Doctor drops so no line reads "Dr. Doctor". */
const TITLED_NICKNAME = /Dr\. ?\{@nickname\}/g;

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * An empty stage: black, silent, nobody on it.
 *
 * @returns The stage.
 */
export function emptyStage(): StageState {
	return { background: null, image: null, sprites: {}, focus: "all", blocker: { color: "rgb(0, 0, 0)", alpha: 0, fade: 0 }, music: null, subtitle: null, stickers: [], grayscale: false };
}

/**
 * No effects yet.
 *
 * @returns The effects.
 */
export function emptyEffects(): Effects {
	return { sounds: [], musicFade: 0, shake: 0, delay: 0, clearText: false };
}

/**
 * Put the reader's name where the script writes `{@nickname}`, in a plain string or in a line's text and every styled run. A reader named Doctor
 * loses the script's "Dr." in front of it.
 *
 * @param value The string or line.
 * @param nickname The reader's name.
 * @returns The same shape with the name filled in.
 */
export function fillNickname(value: string, nickname: string): string;
export function fillNickname<T extends { text: string; spans?: Span[] }>(value: T, nickname: string): T;
export function fillNickname(value: string | { text: string; spans?: Span[] }, nickname: string): string | { text: string; spans?: Span[] } {
	if (typeof value === "string") {
		return (nickname === "Doctor" ? value.replace(TITLED_NICKNAME, nickname) : value).replaceAll(NICKNAME_TAG, nickname);
	}
	return { ...value, text: fillNickname(value.text, nickname), ...(value.spans ? { spans: value.spans.map((span) => ({ ...span, text: fillNickname(span.text, nickname) })) } : {}) };
}

/**
 * A numeric argument.
 *
 * @param value The raw argument.
 * @param fallback The value when it is missing or not a number.
 * @returns The number.
 */
function num(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * A non-empty string argument.
 *
 * @param value The raw argument.
 * @returns The string, or null.
 */
function text(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

/**
 * A sound channel argument. Scripts name channels with words or numbers, so a number becomes its string.
 *
 * @param value The raw argument.
 * @returns The channel, or null when none is named.
 */
function channelOf(value: unknown): string | null {
	return typeof value === "number" ? String(value) : text(value);
}

/**
 * A slot argument.
 *
 * @param value The raw argument.
 * @returns The slot, or null when it is not one.
 */
function slotOf(value: unknown): Slot | null {
	return value === "l" || value === "m" || value === "r" ? value : null;
}

/**
 * A blocker's colour. The data writes channels as 0-1, and a few scripts write 0-255.
 *
 * @param a The blocker's arguments.
 * @returns A CSS colour.
 */
function colourOf(a: Record<string, unknown>): string {
	const channels = [num(a.r, 0), num(a.g, 0), num(a.b, 0)];
	const scale = channels.some((channel) => channel > 1) ? 1 : 255;
	return `rgb(${channels.map((channel) => Math.round(channel * scale)).join(", ")})`;
}

/**
 * A layer from `background` or `image` arguments.
 *
 * @param a The command's arguments.
 * @param kind Which asset folder its art is published under.
 * @returns The layer, or null when no image is named.
 */
function layerOf(a: Record<string, unknown>, kind: LayerState["kind"]): LayerState | null {
	const name = text(a.image);
	return name ? { name, kind, from: { x: num(a.x, 0), y: num(a.y, 0), xScale: num(a.xscale, 1), yScale: num(a.yscale, 1) }, to: null, duration: 0, fade: num(a.fadetime, 0) } : null;
}

/**
 * A layer with a tween applied.
 *
 * @param layer The layer on stage.
 * @param a The tween's arguments.
 * @returns The tweened layer, or null when nothing is on stage.
 */
function tweenOf(layer: LayerState | null, a: Record<string, unknown>): LayerState | null {
	if (!layer) {
		return null;
	}
	const from = { x: num(a.xfrom, layer.from.x), y: num(a.yfrom, layer.from.y), xScale: num(a.xscalefrom, layer.from.xScale), yScale: num(a.yscalefrom, layer.from.yScale) };
	return { ...layer, from, to: { x: num(a.xto, from.x), y: num(a.yto, from.y), xScale: num(a.xscaleto, from.xScale), yScale: num(a.yscaleto, from.yScale) }, duration: num(a.duration, 0) };
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Walking

/**
 * Apply one stage direction.
 *
 * @param stage The stage before it.
 * @param step The command.
 * @param effects One-off effects, collected in place.
 * @returns The stage after it. Unchanged for a command the player does not draw.
 */
export function applyCommand(stage: StageState, step: CommandStep, effects: Effects): StageState {
	const a = step.a;
	switch (step.c) {
		case "background":
			return { ...stage, background: layerOf(a, "backgrounds") };
		case "largebg":
		case "gridbg":
		case "verticalbg": {
			const first = text(a.imagegroup)?.split("/")[0] ?? null;
			return { ...stage, background: first ? { name: first, kind: "images", from: PLACEMENT, to: null, duration: 0, fade: num(a.fadetime, 0) } : null };
		}
		case "backgroundtween":
			return { ...stage, background: tweenOf(stage.background, a) };
		case "image":
		case "cgitem":
			return { ...stage, image: layerOf(a, "images") };
		case "hidecgitem":
			return { ...stage, image: null };
		case "imagetween":
			return { ...stage, image: tweenOf(stage.image, a) };
		case "character": {
			const names = [a.name, a.name2, a.name3].map(text).filter((name): name is string => name !== null);
			const slots = CHARACTER_SLOTS[names.length] ?? [];
			const sprites: Partial<Record<Slot, string>> = {};
			names.forEach((name, index) => {
				const slot = slots[index];
				if (slot) {
					sprites[slot] = name;
				}
			});
			const focusIndex = num(a.focus, 0);
			const focus = names.length > 1 && focusIndex >= 1 && focusIndex <= names.length ? (slots[focusIndex - 1] ?? "all") : "all";
			return { ...stage, sprites, focus };
		}
		case "charslot": {
			const slot = slotOf(a.slot);
			const name = text(a.name);
			let sprites = stage.sprites;
			if (!slot && !name) {
				sprites = {};
			} else if (slot && name) {
				sprites = { ...sprites, [slot]: name };
			} else if (slot) {
				sprites = { ...sprites };
				delete sprites[slot];
			}
			const focus = "focus" in a ? (slotOf(a.focus) ?? "all") : stage.focus;
			return { ...stage, sprites, focus };
		}
		case "blocker":
			return { ...stage, blocker: { color: colourOf(a), alpha: num(a.a, 0), fade: num(a.fadetime, 0) } };
		case "dialog":
			effects.clearText = true;
			return stage;
		case "playmusic": {
			const loop = text(a.key);
			return loop ? { ...stage, music: { intro: text(a.intro), loop, volume: num(a.volume, 1), crossfade: num(a.crossfade, 0) } } : stage;
		}
		case "stopmusic":
			effects.musicFade = num(a.fadetime, 0);
			return { ...stage, music: null };
		case "playsound": {
			const key = text(a.key);
			if (key) {
				effects.sounds.push({ kind: "play", key, volume: num(a.volume, 1), loop: a.loop === true, channel: channelOf(a.channel) });
			}
			return stage;
		}
		case "stopsound":
			effects.sounds.push({ kind: "stop", channel: channelOf(a.channel), fade: num(a.fadetime, 0) });
			return stage;
		case "subtitle": {
			const line = text(a.text);
			return { ...stage, subtitle: line ? { text: line, ...(Array.isArray(a.spans) ? { spans: a.spans as Span[] } : {}) } : null };
		}
		case "sticker": {
			const id = text(a.id) ?? "";
			const line = text(a.text);
			if (line === null) {
				return { ...stage, stickers: stage.stickers.filter((entry) => entry.id !== id) };
			}
			if (!stage.stickers.some((entry) => entry.id === id)) {
				return { ...stage, stickers: [...stage.stickers, { id, text: line }] };
			}
			return { ...stage, stickers: stage.stickers.map((entry) => (entry.id === id ? { id, text: a.multi === true ? entry.text + line : line } : entry)) };
		}
		case "stickerclear":
			return { ...stage, stickers: [] };
		case "camerashake":
			effects.shake = Math.max(effects.shake, num(a.duration, 0.5));
			return stage;
		case "delay":
			effects.delay += num(a.time, 0);
			return stage;
		case "cameraeffect":
			return text(a.effect)?.toLowerCase() === "grayscale" ? { ...stage, grayscale: num(a.amount, 0) > 0 } : stage;
		default:
			return stage;
	}
}

/**
 * The text a command shows that the reader clicks past, as the game waits on it: a subtitle with text, or a sticker with text that does not
 * set `block=false`.
 *
 * @param step The command.
 * @returns The new text, or null when the command is not a stop.
 */
function captionOf(step: CommandStep): string | null {
	const shown = step.c === "subtitle" || (step.c === "sticker" && step.a.block !== false) ? text(step.a.text) : null;
	return shown === null ? null : shown.trim() || null;
}

/**
 * Walk from the cursor to the next line, caption, choice or the end.
 *
 * @param steps The story's steps.
 * @param cursor Where to start.
 * @param stage The stage at the start.
 * @returns Where it stopped, the stage there and the effects met.
 */
export function advance(steps: Step[], cursor: Cursor, stage: StageState): Advance {
	let { index, hidden } = cursor;
	const { pick } = cursor;
	let next = stage;
	const effects = emptyEffects();
	while (index < steps.length) {
		const step = steps[index];
		index++;
		if (!step) {
			break;
		}
		if (step.t === "predicate") {
			hidden = pick !== null && step.refs !== null && !step.refs.includes(pick);
			continue;
		}
		if (hidden) {
			continue;
		}
		if (step.t === "line") {
			return { cursor: { index, pick, hidden }, stage: next, stop: { kind: "line", line: step }, effects };
		}
		if (step.t === "decision") {
			return { cursor: { index, pick, hidden }, stage: next, stop: { kind: "decision", decision: step }, effects };
		}
		next = applyCommand(next, step, effects);
		const caption = captionOf(step);
		if (caption !== null) {
			return { cursor: { index, pick, hidden }, stage: next, stop: { kind: "caption", text: caption }, effects };
		}
	}
	return { cursor: { index, pick, hidden }, stage: next, stop: { kind: "end" }, effects };
}

/**
 * The art the next few stops will show, for preloading. It walks ahead with the same rules as the player and stops looking at a choice, since the
 * reader's pick decides what follows.
 *
 * @param steps The story's steps.
 * @param cursor Where the player stands.
 * @param stage The stage there.
 * @param stops How many stops to look ahead.
 * @returns Each image once, in the order it first appears.
 */
export function upcomingArt(steps: Step[], cursor: Cursor, stage: StageState, stops: number): { kind: "backgrounds" | "images" | "sprites"; name: string }[] {
	const found = new Map<string, { kind: "backgrounds" | "images" | "sprites"; name: string }>();
	const add = (kind: "backgrounds" | "images" | "sprites", name: string) => {
		if (!found.has(`${kind}/${name}`)) {
			found.set(`${kind}/${name}`, { kind, name });
		}
	};
	let at: { cursor: Cursor; stage: StageState } = { cursor, stage };
	for (let count = 0; count < stops; count++) {
		const next = advance(steps, at.cursor, at.stage);
		for (const layer of [next.stage.background, next.stage.image]) {
			if (layer && !(layer === stage.background || layer === stage.image)) {
				add(layer.kind, layer.name);
			}
		}
		for (const name of Object.values(next.stage.sprites)) {
			if (name && !Object.values(stage.sprites).includes(name)) {
				add("sprites", name);
			}
		}
		if (next.stop.kind !== "line" && next.stop.kind !== "caption") {
			break;
		}
		at = next;
	}
	return [...found.values()];
}

/**
 * Record the reader's choice.
 *
 * @param cursor The cursor at the choice.
 * @param value The picked option's value.
 * @returns The cursor to continue from.
 */
export function choose(cursor: Cursor, value: string): Cursor {
	return { ...cursor, pick: value, hidden: false };
}

/**
 * Skip to the next choice or the end.
 *
 * @param steps The story's steps.
 * @param cursor Where to start.
 * @param stage The stage at the start.
 * @returns Where it stopped, and every line and caption passed on the way, for the Log. A caption has no speaker.
 */
export function skipToStop(steps: Step[], cursor: Cursor, stage: StageState): { result: Advance; lines: { name: string | null; text: string }[] } {
	const lines: { name: string | null; text: string }[] = [];
	let result = advance(steps, cursor, stage);
	while (result.stop.kind === "line" || result.stop.kind === "caption") {
		lines.push(result.stop.kind === "line" ? { name: result.stop.line.name, text: result.stop.line.text } : { name: null, text: result.stop.text });
		result = advance(steps, result.cursor, result.stage);
	}
	return { result, lines };
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Counting

/**
 * Count a story's lines in script order: its line steps and the captions the reader clicks past, both sides of every branch included. So the
 * total is fixed from the start, and the count jumps forward past a branch not taken.
 *
 * @param steps The story's steps.
 * @returns The total and the running count before each step.
 */
export function lineOrder(steps: Step[]): LineOrder {
	const before = [0];
	let seen = 0;
	for (const step of steps) {
		if (step.t === "line" || (step.t !== "decision" && step.t !== "predicate" && captionOf(step) !== null)) {
			seen++;
		}
		before.push(seen);
	}
	return { total: seen, before };
}

/**
 * The line a stop is on, by `lineOrder`'s count. A line or caption is its own place in the count, a choice takes the count so far, and the end is the total.
 *
 * @param order The story's count.
 * @param cursor The cursor after the stop, as `advance` returns it.
 * @returns The line number, from 1.
 */
export function lineNumber(order: LineOrder, cursor: Cursor): number {
	return order.before[cursor.index] ?? order.total;
}
