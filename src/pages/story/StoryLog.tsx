import { memo, useLayoutEffect, useRef } from "react";

import { Box, IconButton, TextField, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

import { useCloseOnOutsideClick } from "../../lib/dismiss.js";
import { musicTitle } from "../../lib/story.js";
import { fillNickname } from "./engine.js";
import { useMusicTitles } from "./useMusicTitles.js";

/** The pinned header's background, solid so the lines scrolling under it do not bleed through. */
const LOG_SOLID_BG = "#08090d";

/** A drawer over the right of the stage, which lets the stage show faintly through. */
const LOG_SX: SxProps<Theme> = {
	position: "absolute",
	top: 0,
	bottom: 0,
	right: 0,
	width: { xs: "100%", md: "40%" },
	background: "rgba(8,10,14,0.95)",
	borderLeft: "1px solid #2a303c",
	px: 2,
	pb: 2,
	overflowY: "auto",
	cursor: "default",
	// Above the chrome at 4, the end card at 3 and the choices at 6.
	zIndex: 7
};

/**
 * Whether a click outside the Log is spent on closing it alone: any click on the player, so closing the Log never also advances the story.
 *
 * @param target The clicked element.
 * @returns True inside the player.
 */
const onPlayer = (target: Element) => target.closest('[data-region="story-player"]') !== null;

/** One entry in the Log: a line, a choice the reader picked, or a track that started, by the reference the script played. */
export type LogEntry = { kind: "line"; name: string | null; text: string } | { kind: "pick"; text: string } | { kind: "music"; ref: string };

/**
 * Where a track starts in the Log: a quiet line naming it, or nothing for a track with no title.
 *
 * @param props Component props.
 * @param props.title The track's title, or null.
 * @returns The line.
 */
function MusicEntry({ title }: { title: string | null }) {
	return title ? <Typography sx={{ color: "text.secondary", fontStyle: "italic", fontSize: 13, mb: 1.25 }}>&#9834; Now Playing: {title}</Typography> : null;
}

/** Props for StoryLog. */
interface StoryLogProps {
	/** Everything read so far, oldest first. */
	entries: LogEntry[];
	/** The reader's name, which fills `{@nickname}`. */
	nickname: string;
	/** Called when the reader changes their name. */
	onNickname: (value: string) => void;
	/** Called to close the Log. */
	onClose: () => void;
}

/**
 * The desktop backlog: a drawer over the right of the stage listing every line and choice so far, with the reader's name field pinned at the
 * top. It sits beside the stage rather than in it, so a grey or shaking scene leaves it alone. It opens scrolled to the newest line, and a click
 * anywhere outside it closes it.
 *
 * @param props Component props.
 * @returns The drawer.
 */
function StoryLog({ entries, nickname, onNickname, onClose }: StoryLogProps) {
	const drawer = useRef<HTMLDivElement>(null);

	// Open at the newest line, before the first paint, so the drawer never shows the top first.
	useLayoutEffect(() => {
		if (drawer.current) {
			drawer.current.scrollTop = drawer.current.scrollHeight;
		}
	}, []);

	useCloseOnOutsideClick(drawer, onClose, onPlayer);
	const titles = useMusicTitles();

	return (
		<Box ref={drawer} onClick={(event) => event.stopPropagation()} sx={LOG_SX}>
			<Box sx={{ position: "sticky", top: 0, zIndex: 1, background: LOG_SOLID_BG, pt: 2, pb: 2, mb: 0.5 }}>
				<Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
					<Typography component="h2" variant="h6" sx={{ flex: 1 }}>
						Log
					</Typography>
					<IconButton aria-label="Close the log" onClick={onClose} size="small">
						<CloseIcon />
					</IconButton>
				</Box>
				<TextField label="Your name" size="small" value={nickname} onChange={(event) => onNickname(event.target.value)} sx={{ width: "100%" }} />
			</Box>
			{entries.map((entry, index) =>
				entry.kind === "music" ? (
					<MusicEntry key={index} title={musicTitle(titles, entry.ref)} />
				) : entry.kind === "pick" ? (
					<Typography key={index} sx={{ color: "#f0c36a", mb: 1.25 }}>
						{"> "}
						{fillNickname(entry.text, nickname)}
					</Typography>
				) : (
					<Box key={index} sx={{ mb: 1.25 }}>
						{entry.name ? (
							<Typography variant="caption" sx={{ color: "primary.main", display: "block" }}>
								{entry.name}
							</Typography>
						) : null}
						<Typography variant="body2">{fillNickname(entry.text, nickname)}</Typography>
					</Box>
				)
			)}
		</Box>
	);
}

export default memo(StoryLog);
