import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/700.css";

import { useEffect, useState } from "react";

import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { LoadError, MOBILE_LANDSCAPE_QUERY, ScrollToTop, fillBelowNavbar, useIsMobile } from "archive-kit";

import { storyAt, storyPath } from "../../lib/routes.js";
import { groupNameRepeats, loadStory, loadStoryGroup, loadStoryPresence, storyTitle } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import type { StoryFile, StoryGroup, StoryGroupEntry } from "../../types/story.js";
import DesktopPlayer from "./DesktopPlayer.js";
import MobilePlayer from "./MobilePlayer.js";
import { useStoryRun } from "./useStoryRun.js";

/**
 * The page on a desktop: a black band with the stage centred at the largest 16:9 that fits under the bar. It clips, so a camera shake
 * moving the stage past the window's edge never grows the page and flashes scroll bars.
 */
const PAGE_SX: SxProps<Theme> = (theme) => ({
	background: "#000",
	overflow: "clip",
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
	// Clipped for the same camera shake as the desktop page.
	overflow: "clip",
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
 * The story player route: loads the group and the asset presence, then the story the address names, then plays it. An address in an older
 * form is swapped for the story's own as soon as the group is known, before the story itself loads.
 *
 * @returns The page.
 */
export default function Story() {
	const { group: groupId = "", story: param = "" } = useParams();
	const { pathname, search } = useLocation();
	const navigate = useNavigate();
	const [data, setData] = useState<{ story: StoryFile; entry: StoryGroupEntry; group: StoryGroup; presence: StoryPresence } | null>(null);
	const [error, setError] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const mobile = useIsMobile();

	useEffect(() => {
		let active = true;
		setData(null);
		setError(false);
		Promise.all([loadStoryGroup(groupId), loadStoryPresence()])
			.then(async ([group, presence]) => {
				const entry = storyAt(group, param);
				if (!entry) {
					throw new Error(`No story ${param} in ${groupId}`);
				}
				// An older link, by full id, by the id without its group's, or by the file-based name such as `10-01_beg`.
				// The group is cached, so the page this remounts into loads at once.
				const canonical = storyPath(group, entry.id);
				if (canonical !== pathname) {
					if (active) {
						navigate(`${canonical}${search}`, { replace: true });
					}
					return null;
				}
				return { story: await loadStory(entry.id), entry, group, presence };
			})
			.then(
				(loaded) => {
					if (active && loaded) {
						setData(loaded);
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
	}, [groupId, param, pathname, search, navigate, attempt]);

	const title = data ? storyTitle(data.entry) : param;
	useEffect(() => {
		if (data) {
			const group = groupNameRepeats(data.group) ? "" : ` - ${data.group.name}`;
			document.title = `${title}${group} - Arknights Archive`;
		}
	}, [data, title]);

	return (
		<Box component="main" sx={mobile && data ? MOBILE_PAGE_SX : PAGE_SX}>
			<ScrollToTop />
			{error ? (
				<LoadError what="this story" onRetry={() => setAttempt((value) => value + 1)} titleComponent="h1" />
			) : data ? (
				<StoryPlayer key={data.story.id} story={data.story} group={data.group} title={title} tag={data.entry.tag} presence={data.presence} mobile={mobile} />
			) : (
				<Typography color="text.secondary" role="status">
					Loading...
				</Typography>
			)}
		</Box>
	);
}
