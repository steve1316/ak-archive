import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMediaSession, useStorySettings } from "archive-kit";
import type { StoryCornerProps, StoryLine, StorySettingsState } from "archive-kit";

import { musicTitle, storyAssetUrl, storyAudioUrl } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import { isControlTarget, isTextTarget } from "../../lib/keys.js";
import type { DecisionStep, LineStep, StoryFile, StoryGroup, StoryGroupEntry } from "../../types/story.js";
import { START, advance, choose, emptyEffects, emptyStage, fillNickname, lineNumber, lineOrder, skipToStop, upcomingArt } from "./engine.js";
import type { Advance } from "./engine.js";
import { useMusicTitles } from "./useMusicTitles.js";
import { useStoryAudio } from "./useStoryAudio.js";

/** How long one character takes to type at 1x, in milliseconds. */
const TYPE_MS = 28;

/** AUTO's pause after a line, in milliseconds: a base plus a share per character, which the text speed scales. */
const AUTO_BASE_MS = 900;
const AUTO_PER_CHAR_MS = 35;

/** How many stops ahead the player preloads art for. */
const PRELOAD_STOPS = 3;

/** Where the reader's name, the mute state and AUTO are kept, so they carry over from one story to the next. Progress is never stored. */
const NICKNAME_KEY = "storyNickname";
const MUTED_KEY = "storyMuted";
const AUTO_KEY = "storyAuto";

/** Where the reader's story settings are kept. GFL shares this origin, so the key carries the site's name. */
const SETTINGS_KEY = "ak.storySettings";

/** The name used until the reader sets one. */
const DEFAULT_NICKNAME = "Doctor";

/** One entry in the Log: a line, a choice the reader picked, or a track that started, by the reference the script played. */
type LogEntry = { kind: "line"; name: string | null; text: string } | { kind: "pick"; text: string } | { kind: "music"; ref: string };

/** Everything a view needs to draw one story and drive it, from `useStoryRun`. */
export interface StoryRun {
	/** Where the story stands: the stage, the stop it waits at and the last walk's effects. */
	run: Advance;
	/**
	 * Every line, pick and track start so far, oldest first, ending with the line on screen, with the reader's name filled in. A track with no
	 * title is left out. Both views' Logs and the phone's transcript read it.
	 */
	lines: StoryLine[];
	/** The corner's line count and the track that started. It keeps its identity between the typewriter's ticks. */
	corner: StoryCornerProps;
	/** How many characters of the line have typed out. */
	typed: number;
	/** The line on screen with the reader's name filled in, or null when the stop is not a line. */
	shown: LineStep | null;
	/** The caption on screen with the reader's name filled in, or null. */
	caption: string | null;
	/** The choice on screen, or null. */
	decision: DecisionStep | null;
	/** The shown line's full length, which the typewriter counts up to. */
	length: number;
	/** Whether a line or caption is waiting for the reader, which is when SKIP and AUTO can move on. */
	reading: boolean;
	/** Whether there is an earlier stop to step back to. */
	canBack: boolean;
	/** The next story in the group, or undefined at its end. */
	next: StoryGroupEntry | undefined;
	/** Whether AUTO is on. */
	auto: boolean;
	/** Whether the text and chrome are hidden. */
	hideUi: boolean;
	/** Whether the Log is open. */
	logOpen: boolean;
	/** Whether sound is heard: not muted, and not held back by the browser until the reader interacts. */
	soundOn: boolean;
	/** The reader's name, which fills `{@nickname}`. */
	nickname: string;
	/** The reader's text speed, volumes and phone scene size, saved per browser. */
	settings: StorySettingsState;
	/** Changes each time the stage should shake. */
	shakeKey: number;
	/** Steps back to the previous stop. */
	back: () => void;
	/** Picks a choice. */
	pick: (option: string, value: string) => void;
	/** Skips to the next choice or the end. */
	skip: () => void;
	/** A click on the stage: shows hidden text again, or steps. */
	onStage: () => void;
	/** Opens the Log. */
	openLog: () => void;
	/** Closes the Log. */
	closeLog: () => void;
	/** Hides the text and chrome. */
	hide: () => void;
	/** Toggles AUTO. */
	toggleAuto: () => void;
	/** Toggles the sound, or only lets it start while the browser holds it back. */
	toggleSound: () => void;
	/** Sets the reader's name. */
	setNickname: (value: string) => void;
	/** Runs first on any click in the player, letting blocked sound start. */
	interact: () => void;
}

