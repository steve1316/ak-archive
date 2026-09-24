import { useMemo } from "react";

import { Box, Button, TextField, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import FastForwardIcon from "@mui/icons-material/FastForward";
import HistoryIcon from "@mui/icons-material/History";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import { Link } from "react-router-dom";

import { MobileStoryReader } from "archive-kit";
import type { StoryChoice, StoryControl, StoryCurrentLine, StoryLine } from "archive-kit";

import { storyTitle } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import { storyGroupPath, storyPath } from "../../lib/routes.js";
import type { StoryGroup } from "../../types/story.js";
import { fillNickname } from "./engine.js";
import StoryStage, { typedRuns } from "./StoryStage.js";
import type { StoryRun } from "./useStoryRun.js";

/** The reader in the story's own font. */
const READER_SX: SxProps<Theme> = { fontFamily: '"Noto Sans", sans-serif' };

/** The end of a story: a note and the links on, under the last line. */
const END_SX: SxProps<Theme> = { display: "grid", gap: 1, mt: 1 };

/** Props for MobilePlayer. */
interface MobilePlayerProps {
	/** The story's reading state and controls. */
	reader: StoryRun;
	/** The group the story belongs to, for the way back and the end card. */
	group: StoryGroup;
	/** The story's title, such as `0-1 Collapse`, for the scene's corner. */
	title: string;
	/** Which story assets are published. */
	presence: StoryPresence;
}

/**
 * The phone player: the kit's shared reader around this site's stage. The scene draws no text of its own here, since the reader's box and
 * transcript carry the lines at a size a phone can read.
 *
 * @param props Component props.
 * @returns The player.
 */
export default function MobilePlayer({ reader, group, title, presence }: MobilePlayerProps) {
	const { run, log, typed, shown, caption, decision, length, reading, canBack, next, auto, logOpen, soundOn, nickname, shakeKey } = reader;
	const { back, pick, skip, onStage, openLog, closeLog, toggleAuto, toggleSound, setNickname, interact } = reader;

	// Built once per change rather than per render, since the reader re-renders on every typed character.
	const controls = useMemo<StoryControl[]>(
		() => [
			{ key: "stories", label: "Stories", ariaLabel: `Back to ${group.name}`, icon: <ArrowBackIcon />, to: storyGroupPath(group.id) },
			{ key: "back", label: "Back", ariaLabel: "Previous line", icon: <ChevronLeftIcon />, onClick: back, disabled: !canBack, group: true },
			{ key: "log", label: "Log", icon: <HistoryIcon />, onClick: openLog, group: true },
			{ key: "auto", label: "Auto", icon: auto ? <AutorenewIcon /> : <PlayArrowIcon />, onClick: toggleAuto, active: auto, spin: true },
			{ key: "sound", label: "Sound", ariaLabel: soundOn ? "Mute" : "Unmute", icon: soundOn ? <VolumeUpIcon /> : <VolumeOffIcon />, onClick: toggleSound },
			{ key: "skip", label: "Skip", ariaLabel: "Skip to the next choice", icon: <FastForwardIcon />, onClick: skip, disabled: !reading }
		],
		[group, back, canBack, openLog, auto, toggleAuto, soundOn, toggleSound, skip, reading]
	);

	const lines = useMemo<StoryLine[]>(
		() =>
			log.map((entry) =>
				entry.kind === "pick" ? { speaker: null, text: fillNickname(entry.text, nickname), kind: "choice" } : { speaker: entry.name, text: fillNickname(entry.text, nickname) }
			),
		[log, nickname]
	);

	const current: StoryCurrentLine | null = shown ? { speaker: shown.name, text: typedRuns(shown, typed), typing: typed < length } : caption ? { speaker: null, text: caption } : null;

	const choices = useMemo<StoryChoice[] | null>(
		() => (decision ? decision.options.map((option, index) => ({ key: String(index), label: fillNickname(option, nickname), onPick: () => pick(option, decision.values[index] ?? "") })) : null),
		[decision, nickname, pick]
	);

	const end =
		run.stop.kind === "end" ? (
			<Box sx={END_SX}>
				<Typography sx={{ color: "text.secondary" }}>End of story</Typography>
				{next ? (
					<Button component={Link} to={storyPath(group.id, next.id)} variant="contained">
						Next: {storyTitle(next)}
					</Button>
				) : null}
				<Button component={Link} to={storyGroupPath(group.id)} variant="outlined">
					Back to {group.name}
				</Button>
			</Box>
		) : null;

	// Memoised, since the Log is memoised and a new header on every typed character would redraw every line in it.
	const logHeader = useMemo(
		() => <TextField label="Your name" size="small" value={nickname} onChange={(event) => setNickname(event.target.value)} sx={{ width: "100%" }} />,
		[nickname, setNickname]
	);

	return (
		<MobileStoryReader
			scene={<StoryStage stage={run.stage} nickname={nickname} presence={presence} hideText shakeKey={shakeKey} />}
			caption={title}
			controls={controls}
			lines={lines}
			current={current}
			choices={choices}
			end={end}
			onAdvance={onStage}
			onInteract={interact}
			logOpen={logOpen}
			onCloseLog={closeLog}
			logHeader={logHeader}
			sx={READER_SX}
		/>
	);
}
