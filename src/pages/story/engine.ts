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

/** How a sprite has moved from its slot, from `characteraction`. Offsets are in the game's 1280x720 text space. */
export interface Motion {
	/** Horizontal offset, positive to the right. */
	x: number;
	/** Vertical offset, positive upwards. */
	y: number;
	/** The sprite's scale. */
	scale: number;
	/** How long the last move or zoom takes, in seconds. */
	duration: number;
	/** The jump to play: how high in text-space units, how many times, and over how long, or null. */
	jump: { power: number; times: number; duration: number } | null;
	/** How long the shake to play lasts, in seconds, or 0. */
	shake: number;
	/** Counts jumps and shakes, so the stage restarts the animation for each new one. */
	cue: number;
	/** Whether the sprite has exited off the stage. It stays in its slot, out of sight, until the slot is filled or cleared. */
	gone: boolean;
}

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

/** Text the script places over the scene: a subtitle or a sticker. Positions are in the game's 1280x720 text space, from the top-left. */
export interface Caption {
	/** The plain text. `{@nickname}` stands for the reader's name. */
	text: string;
	/** Styled runs of `text`, present only when some of it is styled. */
	spans?: Span[];
	/** The text box's left edge. */
	x: number;
	/** The text box's top edge. */
	y: number;
	/** The text box's width. */
	width: number;
	/** The font size. */
	size: number;
	/** How the text aligns inside its box. */
	align: "left" | "center" | "right";
}

/** A sticker: a caption the script names by id, so later stickers can add to it or remove it. */
export interface Sticker extends Caption {
	/** The script's sticker id. */
	id: string;
}

/** A location stamp from `animtext`: where and when a scene is set. */
export interface Stamp {
	/** The place, or null when the stamp shows only a time. */
	place: string | null;
	/** The time, or null when the stamp shows only a place. */
	time: string | null;
	/** The stamp's left edge, as an offset from the stage's centre in the game's 1280x720 text space. */
	x: number;
	/** The stamp's middle, as an offset from the stage's centre, positive upwards. */
	y: number;
}

/** Everything the stage shows between stops. */
export interface StageState {
	/** The background, or null for black. */
	background: LayerState | null;
	/** The art scene over it, or null. */
	image: LayerState | null;
	/** The sprite in each occupied slot, by upstream sprite name. */
	sprites: Partial<Record<Slot, string>>;
	/** How each slot's sprite has moved, for slots whose sprite has. */
	motion: Partial<Record<Slot, Motion>>;
	/** The lit slot, or `all` when nobody is dimmed. */
	focus: Slot | "all";
	/** The full-screen fade. */
	blocker: { color: string; alpha: number; fade: number };
	/** The playing track, or null for silence. */
	music: { intro: string | null; loop: string; volume: number; crossfade: number } | null;
	/** The track's level as `musicvolume` last set it, and how long it fades there, or null for the track's own volume. */
	musicVolume: { volume: number; fade: number } | null;
	/** Narration over the scene, or null. */
	subtitle: Caption | null;
	/** Letter-style text shown over the scene, in the order it appeared. */
	stickers: Sticker[];
	/** The location stamp, or null. */
	stamp: Stamp | null;
	/** Whether the scene is drawn in grey. */
	grayscale: boolean;
}

/** One sound cue: play a sound, or stop or set the volume of the sounds on one channel, or on every channel when `channel` is null. */
export type SoundCue =
	| { kind: "play"; key: string; volume: number; loop: boolean; channel: string | null }
	| { kind: "stop"; channel: string | null; fade: number }
	| { kind: "volume"; channel: string | null; volume: number; fade: number };

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

/** The stage at one wait on the way to a stop: what shows, the effects met since the last wait, and how long the game holds it. */
export interface Beat {
	/** The stage as the wait begins. */
	stage: StageState;
	/** Effects met since the previous beat. */
	effects: Effects;
	/** How long the stage holds before the next beat, in seconds. */
	wait: number;
}

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
	/** The walk in order, one beat per wait. The last beat is the stop itself, with `stage` and no wait, so there is always at least one. */
	beats: Beat[];
}

/** One stretch of a path, from `walkLines`: the lines and captions on it, and the choice it stops at. */
interface LineWalk {
	/** How many lines and captions the stretch holds. */
	lines: number;
	/** Where the stretch stopped: past the choice it met, or at the end. */
	cursor: Cursor;
	/** The choice it stopped at, or null at the end. */
	decision: DecisionStep | null;
}

