import { memo, useRef } from "react";

import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { clampIndex } from "./DiscWheel.js";
import type { DiscItem } from "./DiscWheel.js";

/** How many covers either side of the selected one are drawn, so a neighbour slides in rather than popping up. */
const VISIBLE = 2;

/** Horizontal travel, in pixels, that counts as a swipe rather than a tap. Matches the home carousel. */
const SWIPE_THRESHOLD = 40;

/** How far apart neighbouring covers sit, as a percentage of the strip's width. The neighbours' inner edges peek in from the sides. */
const SPACING = 62;

/** The strip. A size container, so a cover can be sized to whichever of its width or height runs out first. */
const STRIP_SX: SxProps<Theme> = { position: "relative", flex: 1, minHeight: 0, containerType: "size", touchAction: "pan-y", userSelect: "none", overflow: "hidden" };

/** One cover: 5:4 like the game's, as wide as the strip allows while its height stays inside the strip. */
const COVER_SX: SxProps<Theme> = {
	position: "absolute",
	top: "50%",
	width: "min(72cqw, 85cqh * 1.25)",
	aspectRatio: "1.25",
	backgroundRepeat: "no-repeat",
	backgroundPosition: "center",
	cursor: "pointer",
	transition: "left 0.35s cubic-bezier(.2,.8,.2,1), transform 0.35s, opacity 0.35s"
};

/** The name on a cover that has no art. */
const PLAIN_SX: SxProps<Theme> = { position: "absolute", inset: 0, display: "grid", placeContent: "center", gap: 0.5, p: 2, textAlign: "center", fontSize: 18 };

/** Props for SwipeStrip. */
interface SwipeStripProps {
	/** The covers, in order. */
	items: DiscItem[];
	/** The selected cover's index. */
	index: number;
	/** Called with the index to select. */
	onSelect: (index: number) => void;
	/** Called when the selected cover is tapped. */
	onOpen: () => void;
}

/**
 * The phone's stand-in for the disc: one big cover with its neighbours peeking in from the sides. A sideways swipe moves one cover, tapping
 * a neighbour selects it, and tapping the selected cover opens its stories.
 *
 * @param props Component props.
 * @returns The strip.
 */
function SwipeStrip({ items, index, onSelect, onOpen }: SwipeStripProps) {
	const start = useRef<{ x: number; y: number } | null>(null);
	// Set when a swipe ends, so the click the browser fires after it does not also open or select the cover under the finger.
	const swiped = useRef(false);

	return (
		<Box
			sx={STRIP_SX}
			onPointerDown={(event) => {
				start.current = { x: event.clientX, y: event.clientY };
				swiped.current = false;
			}}
			onPointerUp={(event) => {
				const origin = start.current;
				start.current = null;
				if (!origin) {
					return;
				}
				const dx = event.clientX - origin.x;
				// Without the vertical check a drift sideways during a tap also turns the strip.
				if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(event.clientY - origin.y)) {
					swiped.current = true;
					onSelect(clampIndex(index + (dx < 0 ? 1 : -1), items.length));
				}
			}}
			onPointerCancel={() => (start.current = null)}
		>
			{items.map((item, position) => {
				const offset = position - index;
				if (Math.abs(offset) > VISIBLE) {
					return null;
				}
				const selected = offset === 0;
				return (
					<Box
						key={item.id}
						role="button"
						aria-label={item.title}
						aria-current={selected ? "true" : undefined}
						onClick={() => {
							if (swiped.current) {
								swiped.current = false;
							} else if (selected) {
								onOpen();
							} else {
								onSelect(position);
							}
						}}
						sx={{
							...COVER_SX,
							backgroundColor: item.cover ? "transparent" : "#161a22",
							backgroundSize: item.cover ? "contain" : undefined,
							border: item.cover ? "none" : "2px solid rgba(255,255,255,0.85)",
							boxShadow: selected ? "0 0 0 3px #1e9bd7, 0 12px 32px rgba(0,0,0,0.8)" : "0 8px 24px rgba(0,0,0,0.6)"
						}}
						style={{
							left: `${50 + offset * SPACING}%`,
							transform: `translate(-50%, -50%) scale(${selected ? 1 : 0.72})`,
							opacity: selected ? 1 : 0.5,
							zIndex: VISIBLE + 1 - Math.abs(offset),
							backgroundImage: item.cover ? `url(${item.cover})` : undefined
						}}
					>
						{item.cover ? null : (
							<Box sx={PLAIN_SX}>
								<Box sx={{ fontSize: 11, letterSpacing: "0.14em", color: "#bbb" }}>{item.label}</Box>
								{item.title}
							</Box>
						)}
					</Box>
				);
			})}
		</Box>
	);
}

export default memo(SwipeStrip);
