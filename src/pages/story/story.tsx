import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import { Box, Button, Typography, useMediaQuery } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link, useParams } from "react-router-dom";

import { LoadError, ScrollToTop } from "archive-kit";

import { loadStory, loadStoryGroup, loadStoryPresence } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import { fillBelowNavbar } from "../../lib/layout.js";
import { storyGroupPath } from "../../lib/routes.js";
import type { StoryFile, StoryGroup, StoryGroupEntry } from "../../types/story.js";
import { fillNickname } from "./engine.js";
import StoryLog from "./StoryLog.js";
import { COMPACT, COMPACT_QUERY, STACKED, STACKED_QUERY } from "./layouts.js";
import StoryStage, { typedRuns } from "./StoryStage.js";
import { useStoryRun } from "./useStoryRun.js";

/**
 * The page: a black band with the stage centred at the largest 16:9 that fits under the bar. Stacked, it is exactly the screen's height, with
 * the stage at the top and the text panel taking the rest, so nothing moves as lines and choices come and go. Compact, it is a size container
 * the stage fills the height of.
 */
const PAGE_SX: SxProps<Theme> = (theme) => ({
	background: "#000",
	...fillBelowNavbar(theme.mixins.toolbar, "minHeight"),
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	py: 1,
	[`@media ${STACKED_QUERY}, ${COMPACT_QUERY}`]: { ...fillBelowNavbar(theme.mixins.toolbar, "height"), py: 0 },
	[STACKED]: { justifyContent: "flex-start" },
	[COMPACT]: { containerType: "size" }
});

/** The stage's box: as wide as the page allows while still fitting the viewport's height. */
const STAGE_BOX_SX = {
	width: "min(100%, calc((100dvh - 120px) * 16 / 9))",
	[COMPACT]: { width: "min(100cqw, calc(100cqh * 16 / 9))" }
} as const satisfies SxProps<Theme>;

/** The group link and title over the stage. A phone on its side has no room for it, so the chrome carries a back link instead. */
const TITLE_SX: SxProps<Theme> = {
	...STAGE_BOX_SX,
	display: "flex",
	alignItems: "baseline",
	gap: 1.5,
	mb: 1,
	color: "#cfd3da",
	[STACKED]: { width: "100%", p: "8px 8px 0" },
	[COMPACT]: { display: "none" }
};

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
	zIndex: 6
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

/** One choice in the stacked panel, sized for a finger rather than for the stage. */
const PANEL_CHOICE_SX: SxProps<Theme> = { ...CHOICE_SX, fontSize: 15, p: "12px 14px" };

/**
 * The player column: the stage's width, or stacked, the stage over the text panel down to the bottom of the screen. Fullscreen, it is the whole
 * screen with the stage centred at the largest 16:9 that fits. The Log's drawer is placed against it.
 */
