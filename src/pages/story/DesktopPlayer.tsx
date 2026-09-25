import { memo, useCallback, useEffect, useRef, useState } from "react";

import { Box, Button, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import SettingsIcon from "@mui/icons-material/Settings";
import { Link } from "react-router-dom";

import { StoryCorner, StoryEndCard, StoryLogPanel, StorySettingsCard, useFullscreen } from "archive-kit";

import type { StoryPresence } from "../../lib/story.js";
import { storyGroupPath } from "../../lib/routes.js";
import type { StoryGroup } from "../../types/story.js";
import { fillNickname } from "./engine.js";
import StorySettings from "./StorySettings.js";
import StoryStage from "./StoryStage.js";
import type { StoryRun } from "./useStoryRun.js";

/** The stage's box: as wide as the page allows while still fitting the viewport's height. */
const STAGE_BOX_SX = { width: "min(100%, calc((100dvh - 120px) * 16 / 9))" } as const satisfies SxProps<Theme>;

/** The group link and title over the stage. */
const TITLE_SX: SxProps<Theme> = { ...STAGE_BOX_SX, display: "flex", alignItems: "baseline", gap: 1.5, mb: 1, color: "#cfd3da" };

/** The top-right and top-left chrome. */
const CHROME_SX: SxProps<Theme> = { position: "absolute", top: "4%", display: "flex", alignItems: "center", gap: "2cqh", zIndex: 4, fontSize: "max(11px, 2.2cqh)" };

/** One chrome button: plain text on the stage. */
const CHROME_BUTTON_SX: SxProps<Theme> = { color: "#fff", minWidth: 0, p: "0.4cqh 0.8cqh", fontSize: "inherit", fontFamily: "inherit", letterSpacing: "0.04em" };

/** The chrome at the end of a story, which always fades to black: a white hover tint, since the theme's faint blue one all but vanishes there. */
const CHROME_END_SX = { "& .MuiButton-root:hover, & .MuiButton-root.Mui-focusVisible": { bgcolor: "rgba(255, 255, 255, 0.16)" } } as const;

/**
 * The icon controls, fullscreen and Settings: chrome buttons like LOG and HIDE, so they highlight the same way, holding the icons the phone
 * reader uses. Each icon is outlined, so it reads on a white scene, and grows a little on hover or focus. Only the icon scales, so the row
 * never shifts.
 */
const ICON_BUTTON_SX: SxProps<Theme> = {
	...CHROME_BUTTON_SX,
	"& .MuiSvgIcon-root": {
		// The text buttons' line height, so the highlight is the same size as theirs.
		fontSize: "1.75em",
		filter: "drop-shadow(1px 0 0 rgba(0,0,0,0.85)) drop-shadow(-1px 0 0 rgba(0,0,0,0.85)) drop-shadow(0 1px 0 rgba(0,0,0,0.85)) drop-shadow(0 -1px 0 rgba(0,0,0,0.85))",
		transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
	},
	"&:hover .MuiSvgIcon-root, &.Mui-focusVisible .MuiSvgIcon-root": { transform: "scale(1.15)" }
};

/** The Settings card, dropped under the chrome's left end. It scrolls on a short stage rather than running off it. */
const SETTINGS_CARD_SX: SxProps<Theme> = { top: "10cqh", left: "4%", maxHeight: "86cqh" };

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
	/** Whether the story has ended, when the stage is black and the hover tint turns white. */
	ended: boolean;
	/** Whether the Settings card is open. */
	settingsOpen: boolean;
	/** Opens the Settings card. */
	onSettings: () => void;
}

/**
 * The fullscreen and Settings icons, LOG and HIDE at the top left, and SOUND, AUTO and SKIP at the top right. Memoised, so the typewriter's
 * ticks leave it alone.
 *
 * @param props Component props.
 * @returns The chrome.
 */
