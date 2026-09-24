import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";

import { useEffect, useState } from "react";

import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { useParams } from "react-router-dom";

import { LoadError, ScrollToTop } from "archive-kit";

import { loadStory, loadStoryGroup, loadStoryPresence, storyTitle } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import { fillBelowNavbar } from "../../lib/layout.js";
import type { StoryFile, StoryGroup } from "../../types/story.js";
import DesktopPlayer from "./DesktopPlayer.js";
import { COMPACT, COMPACT_QUERY, STACKED, STACKED_QUERY } from "./layouts.js";
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

/** Props for StoryPlayer. */
interface StoryPlayerProps {
	/** The story being played. */
	story: StoryFile;
	/** The group it belongs to, for its title and the next story. */
	group: StoryGroup;
	/** The story's title, such as `0-1 Collapse`. */
	title: string;
	/** The story's tag, such as `Before Operation`, or undefined. */
	tag: string | undefined;
	/** Which story assets are published. */
	presence: StoryPresence;
}

/**
 * Plays one story. Keyed on the story id by its parent, so opening another story always starts from an empty stage.
 *
 * @param props Component props.
 * @returns The player.
 */
function StoryPlayer({ story, group, title, tag, presence }: StoryPlayerProps) {
	const reader = useStoryRun(story, group, title, presence);
	return <DesktopPlayer reader={reader} group={group} title={title} tag={tag} presence={presence} />;
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
				<StoryPlayer key={data.story.id} story={data.story} group={data.group} title={title} tag={entry?.tag} presence={data.presence} />
			) : (
				<Typography color="text.secondary" role="status">
					Loading...
				</Typography>
			)}
		</Box>
	);
}