const PLAYER_SX: SxProps<Theme> = {
	...STAGE_BOX_SX,
	position: "relative",
	[STACKED]: { width: "100%", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
	"&:fullscreen": { width: "100%", height: "100%", display: "grid", placeItems: "center", background: "#000" },
	"&:fullscreen [data-region='story-stage']": { width: "min(100vw, calc(100vh * 16 / 9))" }
};

/** The stacked panel under the stage, holding the line or the choices. Always there, so the stage never moves. */
const PANEL_SX: SxProps<Theme> = { flex: 1, minHeight: 0, overflowY: "auto", p: "12px 16px", fontFamily: '"Noto Sans", sans-serif', color: "#eef0f4", lineHeight: 1.5 };

/** The compact layout's text box: the full width of the stage along its bottom, at a size a phone can read. Taps pass through to the stage. */
const COMPACT_TEXT_SX: SxProps<Theme> = {
	position: "absolute",
	left: 0,
	right: 0,
	bottom: 0,
	p: "32px 5% 12px",
	background: "linear-gradient(transparent, rgba(0,0,0,0.78) 35%, rgba(0,0,0,0.9))",
	fontFamily: '"Noto Sans", sans-serif',
	lineHeight: 1.45,
	pointerEvents: "none",
	zIndex: 3
};

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

/**
 * Whether an element is the one the browser shows fullscreen, following the browser, since the back gesture or `Esc` also leaves fullscreen.
 *
 * @param ref The element the Full button puts fullscreen.
 * @returns Whether it is fullscreen now.
 */
function useFullscreen(ref: RefObject<HTMLElement | null>): boolean {
	const [full, setFull] = useState(false);
	useEffect(() => {
		const sync = () => setFull(document.fullscreenElement !== null && document.fullscreenElement === ref.current);
		document.addEventListener("fullscreenchange", sync);
		return () => document.removeEventListener("fullscreenchange", sync);
	}, [ref]);
	return full;
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
	/** Whether the player is fullscreen, or null to leave out the Full button where the browser cannot go fullscreen. */
	full: boolean | null;
	/** Enters or leaves fullscreen. */
	onFull: () => void;
	/** Where the back link goes and what it says, or null for no back link. Only the compact layout, which hides the title, has one. */
	back: { to: string; label: string } | null;
}

/**
 * LOG and HIDE at the top left, and SOUND, AUTO, SKIP and FULL at the top right. Memoised, so the typewriter's ticks leave it alone.
 *
 * @param props Component props.
 * @returns The chrome.
 */
const PlayerChrome = memo(function PlayerChrome({ soundOn, auto, canSkip, onLog, onHide, onSound, onAuto, onSkip, full, onFull, back }: PlayerChromeProps) {
	return (
		<>
			<Box sx={{ ...CHROME_SX, left: "4%" }}>
				{back ? (
					<Button component={Link} to={back.to} sx={CHROME_BUTTON_SX} onClick={(event) => event.stopPropagation()}>
						&#8249; {back.label}
					</Button>
				) : null}
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
				{full !== null ? (
					<Button sx={CHROME_BUTTON_SX} aria-label={full ? "Leave fullscreen" : "Fill the screen"} onClick={stopClick(onFull)}>
						{full ? "EXIT" : "FULL"}
					</Button>
				) : null}
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
	/** The story's title, such as `0-1 Collapse`, for the phone's media controls. */
	title: string;
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
function StoryPlayer({ story, group, title, presence }: StoryPlayerProps) {
	const {
		run,
		log,
		typed,
		shown,
		caption,
		decision,
		reading,
		next,
		auto,
		hideUi,
		logOpen,
		muted,
		blocked,
		nickname,
		shakeKey,
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
	} = useStoryRun(story, group, title, presence);
	const stacked = useMediaQuery(STACKED_QUERY);
	const compact = useMediaQuery(COMPACT_QUERY);
	const player = useRef<HTMLDivElement>(null);
	const fullscreen = useFullscreen(player);

	const toggleFullscreen = useCallback(() => {
		if (document.fullscreenElement) {
			void document.exitFullscreen().catch(() => {});
		} else {
			void player.current?.requestFullscreen().catch(() => {});
		}
	}, []);

	const backLink = useMemo(() => (compact ? { to: storyGroupPath(group.id), label: group.name } : null), [compact, group]);
	const lineText =
		!hideUi && (shown || caption) ? (
			<>
				{shown?.name ? (
					<Typography variant="subtitle2" sx={{ color: "primary.main", fontFamily: "inherit" }}>
						{shown.name}
					</Typography>
				) : null}
				<Typography sx={{ fontFamily: "inherit" }} aria-live="polite">
					{shown ? typedRuns(shown, typed) : caption}
				</Typography>
			</>
		) : null;
	const choices = decision
		? decision.options.map((option, choice) => (
				<Button key={choice} sx={stacked ? PANEL_CHOICE_SX : CHOICE_SX} onClick={() => pick(option, decision.values[choice] ?? "")}>
					{fillNickname(option, nickname)}
				</Button>
			))
		: null;

	return (
		<Box ref={player} sx={PLAYER_SX} onClickCapture={interact} data-region="story-player">
			<StoryStage
				stage={run.stage}
				name={shown?.name ?? null}
				line={shown}
				typed={typed}
				nickname={nickname}
				presence={presence}
				hideText={hideUi || stacked || compact}
				shakeKey={shakeKey}
				onClick={onStage}
			>
				{!hideUi ? (
					<PlayerChrome
						soundOn={!muted && !blocked}
						auto={auto}
						canSkip={reading}
						onLog={openLog}
						onHide={hide}
						onSound={toggleSound}
						onAuto={toggleAuto}
						onSkip={skip}
						full={document.fullscreenEnabled && !stacked ? fullscreen : null}
						onFull={toggleFullscreen}
						back={backLink}
					/>
				) : null}
				{choices && !stacked ? (
					<Box sx={CHOICES_SX} onClick={(event) => event.stopPropagation()}>
						{choices}
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
							<Button component={Link} to={storyGroupPath(group.id)} variant="outlined">
								Back to {group.name}
							</Button>
						</Box>
					</Box>
				) : null}
				{compact && lineText ? <Box sx={COMPACT_TEXT_SX}>{lineText}</Box> : null}
			</StoryStage>
			{stacked ? (
				<Box sx={PANEL_SX} onClick={onStage}>
					{choices ? (
						<Box sx={{ display: "grid", gap: 1.25 }} onClick={(event) => event.stopPropagation()}>
							{choices}
						</Box>
					) : (
						lineText
					)}
				</Box>
			) : null}
			{logOpen ? <StoryLog entries={log} nickname={nickname} onNickname={setNickname} onClose={closeLog} /> : null}
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
	const title = entry ? storyTitle(entry) : storyId;
	useEffect(() => {
		if (data && entry) {
			document.title = `${title} - ${data.group.name} - Arknights Archive`;
		}
	}, [data, entry, title]);

	return (
		<Box component="main" sx={PAGE_SX}>
			<ScrollToTop />
			{error ? (
				<LoadError what="this story" onRetry={() => setAttempt((value) => value + 1)} titleComponent="h1" />
			) : data ? (
				<>
					<Box sx={TITLE_SX}>
						<Button component={Link} to={storyGroupPath(data.group.id)} size="small">
							{data.group.name}
						</Button>
						<Typography component="h1" variant="body1">
							{title}
						</Typography>
						<Typography variant="body2" color="text.secondary">
							{entry?.tag}
						</Typography>
					</Box>
					<StoryPlayer key={data.story.id} story={data.story} group={data.group} title={title} presence={data.presence} />
				</>
			) : (
				<Typography color="text.secondary" role="status">
					Loading...
				</Typography>
			)}
		</Box>
	);
}
