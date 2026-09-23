import { memo, useEffect, useLayoutEffect, useRef } from "react";

import { Box, IconButton, TextField, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

import { fillNickname } from "./engine.js";

/** The Log's background, shared by the drawer and its pinned header. */
const LOG_BG = "rgba(8,10,14,0.95)";

/** One entry in the Log: a line, or a choice the reader picked. */
export type LogEntry = { kind: "line"; name: string | null; text: string } | { kind: "pick"; text: string };

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
 * The backlog: a drawer over the right of the stage listing every line and choice so far, with the reader's name field pinned at the top. It
 * opens scrolled to the newest line, and a click anywhere outside it closes it.
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

	// A click outside the drawer closes it. A click on the player does only that, so closing the Log never also advances the story or presses a
	// button under it.
	useEffect(() => {
		const onClick = (event: MouseEvent) => {
			if (!(event.target instanceof Element) || drawer.current?.contains(event.target)) {
				return;
			}
			if (event.target.closest('[data-region="story-player"]')) {
				event.stopPropagation();
				event.preventDefault();
			}
			onClose();
		};
		window.addEventListener("click", onClick, true);
		return () => window.removeEventListener("click", onClick, true);
	}, [onClose]);

	return (
		<Box
			ref={drawer}
			onClick={(event) => event.stopPropagation()}
			sx={{
				position: "absolute",
				top: 0,
				bottom: 0,
				right: 0,
				width: { xs: "100%", md: "40%" },
				background: LOG_BG,
				borderLeft: "1px solid #2a303c",
				px: 2,
				pb: 2,
				overflowY: "auto",
				cursor: "default",
				zIndex: 5
			}}
		>
			<Box sx={{ position: "sticky", top: 0, zIndex: 1, background: LOG_BG, pt: 2, pb: 2, mb: 0.5 }}>
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
				entry.kind === "pick" ? (
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
