import { memo } from "react";

import { TextField } from "@mui/material";

import { StorySettingsPanel } from "archive-kit";
import type { StorySettingsState } from "archive-kit";

/** Props for StorySettings. */
interface StorySettingsProps {
	/** The reader's settings, from `useStoryRun`. */
	settings: StorySettingsState;
	/** The reader's name, which fills `{@nickname}`. */
	nickname: string;
	/** Called when the reader changes their name. */
	onNickname: (value: string) => void;
	/** Whether to show the scene-size slider, which only the phone reader has. */
	sceneSize?: boolean;
}

/**
 * The story's Settings: the kit's sliders, with the Doctor's name under them. Memoised, so the typewriter's ticks leave it alone.
 *
 * @param props Component props.
 * @returns The panel.
 */
function StorySettings({ settings, nickname, onNickname, sceneSize = false }: StorySettingsProps) {
	return (
		<StorySettingsPanel value={settings} sceneSize={sceneSize}>
			<TextField label="Doctor's name" size="small" value={nickname} onChange={(event) => onNickname(event.target.value)} fullWidth />
		</StorySettingsPanel>
	);
}

export default memo(StorySettings);
