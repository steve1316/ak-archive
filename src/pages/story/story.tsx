import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";

import { useEffect, useState } from "react";

import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { useParams } from "react-router-dom";

import { LoadError, MOBILE_LANDSCAPE_QUERY, ScrollToTop, fillBelowNavbar, useIsMobile } from "archive-kit";

import { loadStory, loadStoryGroup, loadStoryPresence, storyTitle } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import type { StoryFile, StoryGroup } from "../../types/story.js";
import DesktopPlayer from "./DesktopPlayer.js";
import MobilePlayer from "./MobilePlayer.js";
import { useStoryRun } from "./useStoryRun.js";

/** The page on a desktop: a black band with the stage centred at the largest 16:9 that fits under the bar. */
const PAGE_SX: SxProps<Theme> = (theme) => ({
	background: "#000",
	...fillBelowNavbar(theme.mixins.toolbar, "minHeight"),
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	py: 1
});

/** The page on a phone: exactly the screen under the navbar, or the whole screen on its side, where the reader hides the navbar. The reader fills it. */
const MOBILE_PAGE_SX: SxProps<Theme> = (theme) => ({
	...fillBelowNavbar(theme.mixins.toolbar, "height"),
	display: "flex",
	flexDirection: "column",
	background: "#000",
	// Last, so it wins over the toolbar heights above.
	[`@media ${MOBILE_LANDSCAPE_QUERY}`]: { height: "100dvh" }
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
	/** Whether to draw the phone reader rather than the desktop player. */
	mobile: boolean;
}

/**
 * Plays one story, on the phone reader or the desktop player. Both read from one `useStoryRun`, so turning a phone or docking a tablet keeps the
 * reader's place. Keyed on the story id by its parent, so opening another story always starts from an empty stage.
 *
 * @param props Component props.
 * @returns The player.
 */
function StoryPlayer({ story, group, title, tag, presence, mobile }: StoryPlayerProps) {
	const reader = useStoryRun(story, group, title, presence);
	return mobile ? <MobilePlayer reader={reader} group={group} title={title} presence={presence} /> : <DesktopPlayer reader={reader} group={group} title={title} tag={tag} presence={presence} />;
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
	const mobile = useIsMobile();

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
		<Box component="main" sx={mobile && data ? MOBILE_PAGE_SX : PAGE_SX}>
			<ScrollToTop />
			{error ? (
				<LoadError what="this story" onRetry={() => setAttempt((value) => value + 1)} titleComponent="h1" />
			) : data ? (
				<StoryPlayer key={data.story.id} story={data.story} group={data.group} title={title} tag={entry?.tag} presence={data.presence} mobile={mobile} />
			) : (
				<Typography color="text.secondary" role="status">
					Loading...
				</Typography>
			)}
		</Box>
	);
}
