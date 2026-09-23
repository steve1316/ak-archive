import { memo, useEffect, useRef, useState } from "react";

import { Box, Button, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link } from "react-router-dom";

import { LoadError } from "archive-kit";

import { useCloseOnOutsideClick } from "../../lib/dismiss.js";
import { loadStoryGroup } from "../../lib/story.js";
import type { StoryGroup } from "../../types/story.js";

/**
 * Whether a click outside the list is spent on closing it alone: any click on the picker except its tab bar, so closing the list never also
 * turns the disc or opens another group, while a tab still switches in one click.
 *
 * @param target The clicked element.
 * @returns True on the picker, outside its tab bar.
 */
const onPicker = (target: Element) => target.closest('[data-region="story-picker"]') !== null && target.closest('[role="tablist"]') === null;

/** The row for one story, linking into the player. */
const STORY_ROW_SX: SxProps<Theme> = {
	display: "grid",
	gridTemplateColumns: "56px 1fr auto",
	gap: 1.25,
	alignItems: "center",
	py: 1.1,
	px: 1.25,
	borderBottom: "1px solid rgba(255,255,255,0.06)",
	color: "inherit",
	textDecoration: "none",
	"&:hover": { background: "rgba(255,255,255,0.05)" }
};

/** Props for StoryList. */
interface StoryListProps {
	/** The groups whose stories to list: one episode, event or side story, or every record set of one operator. */
	groupIds: string[];
	/** The panel's heading. Without one it is the first group's name. */
	title?: string;
	/** A line shown under the heading, such as `Episode 03`. */
	subtitle: string;
	/** Called to close the list. */
	onClose: () => void;
}

/**
 * The stories of one group, or of each of an operator's record sets under the set's name, each linking into the player, in a panel over the
 * left of the picker. A click anywhere outside it closes it.
 *
 * @param props Component props.
 * @returns The panel.
 */
function StoryList({ groupIds, title, subtitle, onClose }: StoryListProps) {
	const [groups, setGroups] = useState<StoryGroup[] | null>(null);
	const [error, setError] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const panel = useRef<HTMLDivElement>(null);

	useCloseOnOutsideClick(panel, onClose, onPicker);

	// Keyed on the ids' text, so a new array holding the same groups does not reload them.
	const groupKey = groupIds.join("|");
	useEffect(() => {
		let active = true;
		setGroups(null);
		setError(false);
		Promise.all(groupKey.split("|").map(loadStoryGroup)).then(
			(loaded) => active && setGroups(loaded),
			() => active && setError(true)
		);
		return () => {
			active = false;
		};
	}, [groupKey, attempt]);

	const heading = title ?? groups?.[0]?.name ?? "";
	// Each group gets its own heading when the panel's heading is not already its name, as for an operator's record sets.
	const headed = groups !== null && (groups.length > 1 || groups[0]?.name !== heading);
	const total = groups?.reduce((count, group) => count + group.stories.length, 0);

	return (
		<Box
			ref={panel}
			sx={{
				position: "absolute",
				top: 0,
				bottom: 64,
				left: 0,
				width: { xs: "100%", md: "46%" },
				background: "rgba(11,13,18,0.95)",
				borderRight: "1px solid #2a303c",
				p: 2.25,
				overflowY: "auto",
				zIndex: 5
			}}
		>
			<Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
				<Typography component="h2" variant="h6" sx={{ flex: 1 }}>
					{heading}
				</Typography>
				<Button size="small" onClick={onClose}>
					Close
				</Button>
			</Box>
			<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
				{subtitle}
				{total !== undefined ? ` - ${total} ${total === 1 ? "story" : "stories"}` : ""}
			</Typography>
			{error ? <LoadError what="this story list" onRetry={() => setAttempt((value) => value + 1)} /> : null}
			{groups?.map((group) => (
				<Box key={group.id} sx={{ mb: headed ? 2 : 0 }}>
					{headed ? (
						<Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600, mt: 1, mb: 0.5 }}>
							{group.name}
						</Typography>
					) : null}
					{group.stories.map((story) => (
						<Box key={story.id} component={Link} to={`/story/${group.id}/${story.id}`} sx={STORY_ROW_SX}>
							<Typography sx={{ color: "primary.main", fontWeight: 700 }}>{story.code || "-"}</Typography>
							<Typography>{story.name}</Typography>
							<Typography variant="caption" sx={{ border: "1px solid #2a303c", borderRadius: 1, px: 0.75, color: "text.secondary" }}>
								{story.tag}
							</Typography>
						</Box>
					))}
				</Box>
			))}
		</Box>
	);
}

export default memo(StoryList);
