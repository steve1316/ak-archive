import { memo } from "react";

import { Box, IconButton, TextField, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

import { fillNickname } from "./engine.js";

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
 * The backlog: a drawer over the right of the stage listing every line and choice so far, with the reader's name field at the top.
 *
 * @param props Component props.
 * @returns The drawer.
 */
function StoryLog({ entries, nickname, onNickname, onClose }: StoryLogProps) {
	return (
		<Box
			onClick={(event) => event.stopPropagation()}
			sx={{
				position: "absolute",
				top: 0,
				bottom: 0,
				right: 0,
				width: { xs: "100%", md: "40%" },
				background: "rgba(8,10,14,0.95)",
				borderLeft: "1px solid #2a303c",
				p: 2,
				overflowY: "auto",
				cursor: "default",
				zIndex: 5
			}}
		>
			<Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
				<Typography component="h2" variant="h6" sx={{ flex: 1 }}>
					Log
				</Typography>
				<IconButton aria-label="Close the log" onClick={onClose} size="small">
					<CloseIcon />
				</IconButton>
			</Box>
			<TextField label="Your name" size="small" value={nickname} onChange={(event) => onNickname(event.target.value)} sx={{ mb: 2, width: "100%" }} />
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
