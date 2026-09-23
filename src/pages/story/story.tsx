import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Box, Button, GlobalStyles, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link, useParams } from "react-router-dom";

import { LoadError, ScrollToTop } from "archive-kit";

import { loadStory, loadStoryGroup, loadStoryPresence, storyAudioUrl } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import type { LineStep, StoryFile, StoryGroup } from "../../types/story.js";
import { START, advance, choose, emptyStage, skipToStop } from "./engine.js";
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

/** Where the reader's name and the mute state are kept. The name is the only thing the story player stores. */
const NICKNAME_KEY = "storyNickname";
const MUTED_KEY = "storyMuted";

/** The name used until the reader sets one. */
const DEFAULT_NICKNAME = "Doctor";

/** The page: a black band with the stage centred at the largest 16:9 that fits under the bar. */
const PAGE_SX: SxProps<Theme> = { background: "#000", minHeight: "calc(100vh - 64px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", py: 1 };

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

/** The keyframes the stage uses for fades and shakes. */
const KEYFRAMES = {
	"@keyframes storyFadeIn": { from: { opacity: 0 }, to: { opacity: 1 } },
	"@keyframes storyShake": {
		"0%, 100%": { transform: "translate(0, 0)" },
		"20%": { transform: "translate(-0.6%, 0.4%)" },
		"40%": { transform: "translate(0.6%, -0.4%)" },
		"60%": { transform: "translate(-0.4%, -0.3%)" },
		"80%": { transform: "translate(0.4%, 0.3%)" }
	}
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
 * The Log entries a walk adds: the line it stopped at, if any.
 *
 * @param result The walk.
 * @returns The new entries.
 */
function stopEntries(result: Advance): LogEntry[] {
	return result.stop.kind === "line" ? [{ kind: "line", name: result.stop.line.name, text: result.stop.line.text }] : [];
}

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
	const [sounds, setSounds] = useState({ id: 0, list: run.effects.sounds, stop: run.effects.stopSounds });
	const [shakeKey, setShakeKey] = useState(0);

	const urlOf = useCallback((ref: string) => storyAudioUrl(ref, presence), [presence]);
	const resumeAudio = useStoryAudio({ music: run.stage.music, sounds, muted, urlOf });

	const line: LineStep | null = run.stop.kind === "line" ? run.stop.line : null;
	const shown = useMemo(
		() => (line ? { ...line, text: line.text.replaceAll("{@nickname}", nickname), spans: line.spans?.map((span) => ({ ...span, text: span.text.replaceAll("{@nickname}", nickname) })) } : null),
		[line, nickname]
	);
	const length = shown?.text.length ?? 0;
	const index = group.stories.findIndex((entry) => entry.id === story.id);
	const next = index >= 0 ? group.stories[index + 1] : undefined;

	const land = useCallback((result: Advance, passed: LogEntry[]) => {
		setRun(result);
		setTyped(0);
		setLog((entries) => [...entries, ...passed, ...stopEntries(result)]);
		setSounds((current) => ({ id: current.id + 1, list: result.effects.sounds, stop: result.effects.stopSounds }));
		if (result.effects.shake > 0) {
			setShakeKey((key) => key + 1);
		}
	}, []);

	const step = useCallback(() => {
		if (run.stop.kind !== "line") {
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
		if (run.stop.kind !== "line") {
			return;
		}
		const { result, lines } = skipToStop(steps, run.cursor, run.stage);
		land(
			result,
			lines.map((entry) => ({ kind: "line" as const, name: entry.name, text: entry.text }))
		);
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
		if (!auto || logOpen || run.stop.kind !== "line" || typed < length) {
			return;
		}
		const timer = window.setTimeout(step, AUTO_BASE_MS + AUTO_PER_CHAR_MS * length + run.effects.delay * 1000);
		return () => window.clearTimeout(timer);
	}, [auto, logOpen, run, typed, length, step]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.code === "Space" || event.code === "Enter") {
				event.preventDefault();
				resumeAudio();
				step();
			} else if (event.code === "Escape") {
				setLogOpen(false);
				setHideUi(false);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [step, resumeAudio]);

	const onStage = useCallback(() => {
		resumeAudio();
		if (hideUi) {
			setHideUi(false);
			return;
		}
		if (!logOpen) {
			step();
		}
	}, [resumeAudio, hideUi, logOpen, step]);

	const onNickname = useCallback((value: string) => {
		setNickname(value);
		writeStored(NICKNAME_KEY, value);
	}, []);

	const toggleMute = useCallback(() => {
		setMuted((value) => {
			writeStored(MUTED_KEY, value ? "0" : "1");
			return !value;
		});
	}, []);

	const stopClick = (handler: () => void) => (event: { stopPropagation: () => void }) => {
		event.stopPropagation();
		handler();
	};

	return (
		<Box sx={PLAYER_SX}>
			<GlobalStyles styles={KEYFRAMES} />
			<StoryStage stage={run.stage} name={shown?.name ?? null} line={shown} typed={typed} presence={presence} hideText={hideUi} shakeKey={shakeKey} onClick={onStage}>
				{!hideUi ? (
					<>
						<Box sx={{ ...CHROME_SX, left: "4%" }}>
							<Button sx={CHROME_BUTTON_SX} onClick={stopClick(() => setLogOpen(true))}>
								LOG
							</Button>
							<Button sx={CHROME_BUTTON_SX} aria-label="Hide the text" onClick={stopClick(() => setHideUi(true))}>
								HIDE
							</Button>
						</Box>
						<Box sx={{ ...CHROME_SX, right: "4%" }}>
							<Button sx={CHROME_BUTTON_SX} onClick={stopClick(toggleMute)}>
								{muted ? "SOUND OFF" : "SOUND ON"}
							</Button>
							<Button sx={CHROME_BUTTON_SX} onClick={stopClick(() => setAuto((value) => !value))}>
								AUTO{" "}
								<Box component="span" sx={{ color: auto ? "primary.main" : "#999", ml: 0.5 }}>
									{auto ? "ON" : "OFF"}
								</Box>
							</Button>
							<Button sx={CHROME_BUTTON_SX} onClick={stopClick(skip)} disabled={run.stop.kind !== "line"}>
								SKIP
							</Button>
						</Box>
					</>
				) : null}
				{run.stop.kind === "decision" ? (
					<Box sx={CHOICES_SX} onClick={(event) => event.stopPropagation()}>
						{run.stop.decision.options.map((option, choice) => (
							<Button key={choice} sx={CHOICE_SX} onClick={() => pick(option, run.stop.kind === "decision" ? (run.stop.decision.values[choice] ?? "") : "")}>
								{option.replaceAll("{@nickname}", nickname)}
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
									Next: {next.code ? `${next.code} ` : ""}
									{next.name}
								</Button>
							) : null}
							<Button component={Link} to={`/stories/${group.id}`} variant="outlined">
								Back to {group.name}
							</Button>
						</Box>
					</Box>
				) : null}
				{logOpen ? <StoryLog entries={log} nickname={nickname} onNickname={onNickname} onClose={() => setLogOpen(false)} /> : null}
			</StoryStage>
			{!hideUi && shown ? (
				<Box sx={NARROW_TEXT_SX} onClick={onStage}>
					{shown.name ? (
						<Typography variant="subtitle2" sx={{ color: "primary.main", fontFamily: "inherit" }}>
							{shown.name}
						</Typography>
					) : null}
					<Typography sx={{ fontFamily: "inherit" }}>{typedRuns(shown, typed)}</Typography>
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
			document.title = `${entry.code ? `${entry.code} ` : ""}${entry.name} - ${data.group.name} - Arknights Archive`;
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
							{entry ? `${entry.code ? `${entry.code} ` : ""}${entry.name}` : data.story.id}
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
