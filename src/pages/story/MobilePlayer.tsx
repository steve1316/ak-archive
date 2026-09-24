import { useMemo } from "react";

import type { SxProps, Theme } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import HistoryIcon from "@mui/icons-material/History";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";

import { MobileStoryReader, StoryEndCard, StorySkipIcon } from "archive-kit";
import type { StoryChoice, StoryControl, StoryCurrentLine } from "archive-kit";

import type { StoryPresence } from "../../lib/story.js";
import { storyGroupPath } from "../../lib/routes.js";
import type { StoryGroup } from "../../types/story.js";
import { fillNickname } from "./engine.js";
import StorySettings from "./StorySettings.js";
import StoryStage, { typedRuns } from "./StoryStage.js";
import type { StoryRun } from "./useStoryRun.js";

/** The reader in the story's own font. */
const READER_SX: SxProps<Theme> = { fontFamily: '"Noto Sans", sans-serif' };

/** Props for MobilePlayer. */
interface MobilePlayerProps {
	/** The story's reading state and controls. */
	reader: StoryRun;
	/** The group the story belongs to, for the way back. */
	group: StoryGroup;
	/** The story's title, such as `0-1 Collapse`, for the end card. */
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
	const { run, lines, corner, typed, shown, caption, decision, length, reading, canBack, ending, auto, logOpen, soundOn, nickname, settings, shakeKey } = reader;
	const { back, restart, pick, skip, onStage, openLog, closeLog, toggleAuto, toggleSound, setNickname, interact, setCovered } = reader;

	// Built once per change rather than per render, since the reader re-renders on every typed character.
	const controls = useMemo<StoryControl[]>(
		() => [
			{ key: "stories", label: "Stories", ariaLabel: `Back to ${group.name}`, icon: <ArrowBackIcon />, to: storyGroupPath(group.id) },
			{ key: "back", label: "Back", ariaLabel: "Previous line", icon: <ChevronLeftIcon />, onClick: back, disabled: !canBack, group: true },
			{ key: "log", label: "Log", icon: <HistoryIcon />, onClick: openLog, group: true },
			{ key: "auto", label: "Auto", icon: auto ? <AutorenewIcon /> : <PlayArrowIcon />, onClick: toggleAuto, active: auto, spin: true },
			{ key: "sound", label: "Sound", ariaLabel: soundOn ? "Mute" : "Unmute", icon: soundOn ? <VolumeUpIcon /> : <VolumeOffIcon />, onClick: toggleSound },
			{ key: "skip", label: "Skip", ariaLabel: "Skip to the next choice", icon: <StorySkipIcon />, onClick: skip, disabled: !reading }
		],
		[group, back, canBack, openLog, auto, toggleAuto, soundOn, toggleSound, skip, reading]
	);

	const current: StoryCurrentLine | null = shown ? { speaker: shown.name, text: typedRuns(shown, typed), typing: typed < length } : caption ? { speaker: null, text: caption } : null;

	const choices = useMemo<StoryChoice[] | null>(
		() => (decision ? decision.options.map((option, index) => ({ key: String(index), label: fillNickname(option, nickname), onPick: () => pick(option, decision.values[index] ?? "") })) : null),
		[decision, nickname, pick]
	);

	const end = run.stop.kind === "end" ? <StoryEndCard variant="inline" title={title} next={ending.next} back={ending.back} onRestart={restart} /> : null;

	return (
		<MobileStoryReader
			scene={<StoryStage stage={run.stage} nickname={nickname} presence={presence} hideText shakeKey={shakeKey} />}
			corner={corner}
			controls={controls}
			lines={lines}
			current={current}
			choices={choices}
			end={end}
			onAdvance={onStage}
			onInteract={interact}
			logOpen={logOpen}
			onCloseLog={closeLog}
			settings={<StorySettings settings={settings} nickname={nickname} onNickname={setNickname} sceneSize />}
			onPanelChange={setCovered}
			sceneSize={settings.sceneSize}
			sx={READER_SX}
		/>
	);
}
