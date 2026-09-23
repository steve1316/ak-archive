import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Box, Button, GlobalStyles, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link, useParams } from "react-router-dom";

import { LoadError, ScrollToTop } from "archive-kit";

import { loadStory, loadStoryGroup, loadStoryPresence, storyAssetUrl, storyAudioUrl } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import { NAVBAR_HEIGHT } from "../../lib/layout.js";
import type { LineStep, StoryFile, StoryGroup, StoryGroupEntry } from "../../types/story.js";
import { START, advance, choose, emptyStage, fillNickname, skipToStop, upcomingArt } from "./engine.js";
import type { Advance } from "./engine.js";
import StoryLog from "./StoryLog.js";
import type { LogEntry } from "./StoryLog.js";
import StoryStage, { NARROW_STAGE, typedRuns } from "./StoryStage.js";
import { useStoryAudio } from "./useStoryAudio.js";

/** How long one character takes to type, in milliseconds. */
const TYPE_MS = 28;

/** AUTO's pause after a line, in milliseconds: a base plus a share per character. */
const AUTO_BASE_MS = 900;
const AUTO_PER_CHAR_MS = 35;

/** How many stops ahead the player preloads art for. */
const PRELOAD_STOPS = 3;

/** Where the reader's name and the mute state are kept. The name is the only thing the story player stores. */
const NICKNAME_KEY = "storyNickname";
const MUTED_KEY = "storyMuted";

/** The name used until the reader sets one. */
const DEFAULT_NICKNAME = "Doctor";