/**
 * Read a stored value, surviving blocked storage.
 *
 * @param key The storage key.
 * @returns The value, or null.
 */
function readStored(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

/**
 * Store a value, ignoring blocked storage.
 *
 * @param key The storage key.
 * @param value The value.
 */
function writeStored(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Storage can be blocked, such as in a private window. The name then lasts for this visit only.
	}
}

/**
 * A line or caption as a Log entry.
 *
 * @param line The speaker, or null for narration, and the text.
 * @returns The entry.
 */
function lineEntry(line: { name: string | null; text: string }): LogEntry {
	return { kind: "line", name: line.name, text: line.text };
}

/**
 * The Log entries a walk adds: the track it started, if any, then the line or caption it stopped at, if any. So the Log shows where each
 * track begins. A track that starts again counts, since the engine hands over new music only when a track starts.
 *
 * @param result The walk.
 * @param before The music playing before the walk.
 * @returns The new entries.
 */
function stopEntries(result: Advance, before: Advance["stage"]["music"]): LogEntry[] {
	const music = result.stage.music;
	const started: LogEntry[] = music && music !== before ? [{ kind: "music", ref: music.loop }] : [];
	if (result.stop.kind === "line") {
		return [...started, lineEntry(result.stop.line)];
	}
	return result.stop.kind === "caption" ? [...started, lineEntry({ name: null, text: result.stop.text })] : started;
}

/**
 * One story's reading state and controls: the walk through its steps, the typewriter, AUTO, SKIP, stepping back, the Log, hide and mute,
 * music and sound, the keyboard and the phone's media controls. Kept apart from any view, so the desktop and phone players share one reading.
 *
 * @param story The story being played.
 * @param group The group it belongs to, for the next story and the media controls.
 * @param title The story's title, such as `0-1 Collapse`, for the media controls.
 * @param presence Which story assets are published.
 * @returns The state and its controls.
 */