/** A layer that has not moved. */
const PLACEMENT: Placement = { x: 0, y: 0, xScale: 1, yScale: 1 };

/** Which slots `character` fills for one, two and three names. */
const CHARACTER_SLOTS: Record<number, Slot[]> = { 1: ["m"], 2: ["l", "r"], 3: ["l", "m", "r"] };

/** Where a caption sits when the script leaves a field out: the subtitles' usual box. */
const CAPTION_DEFAULTS = { x: 300, y: 370, width: 700, size: 24 };

/** Where a location stamp sits when the script leaves out `pos`: every stamp in the data but two. */
const STAMP_POS = { x: -400, y: -200 };

/** A sprite that has not moved. */
const STILL: Motion = { x: 0, y: 0, scale: 1, duration: 0, jump: null, shake: 0, cue: 0, gone: false };

/** How far an exiting sprite slides, in text-space units: far enough to leave the stage from any slot. */
const EXIT_DISTANCE = 1600;

/** Every way the scripts name a slot, lowercased. */
const SLOT_NAMES: Record<string, Slot> = { l: "l", left: "l", lfte: "l", m: "m", middle: "m", r: "r", right: "r" };

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
	return {
		background: null,
		image: null,
		sprites: {},
		motion: {},
		focus: "all",
		blocker: { color: "rgb(0, 0, 0)", alpha: 0, fade: 0 },
		music: null,
		musicVolume: null,
		subtitle: null,
		stickers: [],
		stamp: null,
		grayscale: false
	};
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
 * Several walks' effects as one, as if met in a single walk.
 *
 * @param list The effects, in order.
 * @returns The merged effects.
 */
