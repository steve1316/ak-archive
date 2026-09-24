import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";

import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { musicTitle } from "../../lib/story.js";
import type { StageState } from "./engine.js";
import { useMusicTitles } from "./useMusicTitles.js";

/** How long the note shows after a track starts, in milliseconds. */
const SHOW_MS = 3000;

/** How long the note stays once the pointer leaves it, in milliseconds. */
const LINGER_MS = 1500;

/**
 * The note in the stage's bottom right corner, with its own scrim for white scenes. It fades rather than blinking out, and while hidden it
 * takes no clicks. The title can be selected and copied. The words before it cannot, so a triple click copies the title alone.
 */
const NOTE_SX: SxProps<Theme> = {
	position: "absolute",
	right: "1.3%",
	bottom: "1.4%",
	zIndex: 4,
	px: 1,
	py: 0.25,
	borderRadius: "3px",
	bgcolor: "rgba(0, 0, 0, 0.45)",
	fontSize: "max(12px, 1.8cqh)",
	color: "rgba(255, 255, 255, 0.85)",
	cursor: "text",
	transition: "opacity 0.4s ease-out, visibility 0.4s",
	"& .note-label": { userSelect: "none" },
	"& .note-title": { userSelect: "text" }
};

/** The note while it shows. */
const SHOWN_SX: SxProps<Theme> = { ...NOTE_SX, opacity: 1, visibility: "visible" };

/** The note while it is hidden. */
const HIDDEN_SX: SxProps<Theme> = { ...NOTE_SX, opacity: 0, visibility: "hidden", pointerEvents: "none" };

/**
 * Keep a click on the note from reaching the stage, which would read on, so selecting the title leaves the story where it is.
 *
 * @param event The click.
 */
function stopClick(event: MouseEvent) {
	event.stopPropagation();
}

/** Props for NowPlaying. */
interface NowPlayingProps {
	/** The track the stage plays, or null for silence. A new value, even of the same track, is a new play. */
	music: StageState["music"];
}

/**
 * "Now Playing" and the track's title, for a few seconds each time a track starts, so a reader can find it later. The note stays while the
 * pointer is over it, so the title can be selected and copied. Memoised, so the typewriter's ticks leave it alone.
 *
 * @param props Component props.
 * @returns The note, or nothing while the scene is silent or the track has no title.
 */
function NowPlaying({ music }: NowPlayingProps) {
	const titles = useMusicTitles();
	const [shown, setShown] = useState(false);
	const hovered = useRef(false);
	const timer = useRef<number | undefined>(undefined);
	const title = music ? musicTitle(titles, music.loop) : null;

	useEffect(() => () => window.clearTimeout(timer.current), []);

	const hideAfter = useCallback((ms: number) => {
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			if (!hovered.current) {
				setShown(false);
			}
		}, ms);
	}, []);

	// Each play shows the note, including a track that starts again. The engine hands over a new value only when a track starts or stops.
	useEffect(() => {
		setShown(music !== null);
		if (music) {
			hideAfter(SHOW_MS);
		}
	}, [music, hideAfter]);

	const hold = useCallback(() => {
		hovered.current = true;
		window.clearTimeout(timer.current);
	}, []);

	const release = useCallback(() => {
		hovered.current = false;
		hideAfter(LINGER_MS);
	}, [hideAfter]);

	if (!title) {
		return null;
	}
	return (
		<Box sx={shown ? SHOWN_SX : HIDDEN_SX} onClick={stopClick} onPointerEnter={hold} onPointerLeave={release} aria-hidden={!shown}>
			<span className="note-label">Now Playing: </span>
			<span className="note-title">{title}</span>
		</Box>
	);
}

export default memo(NowPlaying);