const PlayerChrome = memo(function PlayerChrome({ soundOn, auto, canSkip, onLog, onHide, onSound, onAuto, onSkip, full, onFull, ended, settingsOpen, onSettings }: PlayerChromeProps) {
	return (
		<>
			<Box sx={{ ...CHROME_SX, ...(ended ? CHROME_END_SX : null), left: "4%" }}>
				{full !== null ? (
					<Button sx={ICON_BUTTON_SX} aria-label={full ? "Leave fullscreen" : "Fill the screen"} onClick={stopClick(onFull)}>
						{full ? <FullscreenExitIcon /> : <FullscreenIcon />}
					</Button>
				) : null}
				<Button sx={ICON_BUTTON_SX} aria-label="Settings" aria-expanded={settingsOpen} onClick={stopClick(onSettings)}>
					<SettingsIcon />
				</Button>
				<Button sx={CHROME_BUTTON_SX} onClick={stopClick(onLog)}>
					LOG
				</Button>
				<Button sx={CHROME_BUTTON_SX} aria-label="Hide the text" onClick={stopClick(onHide)}>
					HIDE
				</Button>
			</Box>
			<Box sx={{ ...CHROME_SX, ...(ended ? CHROME_END_SX : null), right: "4%" }}>
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
 * The desktop player: the title row over the stage, the game's own text box on the stage, and the fullscreen and Settings icons, LOG, HIDE,
 * SOUND, AUTO and SKIP along its top, with choices, the end card and the Settings card over it and the Log's drawer to its right.
 *
 * @param props Component props.
 * @returns The player.
 */
export default function DesktopPlayer({ reader, group, title, tag, presence }: DesktopPlayerProps) {
	const {
		run,
		lines,
		corner,
		typed,
		shown,
		said,
		decision,
		reading,
		ending,
		auto,
		hideUi,
		logOpen,
		soundOn,
		nickname,
		settings,
		shakeKey,
		pick,
		restart,
		skip,
		onStage,
		openLog,
		closeLog,
		hide,
		toggleAuto,
		toggleSound,
		setNickname,
		interact,
		setCovered
	} = reader;
	const player = useRef<HTMLDivElement>(null);
	const fullscreen = useFullscreen(player);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const openSettings = useCallback(() => setSettingsOpen(true), []);
	const closeSettings = useCallback(() => setSettingsOpen(false), []);
	// The card covers the story while it is open, so the run's keys and AUTO wait. Closing it, or leaving this view with it open, ends that.
	useEffect(() => {
		if (!settingsOpen) {
			return;
		}
		setCovered(true);
		return () => setCovered(false);
	}, [settingsOpen, setCovered]);

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
				<StoryStage
					stage={run.stage}
					name={(shown ?? said)?.name ?? null}
					line={shown ?? said}
					typed={shown ? typed : Number.MAX_SAFE_INTEGER}
					nickname={nickname}
					presence={presence}
					hideText={hideUi}
					shakeKey={shakeKey}
					onClick={onStage}
				>
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
							ended={run.stop.kind === "end"}
							settingsOpen={settingsOpen}
							onSettings={openSettings}
						/>
					) : null}
					{!hideUi ? <StoryCorner progress={corner.progress} track={corner.track} /> : null}
					<StorySettingsCard open={settingsOpen && !hideUi} onClose={closeSettings} sx={SETTINGS_CARD_SX}>
						<StorySettings settings={settings} nickname={nickname} onNickname={setNickname} />
					</StorySettingsCard>
					{choices ? (
						<Box sx={CHOICES_SX} onClick={(event) => event.stopPropagation()}>
							{choices}
						</Box>
					) : null}
					{run.stop.kind === "end" ? <StoryEndCard variant="stage" title={title} next={ending.next} back={ending.back} onRestart={restart} /> : null}
				</StoryStage>
				{logOpen ? <StoryLogPanel title="Log" lines={lines} onClose={closeLog} container={player} /> : null}
			</Box>
		</>
	);
}
