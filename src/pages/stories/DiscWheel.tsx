import { memo, useEffect, useRef, useState } from "react";

import { Box } from "@mui/material";

/** One cover on the disc. */
export interface DiscItem {
	/** The group id. */
	id: string;
	/** The group's name. */
	title: string;
	/** The small label above the name, such as `EPISODE 03`. */
	label: string;
	/** The cover URL, or null to show the name on a plain card. */
	cover: string | null;
}

/** Radians between neighbouring covers on the rim. */
const STEP = 0.42;

/** How many covers either side of the selected one stay visible. */
const VISIBLE = 3;

/** The game's covers are about 5:4 and carry their own title and white frame, so a real cover is drawn at that shape with nothing added. */
const COVER_ASPECT = 1.25;

/** How far a drag must travel, in pixels, to turn the disc one step. */
const DRAG_STEP_PX = 70;

/** Props for DiscWheel. */
interface DiscWheelProps {
	/** The covers, in order. */
	items: DiscItem[];
	/** The selected cover's index. */
	index: number;
	/** Called with the index to select. */
	onSelect: (index: number) => void;
	/** Called when the selected cover is clicked. */
	onOpen: () => void;
}

/**
 * A disc of covers: the covers ride the rim of a large circle whose hub is off the right edge, the selected one at 9 o'clock. Turning it
 * clockwise moves forwards. It turns with the mouse wheel (one step per notch), a vertical drag or a swipe.
 *
 * @param props Component props.
 * @returns The disc.
 */
function DiscWheel({ items, index, onSelect, onOpen }: DiscWheelProps) {
	const box = useRef<HTMLDivElement | null>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });
	const drag = useRef<{ y: number; at: number } | null>(null);
	const wheelLock = useRef(false);

	useEffect(() => {
		const element = box.current;
		if (!element) {
			return;
		}
		const observer = new ResizeObserver(([entry]) => {
			if (entry) {
				setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const element = box.current;
		if (!element) {
			return;
		}
		// Non-passive, so the page does not scroll while the disc turns.
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			if (wheelLock.current) {
				return;
			}
			wheelLock.current = true;
			window.setTimeout(() => (wheelLock.current = false), 220);
			onSelect(Math.max(0, Math.min(items.length - 1, index + (event.deltaY > 0 ? 1 : -1))));
		};
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	}, [index, items.length, onSelect]);

	const narrow = size.width < 600;
	const cover = narrow ? 110 : Math.max(120, Math.min(180, size.height * 0.28));
	const radius = narrow ? size.width * 0.62 : size.height * 0.62;
	const centreX = narrow ? size.width * 1.05 : size.width * 1.02;
	const centreY = narrow ? size.height * 0.62 : size.height * 0.5;

	return (
		<Box
			ref={box}
			sx={{ position: "absolute", inset: 0, touchAction: "none", cursor: "grab" }}
			onPointerDown={(event) => (drag.current = { y: event.clientY, at: index })}
			onPointerMove={(event) => {
				if (!drag.current) {
					return;
				}
				const steps = Math.round((drag.current.y - event.clientY) / DRAG_STEP_PX);
				const target = Math.max(0, Math.min(items.length - 1, drag.current.at + steps));
				if (target !== index) {
					onSelect(target);
				}
			}}
			onPointerUp={() => (drag.current = null)}
			onPointerLeave={() => (drag.current = null)}
		>
			<Box
				sx={{ position: "absolute", borderRadius: "50%", border: "1px dashed rgba(255,255,255,0.14)", pointerEvents: "none" }}
				style={{ width: radius * 2, height: radius * 2, left: centreX - radius, top: centreY - radius }}
			/>
			{items.map((item, position) => {
				const offset = position - index;
				if (Math.abs(offset) > VISIBLE) {
					return null;
				}
				const angle = Math.PI - offset * STEP;
				const selected = offset === 0;
				const width = item.cover ? cover * COVER_ASPECT : cover;
				return (
					<Box
						key={item.id}
						role="button"
						aria-label={item.title}
						aria-current={selected ? "true" : undefined}
						onClick={(event) => {
							event.stopPropagation();
							if (selected) {
								onOpen();
							} else {
								onSelect(position);
							}
						}}
						sx={{
							position: "absolute",
							border: item.cover ? "none" : "2px solid rgba(255,255,255,0.85)",
							boxShadow: selected ? "0 0 0 3px #1e9bd7, 0 12px 32px rgba(0,0,0,0.8)" : "0 8px 24px rgba(0,0,0,0.6)",
							backgroundColor: item.cover ? "transparent" : "#161a22",
							backgroundRepeat: "no-repeat",
							backgroundSize: item.cover ? "contain" : "cover",
							backgroundPosition: "center",
							cursor: "pointer",
							transition: "left 0.45s cubic-bezier(.2,.8,.2,1), top 0.45s cubic-bezier(.2,.8,.2,1), transform 0.45s, opacity 0.35s",
							overflow: "hidden"
						}}
						style={{
							width,
							height: cover,
							left: centreX + radius * Math.cos(angle) - width / 2,
							top: centreY + radius * Math.sin(angle) - cover / 2,
							transform: `scale(${selected ? 1.25 : 0.85 - Math.min(Math.abs(offset), VISIBLE) * 0.08})`,
							opacity: selected ? 1 : 0.8,
							zIndex: 10 - Math.abs(offset),
							backgroundImage: item.cover ? `url(${item.cover})` : undefined
						}}
					>
						{item.cover ? null : (
							<Box
								sx={{
									position: "absolute",
									left: 0,
									right: 0,
									bottom: 0,
									p: "18px 8px 6px",
									background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
									fontSize: 11,
									lineHeight: 1.25
								}}
							>
								<Box sx={{ fontSize: 10, letterSpacing: "0.14em", color: "#bbb" }}>{item.label}</Box>
								{item.title}
							</Box>
						)}
					</Box>
				);
			})}
		</Box>
	);
}

export default memo(DiscWheel);