export function useStoryRun(story: StoryFile, group: StoryGroup, title: string, presence: StoryPresence): StoryRun {
	const steps = story.steps;
	const [run, setRun] = useState<Advance>(() => advance(steps, START, emptyStage()));
	const [log, setLog] = useState<LogEntry[]>(() => stopEntries(run, null));
	const [typed, setTyped] = useState(0);
	const [auto, setAuto] = useState(() => readStored(AUTO_KEY) === "1");
	const [hideUi, setHideUi] = useState(false);
	const [logOpen, setLogOpen] = useState(false);
	const [muted, setMuted] = useState(() => readStored(MUTED_KEY) === "1");
	const [nickname, setNicknameState] = useState(() => readStored(NICKNAME_KEY) || DEFAULT_NICKNAME);
	const [shakeKey, setShakeKey] = useState(0);

	const settings = useStorySettings(SETTINGS_KEY);
	const urlOf = useCallback((ref: string) => storyAudioUrl(ref, presence), [presence]);
	const { resume: resumeAudio, blocked } = useStoryAudio({ music: run.stage.music, effects: run.effects, muted, bgm: settings.bgm, sfx: settings.sfx, urlOf });
	const titles = useMusicTitles();
	const preloaded = useRef(new Set<string>());

	const line: LineStep | null = run.stop.kind === "line" ? run.stop.line : null;
	const caption = run.stop.kind === "caption" ? fillNickname(run.stop.text, nickname) : null;
	const decision = run.stop.kind === "decision" ? run.stop.decision : null;
	const shown = useMemo(() => (line ? fillNickname(line, nickname) : null), [line, nickname]);
	const length = shown?.text.length ?? 0;
	// A line or a caption waits for the reader, and SKIP and AUTO move past either.
	const reading = line !== null || caption !== null;
	const index = group.stories.findIndex((entry) => entry.id === story.id);
	const next = index >= 0 ? group.stories[index + 1] : undefined;
	const art = run.stage.image ?? run.stage.background;
	const artUrl = art ? storyAssetUrl(art.kind, art.name, presence) : null;

	// Built once per change and shared by both views. A track with no title, such as one the titles do not know, is left out.
	const lines = useMemo<StoryLine[]>(
		() =>
			log.flatMap((entry): StoryLine[] => {
				if (entry.kind === "music") {
					const trackTitle = musicTitle(titles, entry.ref);
					return trackTitle ? [{ speaker: null, text: trackTitle, kind: "track" }] : [];
				}
				return entry.kind === "pick" ? [{ speaker: null, text: fillNickname(entry.text, nickname), kind: "choice" }] : [{ speaker: entry.name, text: fillNickname(entry.text, nickname) }];
			}),
		[log, nickname, titles]
	);

	// Counted once per story: every line and caption in script order, both sides of each branch.
	const order = useMemo(() => lineOrder(steps), [steps]);
	const progress = useMemo(() => ({ at: lineNumber(order, run.cursor), total: order.total }), [order, run.cursor]);
	// A new object each time a track starts, so the corner shows its title again even for the same track.
	const music = run.stage.music;
	const track = useMemo(() => {
		const trackTitle = music ? musicTitle(titles, music.loop) : null;
		return trackTitle ? { title: trackTitle } : null;
	}, [music, titles]);
	const corner = useMemo<StoryCornerProps>(() => ({ progress, track }), [progress, track]);

	// Every stop the reader has left, with the Log's length there, so the left arrow can step back to it.
	const history = useRef<{ run: Advance; logLength: number }[]>([]);
	const logLength = log.length;

	const land = useCallback(
		(result: Advance, passed: LogEntry[]) => {
			history.current.push({ run, logLength });
			setRun(result);
			setTyped(0);
			setLog((entries) => [...entries, ...passed, ...stopEntries(result, run.stage.music)]);
			if (result.effects.shake > 0) {
				setShakeKey((key) => key + 1);
			}
		},
		[run, logLength]
	);

	// Step back to the previous stop with its line shown in full. Its sounds and shake do not play again, and the Log forgets what came after.
	const back = useCallback(() => {
		const previous = history.current.pop();
		if (!previous) {
			return;
		}
		setRun({ ...previous.run, effects: emptyEffects() });
		setTyped(Number.MAX_SAFE_INTEGER);
		setLog((entries) => entries.slice(0, previous.logLength));
	}, []);

	const step = useCallback(() => {
		if (run.stop.kind !== "line" && run.stop.kind !== "caption") {
			return;
		}
		if (typed < length) {
			setTyped(length);
			return;
		}
		land(advance(steps, run.cursor, run.stage), []);
	}, [run, typed, length, steps, land]);

	const pick = useCallback(
		(option: string, value: string) => {
			land(advance(steps, choose(run.cursor, value), run.stage), [{ kind: "pick", text: option }]);
		},
		[run, steps, land]
	);

	const skip = useCallback(() => {
		if (run.stop.kind !== "line" && run.stop.kind !== "caption") {
			return;
		}
		const { result, lines: passed } = skipToStop(steps, run.cursor, run.stage);
		land(result, passed.map(lineEntry));
	}, [run, steps, land]);

	// Typewriter: reveal the line a character at a time.
	useEffect(() => {
		if (typed >= length) {
			return;
		}
		const timer = window.setTimeout(() => setTyped((count) => count + 1), TYPE_MS / settings.speed);
		return () => window.clearTimeout(timer);
	}, [typed, length, settings.speed]);

	// AUTO: once a line has typed out, wait in proportion to its length plus any pause the script asked for, then move on. The per-character
	// share follows the text speed, while the base and the script's own pauses do not.
	useEffect(() => {
		if (!auto || logOpen || !reading || typed < length) {
			return;
		}
		const timer = window.setTimeout(step, AUTO_BASE_MS + (AUTO_PER_CHAR_MS / settings.speed) * (caption?.length ?? length) + run.effects.delay * 1000);
		return () => window.clearTimeout(timer);
	}, [auto, logOpen, reading, caption, run, typed, length, step, settings.speed]);

	// Preload the art of the next few stops, so a new scene does not appear half-loaded.
	useEffect(() => {
		for (const { kind, name } of upcomingArt(steps, run.cursor, run.stage, PRELOAD_STOPS)) {
			const url = storyAssetUrl(kind, name, presence);
			if (url && !preloaded.current.has(url)) {
				preloaded.current.add(url);
				new Image().src = url;
			}
		}
	}, [steps, run, presence]);

	// The key listener reads `step` and `back` through a ref, so the typewriter's ticks do not re-attach it.
	const stepRef = useRef(step);
	const backRef = useRef(back);
	useEffect(() => {
		stepRef.current = step;
		backRef.current = back;
	}, [step, back]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			// Space and Enter keep their own meaning in a field, a button or a link, and the arrows in a field. None of them act behind the open Log.
			const forward = (event.code === "Space" || event.code === "Enter") && !isControlTarget(event.target);
			const arrow = (event.code === "ArrowRight" || event.code === "ArrowLeft") && !isTextTarget(event.target);
			if ((forward || arrow) && !logOpen) {
				event.preventDefault();
				resumeAudio();
				if (event.code === "ArrowLeft") {
					backRef.current();
				} else {
					stepRef.current();
				}
			} else if (event.code === "Escape") {
				setLogOpen(false);
				setHideUi(false);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [resumeAudio, logOpen]);

	const onStage = useCallback(() => {
		if (hideUi) {
			setHideUi(false);
			return;
		}
		if (!logOpen) {
			step();
		}
	}, [hideUi, logOpen, step]);

	const setNickname = useCallback((value: string) => {
		setNicknameState(value);
		writeStored(NICKNAME_KEY, value);
	}, []);

	// Every click in the player lets blocked sound start. It notes first whether the sound was blocked, since the resume clears `blocked` before
	// the SOUND button's own handler runs.
	const blockedAtClick = useRef(false);
	const interact = useCallback(() => {
		blockedAtClick.current = blocked;
		resumeAudio();
	}, [blocked, resumeAudio]);

	// While the browser holds the sound back, SOUND shows OFF and a click on it only lets the sound start.
	const toggleSound = useCallback(() => {
		if (blockedAtClick.current && !muted) {
			return;
		}
		setMuted((value) => {
			writeStored(MUTED_KEY, value ? "0" : "1");
			return !value;
		});
	}, [muted]);

	// The phone's media controls show the story and the scene on screen, rather than the site's icon and address.
	useMediaSession({ title, artist: group.name, album: "Arknights Archive", artwork: artUrl });

	const openLog = useCallback(() => setLogOpen(true), []);
	const closeLog = useCallback(() => setLogOpen(false), []);
	const hide = useCallback(() => setHideUi(true), []);
	const toggleAuto = useCallback(() => {
		setAuto((value) => {
			writeStored(AUTO_KEY, value ? "0" : "1");
			return !value;
		});
	}, []);

	return {
		run,
		lines,
		corner,
		typed,
		shown,
		caption,
		decision,
		length,
		reading,
		canBack: history.current.length > 0,
		next,
		auto,
		hideUi,
		logOpen,
		soundOn: !muted && !blocked,
		nickname,
		settings,
		shakeKey,
		back,
		pick,
		skip,
		onStage,
		openLog,
		closeLog,
		hide,
		toggleAuto,
		toggleSound,
		setNickname,
		interact
	};
}