export function mergeEffects(list: Effects[]): Effects {
	const merged = emptyEffects();
	for (const effects of list) {
		merged.sounds.push(...effects.sounds);
		merged.musicFade = effects.musicFade || merged.musicFade;
		merged.shake = Math.max(merged.shake, effects.shake);
		merged.delay += effects.delay;
		merged.clearText ||= effects.clearText;
	}
	return merged;
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
 * A slot argument. Scripts write slots as `l`, `left`, `L` or `Left`, and a few misspell `left` as `lfte`.
 *
 * @param value The raw argument.
 * @returns The slot, or null when it is not one.
 */
function slotOf(value: unknown): Slot | null {
	return typeof value === "string" ? (SLOT_NAMES[value.toLowerCase()] ?? null) : null;
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

/**
 * A caption from `subtitle` or `sticker` arguments.
 *
 * @param a The command's arguments.
 * @param line The command's text.
 * @returns The caption.
 */
function captionFrom(a: Record<string, unknown>, line: string): Caption {
	const align = a.alignment === "left" || a.alignment === "right" ? a.alignment : "center";
	return {
		text: line,
		...(Array.isArray(a.spans) ? { spans: a.spans as Span[] } : {}),
		x: num(a.x, CAPTION_DEFAULTS.x),
		y: num(a.y, CAPTION_DEFAULTS.y),
		width: num(a.width, CAPTION_DEFAULTS.width),
		size: num(a.size, CAPTION_DEFAULTS.size),
		align
	};
}

/**
 * A sticker with more text added after it, as `multi` writes. It keeps its first placement, and its styled runs when either part has some.
 *
 * @param sticker The sticker on stage.
 * @param added The caption being added.
 * @returns The longer sticker.
 */
function appendSticker(sticker: Sticker, added: Caption): Sticker {
	const spans = sticker.spans || added.spans ? [...(sticker.spans ?? [{ text: sticker.text }]), ...(added.spans ?? [{ text: added.text }])] : undefined;
	return { ...sticker, text: sticker.text + added.text, ...(spans ? { spans } : {}) };
}

/**
 * The character a sprite name shows, without its expression, such as `avg_npc_423_1` for `avg_npc_423_1#1$1`.
 *
 * @param name The sprite name.
 * @returns The character.
 */
function characterOf(name: string): string {
	return (name.split("#")[0] ?? name).toLowerCase();
}

/**
 * A sprite's motion after one `characteraction`.
 *
 * @param motion The sprite's motion before it.
 * @param slot The sprite's slot.
 * @param a The command's arguments.
 * @returns The new motion.
 */
function actionOf(motion: Motion, slot: Slot, a: Record<string, unknown>): Motion {
	const duration = num(a.fadetime, num(a.duration, 0));
	const moved = { ...motion, x: motion.x + num(a.xpos, 0), y: motion.y + num(a.ypos, 0), duration, jump: null, shake: 0 };
	switch (text(a.type)?.toLowerCase()) {
		case "move":
			return moved;
		case "zoom":
			return { ...motion, scale: num(a.scale, motion.scale), duration, jump: null, shake: 0 };
		case "jump":
			return { ...moved, jump: { power: num(a.power, 20), times: Math.max(1, num(a.times, 1)), duration: duration || 0.3 }, cue: motion.cue + 1 };
		case "shake":
			return { ...motion, jump: null, shake: duration || 0.5, cue: motion.cue + 1 };
		case "exit": {
			const direction = text(a.direction) ?? (slot === "r" ? "right" : "left");
			return { ...motion, x: motion.x + (direction === "right" ? EXIT_DISTANCE : -EXIT_DISTANCE), duration, jump: null, shake: 0, gone: true };
		}
		default:
			return motion;
	}
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
			return { ...stage, sprites, motion: {}, focus };
		}
		case "charslot": {
			const slot = slotOf(a.slot);
			const name = text(a.name);
			let sprites = stage.sprites;
			let motion = stage.motion;
			if (!slot && !name) {
				sprites = {};
				motion = {};
			} else if (slot) {
				const before = sprites[slot];
				sprites = { ...sprites };
				// A new expression keeps the sprite where it moved to. A new character, or an empty slot, starts still.
				if (name) {
					sprites[slot] = name;
				} else {
					delete sprites[slot];
				}
				if (motion[slot] && !(name && before && characterOf(name) === characterOf(before))) {
					motion = { ...motion };
					delete motion[slot];
				}
			}
			const focus = "focus" in a ? (slotOf(a.focus) ?? "all") : stage.focus;
			return { ...stage, sprites, motion, focus };
		}
		case "characteraction": {
			const slot = slotOf(a.name);
			return slot ? { ...stage, motion: { ...stage.motion, [slot]: actionOf(stage.motion[slot] ?? STILL, slot, a) } } : stage;
		}
		case "blocker":
			return { ...stage, blocker: { color: colourOf(a), alpha: num(a.a, 0), fade: num(a.fadetime, 0) } };
		case "dialog":
			effects.clearText = true;
			return stage;
		case "playmusic": {
			const loop = text(a.key);
			return loop ? { ...stage, music: { intro: text(a.intro), loop, volume: num(a.volume, 1), crossfade: num(a.crossfade, 0) }, musicVolume: null } : stage;
		}
		case "stopmusic":
			effects.musicFade = num(a.fadetime, 0);
			return { ...stage, music: null, musicVolume: null };
		case "musicvolume":
			return { ...stage, musicVolume: { volume: num(a.volume, 1), fade: num(a.fadetime, 0) } };
		case "soundvolume":
			effects.sounds.push({ kind: "volume", channel: channelOf(a.channel), volume: num(a.volume, 1), fade: num(a.fadetime, 0) });
			return stage;
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
			return { ...stage, subtitle: line ? captionFrom(a, line) : null };
		}
		case "sticker": {
			const id = text(a.id) ?? "";
			const line = text(a.text);
			if (line === null) {
				return { ...stage, stickers: stage.stickers.filter((entry) => entry.id !== id) };
			}
			const caption = captionFrom(a, line);
			if (!stage.stickers.some((entry) => entry.id === id)) {
				return { ...stage, stickers: [...stage.stickers, { id, ...caption }] };
			}
			return { ...stage, stickers: stage.stickers.map((entry) => (entry.id !== id ? entry : a.multi === true ? appendSticker(entry, caption) : { id, ...caption })) };
		}
		case "stickerclear":
			return { ...stage, stickers: [] };
		case "animtext": {
			const [x, y] =
				text(a.pos)
					?.split(",")
					.map((part) => (part.trim() ? Number(part) : NaN)) ?? [];
			const place = text(a.place);
			const time = text(a.time);
			const pos = { x: num(x, STAMP_POS.x), y: num(y, STAMP_POS.y) };
			return { ...stage, stamp: place || time ? { place, time, ...pos } : null };
		}
		case "animtextclean":
			return { ...stage, stamp: null };
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
 * How long the game holds the stage after a command: a pause's time, or the fade or move of a command that blocks until it ends. A blocker
 * blocks unless it sets `block=false`. Anything else blocks only when it sets `block` or `isblock`.
 *
 * @param step The command.
 * @returns The wait, in seconds.
 */
function waitOf(step: CommandStep): number {
	const a = step.a;
	if (step.c === "delay") {
		return Math.max(0, num(a.time, 0));
	}
	const blocks = step.c === "blocker" ? a.block !== false : a.block === true || a.isblock === true;
	return blocks ? Math.max(0, num(a.fadetime, num(a.duration, 0))) : 0;
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
	const beats: Beat[] = [];
	let effects = emptyEffects();
	const finish = (stop: Stop): Advance => {
		beats.push({ stage: next, effects, wait: 0 });
		return { cursor: { index, pick, hidden }, stage: next, stop, effects: mergeEffects(beats.map((beat) => beat.effects)), beats };
	};
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
			return finish({ kind: "line", line: step });
		}
		if (step.t === "decision") {
			return finish({ kind: "decision", decision: step });
		}
		next = applyCommand(next, step, effects);
		const caption = captionOf(step);
		if (caption !== null) {
			return finish({ kind: "caption", text: caption });
		}
		const wait = waitOf(step);
		if (wait > 0) {
			beats.push({ stage: next, effects, wait });
			effects = emptyEffects();
		}
	}
	return finish({ kind: "end" });
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
 * @returns Where it stopped, every line and caption passed on the way, for the Log, and the last stop passed when it was a line, so a choice it
 * lands on can keep that line on screen. A caption has no speaker.
 */
