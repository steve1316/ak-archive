import { memo, useRef } from "react";

import { Box, Button, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link } from "react-router-dom";

import { useFullscreen } from "archive-kit";

import { storyTitle } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import { storyGroupPath, storyPath } from "../../lib/routes.js";
import type { StoryGroup } from "../../types/story.js";
import { fillNickname } from "./engine.js";
import StoryLog from "./StoryLog.js";
import StoryStage from "./StoryStage.js";
import type { StoryRun } from "./useStoryRun.js";

/** The stage's box: as wide as the page allows while still fitting the viewport's height. */
const STAGE_BOX_SX = { width: "min(100%, calc((100dvh - 120px) * 16 / 9))" } as const satisfies SxProps<Theme>;

/** The group link and title over the stage. */
const TITLE_SX: SxProps<Theme> = { ...STAGE_BOX_SX, display: "flex", alignItems: "baseline", gap: 1.5, mb: 1, color: "#cfd3da" };

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

/**
 * The player column: the stage's width. Fullscreen, it is the whole screen with the stage centred at the largest 16:9 that fits. The Log's
 * drawer is placed against it.
 */
const PLAYER_SX: SxProps<Theme> = {
	...STAGE_BOX_SX,
	position: "relative",
	"&:fullscreen": { width: "100%", height: "100%", display: "grid", placeItems: "center", background: "#000" },
	"&:fullscreen [data-region='story-stage']": { width: "min(100vw, calc(100vh * 16 / 9))" }
};

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
	/** Whether the player is fullscreen, or null to leave out the Full button where the browser cannot go fullscreen. */
	full: boolean | null;
	/** Enters or leaves fullscreen. */
	onFull: () => void;
}

/**
 * LOG and HIDE at the top left, and SOUND, AUTO, SKIP and FULL at the top right. Memoised, so the typewriter's ticks leave it alone.
 *
 * @param props Component props.
 * @returns The chrome.
 */
const PlayerChrome = memo(function PlayerChrome({ soundOn, auto, canSkip, onLog, onHide, onSound, onAuto, onSkip, full, onFull }: PlayerChromeProps) {
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
				{full !== null ? (
					<Button sx={CHROME_BUTTON_SX} aria-label={full ? "Leave fullscreen" : "Fill the screen"} onClick={stopClick(onFull)}>
						{full ? "EXIT" : "FULL"}
					</Button>
				) : null}
			</Box>
		</>
	);
});

/** Props for DesktopPlayer. */
interface DesktopPlayerProps {
	/** The story's reading state and controls. */
	reader: StoryRun;
	/** The group the story belongs to, for the title row and the end card. */
	group: StoryGroup;
	/** The story's title, such as `0-1 Collapse`. */
	title: string;
	/** The story's tag, such as `Before Operation`, or undefined. */
	tag: string | undefined;
	/** Which story assets are published. */
	presence: StoryPresence;
}

/**
 * The desktop player: the title row over the stage, the game's own text box on the stage, and LOG, HIDE, SOUND, AUTO, SKIP and FULL along its
 * top, with choices and the end card over it and the Log's drawer to its right.
 *
 * @param props Component props.
 * @returns The player.
 */
export default function DesktopPlayer({ reader, group, title, tag, presence }: DesktopPlayerProps) {
	const {
		run,
		log,
		typed,
		shown,
		decision,
		reading,
		next,
		auto,
		hideUi,
		logOpen,
		soundOn,
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
	} = reader;
	const player = useRef<HTMLDivElement>(null);
	const fullscreen = useFullscreen(player);

	const choices = decision
		? decision.options.map((option, choice) => (
				<Button key={choice} sx={CHOICE_SX} onClick={() => pick(option, decision.values[choice] ?? "")}>
					{fillNickname(option, nickname)}
				</Button>
			))
		: null;

	return (
		<>
			<Box sx={TITLE_SX}>
				<Button component={Link} to={storyGroupPath(group.id)} size="small">
					{group.name}
				</Button>
				<Typography component="h1" variant="body1">
					{title}
				</Typography>
				<Typography variant="body2" color="text.secondary">
					{tag}
				</Typography>
			</Box>
			<Box ref={player} sx={PLAYER_SX} onClickCapture={interact} data-region="story-player">
				<StoryStage stage={run.stage} name={shown?.name ?? null} line={shown} typed={typed} nickname={nickname} presence={presence} hideText={hideUi} shakeKey={shakeKey} onClick={onStage}>
					{!hideUi ? (
						<PlayerChrome
							soundOn={soundOn}
							auto={auto}
							canSkip={reading}
							onLog={openLog}
							onHide={hide}
							onSound={toggleSound}
							onAuto={toggleAuto}
							onSkip={skip}
							full={fullscreen.supported ? fullscreen.active : null}
							onFull={fullscreen.toggle}
						/>
					) : null}
					{choices ? (
						<Box sx={CHOICES_SX} onClick={(event) => event.stopPropagation()}>
							{choices}
						</Box>
					) : null}
					{run.stop.kind === "end" ? (
						<Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.6)", zIndex: 6 }} onClick={(event) => event.stopPropagation()}>
							<Box sx={{ textAlign: "center", display: "grid", gap: 2 }}>
								<Typography sx={{ fontSize: "3cqh" }}>End of story</Typography>
								{next ? (
									<Button component={Link} to={storyPath(group.id, next.id)} variant="contained">
										Next: {storyTitle(next)}
									</Button>
								) : null}
								<Button component={Link} to={storyGroupPath(group.id)} variant="outlined">
									Back to {group.name}
								</Button>
							</Box>
						</Box>
					) : null}
				</StoryStage>
				{logOpen ? <StoryLog entries={log} nickname={nickname} onNickname={setNickname} onClose={closeLog} /> : null}
			</Box>
		</>
	);
}
