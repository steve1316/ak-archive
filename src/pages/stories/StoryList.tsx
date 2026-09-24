import { memo, useEffect, useRef, useState } from "react";

import { Box, Button, Typography } from "@mui/material";
import { Link } from "react-router-dom";

import { LoadError, useCloseOnOutsidePress } from "archive-kit";

import { storyPath } from "../../lib/routes.js";
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

/** Props for StoryList. */
interface StoryListProps {
	/** The group whose stories to list. */
	groupId: string;
	/** A heading shown above the list, such as `Episode 03`. */
	subtitle: string;
	/** Called to close the list. */
	onClose: () => void;
}

/**
 * A group's stories, each linking into the player, in a panel over the left of the picker. A click anywhere outside it closes it.
 *
 * @param props Component props.
 * @returns The panel.
 */
function StoryList({ groupId, subtitle, onClose }: StoryListProps) {
	const [group, setGroup] = useState<StoryGroup | null>(null);
	const [error, setError] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const panel = useRef<HTMLDivElement>(null);

	useCloseOnOutsidePress(panel, onClose, onPicker);

	useEffect(() => {
		let active = true;
		setGroup(null);
		setError(false);
		loadStoryGroup(groupId).then(
			(loaded) => active && setGroup(loaded),
			() => active && setError(true)
		);
		return () => {
			active = false;
		};
	}, [groupId, attempt]);

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
					{group?.name ?? ""}
				</Typography>
				<Button size="small" onClick={onClose}>
					Close
				</Button>
			</Box>
			<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
				{subtitle}
				{group ? ` - ${group.stories.length} stories` : ""}
			</Typography>
			{error ? <LoadError what="this story list" onRetry={() => setAttempt((value) => value + 1)} /> : null}
			{group?.stories.map((story) => (
				<Box
					key={story.id}
					component={Link}
					to={storyPath(group.id, story.id)}
					sx={{
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
					}}
				>
					<Typography sx={{ color: "primary.main", fontWeight: 700 }}>{story.code || "-"}</Typography>
					<Typography>{story.name}</Typography>
					<Typography variant="caption" sx={{ border: "1px solid #2a303c", borderRadius: 1, px: 0.75, color: "text.secondary" }}>
						{story.tag}
					</Typography>
				</Box>
			))}
		</Box>
	);
}

export default memo(StoryList);