export function skipToStop(steps: Step[], cursor: Cursor, stage: StageState): { result: Advance; lines: { name: string | null; text: string }[]; last: LineStep | null } {
	const lines: { name: string | null; text: string }[] = [];
	let last: LineStep | null = null;
	let result = advance(steps, cursor, stage);
	while (result.stop.kind === "line" || result.stop.kind === "caption") {
		lines.push(result.stop.kind === "line" ? { name: result.stop.line.name, text: result.stop.line.text } : { name: null, text: result.stop.text });
		last = result.stop.kind === "line" ? result.stop.line : null;
		result = advance(steps, result.cursor, result.stage);
	}
	return { result, lines, last };
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Counting

/**
 * Walk from the cursor to the next choice or the end, counting the lines and captions on the way, as `advance` would stop at them.
 *
 * @param steps The story's steps.
 * @param cursor Where to start.
 * @returns The count, and where and at what choice the walk stopped.
 */
function walkLines(steps: Step[], cursor: Cursor): LineWalk {
	let { index, hidden } = cursor;
	const { pick } = cursor;
	let lines = 0;
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
		if (step.t === "decision") {
			return { lines, cursor: { index, pick, hidden }, decision: step };
		}
		if (step.t === "line" || captionOf(step) !== null) {
			lines++;
		}
	}
	return { lines, cursor: { index, pick, hidden }, decision: null };
}

/**
 * How many lines and captions lie ahead of the cursor on the path being read. A choice not yet made counts its longest answer, walked up to the
 * choice after it, so the total can only drop once the reader picks. Each choice is walked once per answer, so a long run of them stays cheap.
 *
 * @param steps The story's steps.
 * @param cursor Where the reader is, as `advance` returns it.
 * @param decision The choice waiting at the cursor, or null when the reader is not at one.
 * @returns The count.
 */
export function linesAhead(steps: Step[], cursor: Cursor, decision: DecisionStep | null = null): number {
	let ahead = 0;
	let at = cursor;
	let waiting = decision;
	for (;;) {
		const starts = waiting ? waiting.values.map((value) => choose(at, value)) : [at];
		let longest: LineWalk | null = null;
		for (const start of starts) {
			const walk = walkLines(steps, start);
			if (longest === null || walk.lines > longest.lines) {
				longest = walk;
			}
		}
		if (longest === null) {
			return ahead;
		}
		ahead += longest.lines;
		if (longest.decision === null) {
			return ahead;
		}
		at = longest.cursor;
		waiting = longest.decision;
	}
}