/** The page: a black band with the stage centred at the largest 16:9 that fits under the bar. */
const PAGE_SX: SxProps<Theme> = { background: "#000", minHeight: `calc(100vh - ${NAVBAR_HEIGHT}px)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", py: 1 };

/** The stage's box: as wide as the page allows while still fitting the viewport's height. */
const STAGE_BOX_SX: SxProps<Theme> = { width: "min(100%, calc((100vh - 120px) * 16 / 9))" };

/** The top-right and top-left chrome. */
const CHROME_SX: SxProps<Theme> = { position: "absolute", top: "4%", display: "flex", gap: "2cqh", zIndex: 4, fontSize: "max(11px, 2.2cqh)" };

/** One chrome button: plain text on the stage. */
const CHROME_BUTTON_SX: SxProps<Theme> = { color: "#fff", minWidth: 0, p: "0.4cqh 0.8cqh", fontSize: "inherit", fontFamily: "inherit", letterSpacing: "0.04em" };

/** The choice list, centred on the stage. */
const CHOICES_SX: SxProps<Theme> = {
	position: "absolute",
	left: "50%",
	top: "50%",
	transform: "translate(-50%, -50%)",
	width: "58%",
	display: "grid",
	gap: "1.8cqh",
	zIndex: 6,
	[NARROW_STAGE]: { width: "90%" }
};

/** One choice bar. */
const CHOICE_SX: SxProps<Theme> = {
	background: "rgba(30,30,32,0.92)",
	border: "1px solid #ddd",
	color: "#fff",
	p: "1.8cqh",
	fontSize: "max(13px, 2.5cqh)",
	fontFamily: "inherit",
	textTransform: "none",
	borderRadius: 0,
	"&:hover": { background: "rgba(60,60,64,0.95)" }
};

/** The player column, a container so the line under the stage follows the same width rule as the stage itself. */
const PLAYER_SX: SxProps<Theme> = { ...STAGE_BOX_SX, containerType: "inline-size" };

/** The line under the stage when the stage is too narrow for its own text to be readable. */
const NARROW_TEXT_SX: SxProps<Theme> = {
	display: "none",
	[NARROW_STAGE]: { display: "block" },
	mt: 1.5,
	px: 1,
	minHeight: "5.5em",
	fontFamily: '"Noto Sans", sans-serif',
	color: "#eef0f4",
	lineHeight: 1.5
};

/** One camera shake. */
const SHAKE_FRAMES = {
	"0%, 100%": { transform: "translate(0, 0)" },
	"20%": { transform: "translate(-0.6%, 0.4%)" },
	"40%": { transform: "translate(0.6%, -0.4%)" },
	"60%": { transform: "translate(-0.4%, -0.3%)" },
	"80%": { transform: "translate(0.4%, 0.3%)" }
};

/** The keyframes the stage uses for fades and shakes. The shake has two identical names, so switching between them restarts it without a remount. */
const KEYFRAMES = {
	"@keyframes storyFadeIn": { from: { opacity: 0 }, to: { opacity: 1 } },
	"@keyframes storyShake0": SHAKE_FRAMES,
	"@keyframes storyShake1": SHAKE_FRAMES
};

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
 * The Log entries a walk adds: the line or caption it stopped at, if any.
 *
 * @param result The walk.
 * @returns The new entries.
 */
function stopEntries(result: Advance): LogEntry[] {
	if (result.stop.kind === "line") {
		return [lineEntry(result.stop.line)];
	}
	return result.stop.kind === "caption" ? [lineEntry({ name: null, text: result.stop.text })] : [];
}

/**
 * A story's title with its stage code, such as `0-1 Collapse`.
 *
 * @param entry The story.
 * @returns The title.
 */
function storyTitle(entry: StoryGroupEntry): string {
	return `${entry.code ? `${entry.code} ` : ""}${entry.name}`;
}

/**
 * A click handler that keeps the click from reaching the stage, which would advance the story.
 *
 * @param handler What the click does.
 * @returns The click handler.
 */
function stopClick(handler: () => void) {
	return (event: { stopPropagation: () => void }) => {
		event.stopPropagation();
		handler();
	};
}

/** Props for PlayerChrome. */
interface PlayerChromeProps {
	/** Whether sound is heard: not muted, and not held back by the browser. */
	soundOn: boolean;
	/** Whether AUTO is on. */
	auto: boolean;
	/** Whether SKIP can run, which is only while a line is showing. */
	canSkip: boolean;
	/** Opens the Log. */
	onLog: () => void;
	/** Hides the text and chrome. */
	onHide: () => void;
	/** Toggles the sound. */
	onSound: () => void;
	/** Toggles AUTO. */
	onAuto: () => void;
	/** Skips to the next choice or the end. */
	onSkip: () => void;
}

/**
 * LOG and HIDE at the top left, and SOUND, AUTO and SKIP at the top right. Memoised, so the typewriter's ticks leave it alone.
 *
 * @param props Component props.
 * @returns The chrome.
 */
const PlayerChrome = memo(function PlayerChrome({ soundOn, auto, canSkip, onLog, onHide, onSound, onAuto, onSkip }: PlayerChromeProps) {
	return (
		<>
			<Box sx={{ ...CHROME_SX, left: "4%" }}>
				<Button sx={CHROME_BUTTON_SX} onClick={stopClick(onLog)}>
					LOG
				</Button>
				<Button sx={CHROME_BUTTON_SX} aria-label="Hide the text" onClick={stopClick(onHide)}>
					HIDE
				</Button>
			</Box>
			<Box sx={{ ...CHROME_SX, right: "4%" }}>
				<Button sx={CHROME_BUTTON_SX} onClick={stopClick(onSound)}>
					{soundOn ? "SOUND ON" : "SOUND OFF"}
				</Button>
				<Button sx={CHROME_BUTTON_SX} onClick={stopClick(onAuto)}>
					AUTO{" "}
					<Box component="span" sx={{ color: auto ? "primary.main" : "#999", ml: 0.5 }}>
						{auto ? "ON" : "OFF"}
					</Box>
				</Button>
				<Button sx={CHROME_BUTTON_SX} onClick={stopClick(onSkip)} disabled={!canSkip}>
					SKIP
				</Button>
			</Box>
		</>
	);
});

/** Props for StoryPlayer. */
interface StoryPlayerProps {
	/** The story being played. */
	story: StoryFile;
	/** The group it belongs to, for its title and the next story. */
	group: StoryGroup;
	/** Which story assets are published. */
	presence: StoryPresence;
}

/**
 * Plays one story: the stage, the typewriter text, choices, AUTO, SKIP, LOG, hide and mute, music and sound. Keyed on the story id by its parent,
 * so opening another story always starts from an empty stage.
 *
 * @param props Component props.
 * @returns The player.
 */
function StoryPlayer({ story, group, presence }: StoryPlayerProps) {
	const steps = story.steps;
	const [run, setRun] = useState<Advance>(() => advance(steps, START, emptyStage()));
	const [log, setLog] = useState<LogEntry[]>(() => stopEntries(run));
	const [typed, setTyped] = useState(0);
	const [auto, setAuto] = useState(false);
	const [hideUi, setHideUi] = useState(false);
	const [logOpen, setLogOpen] = useState(false);
	const [muted, setMuted] = useState(() => readStored(MUTED_KEY) === "1");
	const [nickname, setNickname] = useState(() => readStored(NICKNAME_KEY) || DEFAULT_NICKNAME);
	const [shakeKey, setShakeKey] = useState(0);

	const urlOf = useCallback((ref: string) => storyAudioUrl(ref, presence), [presence]);
	const { resume: resumeAudio, blocked } = useStoryAudio({ music: run.stage.music, effects: run.effects, muted, urlOf });
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

	const land = useCallback((result: Advance, passed: LogEntry[]) => {
		setRun(result);
		setTyped(0);
		setLog((entries) => [...entries, ...passed, ...stopEntries(result)]);
		if (result.effects.shake > 0) {
			setShakeKey((key) => key + 1);
		}
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
		const { result, lines } = skipToStop(steps, run.cursor, run.stage);
		land(result, lines.map(lineEntry));
	}, [run, steps, land]);

	// Typewriter: reveal the line a character at a time.
	useEffect(() => {
		if (typed >= length) {
			return;
		}
		const timer = window.setTimeout(() => setTyped((count) => count + 1), TYPE_MS);
		return () => window.clearTimeout(timer);
	}, [typed, length]);

	// AUTO: once a line has typed out, wait in proportion to its length plus any pause the script asked for, then move on.
	useEffect(() => {
		if (!auto || logOpen || !reading || typed < length) {
			return;
		}
		const timer = window.setTimeout(step, AUTO_BASE_MS + AUTO_PER_CHAR_MS * (caption?.length ?? length) + run.effects.delay * 1000);
		return () => window.clearTimeout(timer);
	}, [auto, logOpen, reading, caption, run, typed, length, step]);

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

	// The key listener reads `step` through a ref, so the typewriter's ticks do not re-attach it.
	const stepRef = useRef(step);
	useEffect(() => {
		stepRef.current = step;
	}, [step]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			// Space and Enter keep their own meaning in a field, a button or a link, and do nothing behind the open Log.
			const onControl = event.target instanceof Element && event.target.closest("input, textarea, button, a, [contenteditable='true']") !== null;
			if ((event.code === "Space" || event.code === "Enter") && !onControl && !logOpen) {
				event.preventDefault();
				resumeAudio();
				stepRef.current();
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

	const onNickname = useCallback((value: string) => {
		setNickname(value);
		writeStored(NICKNAME_KEY, value);
	}, []);

	// While the browser holds the sound back, SOUND shows OFF and a click on it only lets the sound start, which the player's click capture does.
	const toggleSound = useCallback(() => {
		if (blocked && !muted) {
			return;
		}
		setMuted((value) => {
			writeStored(MUTED_KEY, value ? "0" : "1");
			return !value;
		});
	}, [blocked, muted]);

	const openLog = useCallback(() => setLogOpen(true), []);
	const closeLog = useCallback(() => setLogOpen(false), []);
	const hide = useCallback(() => setHideUi(true), []);
	const toggleAuto = useCallback(() => setAuto((value) => !value), []);

	return (
		<Box sx={PLAYER_SX} onClickCapture={resumeAudio}>
			<GlobalStyles styles={KEYFRAMES} />
			<StoryStage stage={run.stage} name={shown?.name ?? null} line={shown} typed={typed} nickname={nickname} presence={presence} hideText={hideUi} shakeKey={shakeKey} onClick={onStage}>
				{!hideUi ? <PlayerChrome soundOn={!muted && !blocked} auto={auto} canSkip={reading} onLog={openLog} onHide={hide} onSound={toggleSound} onAuto={toggleAuto} onSkip={skip} /> : null}
				{decision ? (
					<Box sx={CHOICES_SX} onClick={(event) => event.stopPropagation()}>
						{decision.options.map((option, choice) => (
							<Button key={choice} sx={CHOICE_SX} onClick={() => pick(option, decision.values[choice] ?? "")}>
								{fillNickname(option, nickname)}
							</Button>
						))}
					</Box>
				) : null}
				{run.stop.kind === "end" ? (
					<Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.6)", zIndex: 6 }} onClick={(event) => event.stopPropagation()}>
						<Box sx={{ textAlign: "center", display: "grid", gap: 2 }}>
							<Typography sx={{ fontSize: "3cqh" }}>End of story</Typography>
							{next ? (
								<Button component={Link} to={`/story/${group.id}/${next.id}`} variant="contained">
									Next: {storyTitle(next)}
								</Button>
							) : null}
							<Button component={Link} to={`/stories/${group.id}`} variant="outlined">
								Back to {group.name}
							</Button>
						</Box>
					</Box>
				) : null}
				{logOpen ? <StoryLog entries={log} nickname={nickname} onNickname={onNickname} onClose={closeLog} /> : null}
			</StoryStage>
			{!hideUi && (shown || caption) ? (
				<Box sx={NARROW_TEXT_SX} onClick={onStage}>
					{shown?.name ? (
						<Typography variant="subtitle2" sx={{ color: "primary.main", fontFamily: "inherit" }}>
							{shown.name}
						</Typography>
					) : null}
					<Typography sx={{ fontFamily: "inherit" }}>{shown ? typedRuns(shown, typed) : caption}</Typography>
				</Box>
			) : null}
		</Box>
	);
}

/**
 * The story player route: loads the story, its group and the asset presence, then plays it.
 *
 * @returns The page.
 */
export default function Story() {
	const { group: groupId = "", story: storyId = "" } = useParams();
	const [data, setData] = useState<{ story: StoryFile; group: StoryGroup; presence: StoryPresence } | null>(null);
	const [error, setError] = useState(false);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		let active = true;
		setData(null);
		setError(false);
		Promise.all([loadStory(storyId), loadStoryGroup(groupId), loadStoryPresence()]).then(
			([story, group, presence]) => {
				if (active) {
					setData({ story, group, presence });
				}
			},
			() => {
				if (active) {
					setError(true);
				}
			}
		);
		return () => {
			active = false;
		};
	}, [groupId, storyId, attempt]);

	const entry = data?.group.stories.find((item) => item.id === storyId);
	useEffect(() => {
		if (data && entry) {
			document.title = `${storyTitle(entry)} - ${data.group.name} - Arknights Archive`;
		}
	}, [data, entry]);

	return (
		<Box component="main" sx={PAGE_SX}>
			<ScrollToTop />
			{error ? (
				<LoadError what="this story" onRetry={() => setAttempt((value) => value + 1)} titleComponent="h1" />
			) : data ? (
				<>
					<Box sx={{ ...STAGE_BOX_SX, display: "flex", alignItems: "baseline", gap: 1.5, mb: 1, color: "#cfd3da" }}>
						<Button component={Link} to={`/stories/${data.group.id}`} size="small">
							{data.group.name}
						</Button>
						<Typography component="h1" variant="body1">
							{entry ? storyTitle(entry) : data.story.id}
						</Typography>
						<Typography variant="body2" color="text.secondary">
							{entry?.tag}
						</Typography>
					</Box>
					<StoryPlayer key={data.story.id} story={data.story} group={data.group} presence={data.presence} />
				</>
			) : (
				<Typography color="text.secondary" role="status">
					Loading...
				</Typography>
			)}
		</Box>
	);
}
