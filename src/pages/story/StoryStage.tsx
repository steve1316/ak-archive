import { memo, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { Box, GlobalStyles } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { storyAssetUrl } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import type { Span } from "../../types/story.js";
import { fillNickname } from "./engine.js";
import type { LayerState, Slot, StageState } from "./engine.js";

/** Where a sprite stands, as % of the stage: height, bottom edge and centre. Tuned against the in-game capture `9.png`. */
const SPRITE_PLACEMENT = { l: { height: 150.5, bottom: -47, centre: 34.5 }, r: { height: 139, bottom: -44, centre: 65.5 }, one: { height: 144, bottom: -45.5, centre: 50 } };

/**
 * The text box, as % of the stage. Font sizes are % of the stage height. Tuned against `9.png`. The floor is not the game's: it is how low a
 * line may run before it rises instead.
 */
const TEXT_BOX = { nameRight: 26.1, nameTop: 86.9, nameFont: 3.6, lineLeft: 29.9, lineTop: 86.8, lineWidth: 55, lineFont: 2.65, lineHeight: 1.4, lineFloor: 98 };

/** One camera shake. */
const SHAKE_FRAMES = {
	"0%, 100%": { transform: "translate(0, 0)" },
	"20%": { transform: "translate(-0.6%, 0.4%)" },
	"40%": { transform: "translate(0.6%, -0.4%)" },
	"60%": { transform: "translate(-0.4%, -0.3%)" },
	"80%": { transform: "translate(0.4%, 0.3%)" }
};

/** The keyframes the stage uses for fades and shakes. The shake has two identical names, so switching between them restarts it without a remount. */
const KEYFRAMES = {
	"@keyframes storyFadeIn": { from: { opacity: 0 }, to: { opacity: 1 } },
	"@keyframes storyShake0": SHAKE_FRAMES,
	"@keyframes storyShake1": SHAKE_FRAMES
};

/** How a sprite that is not speaking is drawn. */
const DIMMED = "brightness(0.45)";

/** The game's layout size, which layer offsets are written in. */
const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1080;

/** The stage: 16:9, sized by the page, with text measured against its own height. */
const STAGE_SX: SxProps<Theme> = {
	position: "relative",
	width: "100%",
	aspectRatio: "16 / 9",
	overflow: "hidden",
	background: "#000",
	containerType: "size",
	fontFamily: '"Noto Sans", sans-serif',
	color: "#eef0f4",
	userSelect: "none",
	cursor: "pointer"
};

/**
 * The name and line, pinned by their bottom to the text box's floor. The block is at least as tall as the box from its top to the floor, so a
 * line that fits starts at the box's top. A longer one makes it taller, which lifts it and the name upward rather than running off the stage.
 * Sizes read `--text-size`, the reader's text size, which scales the line but not the name.
 */
const TEXT_BLOCK_SX: SxProps<Theme> = {
	position: "absolute",
	left: 0,
	right: 0,
	bottom: `${100 - TEXT_BOX.lineFloor}%`,
	minHeight: `${TEXT_BOX.lineFloor - TEXT_BOX.lineTop}cqh`,
	fontSize: `calc(${TEXT_BOX.lineFont}cqh * var(--text-size, 1))`,
	lineHeight: TEXT_BOX.lineHeight,
	pointerEvents: "none"
};

/** The speaker's name, right-aligned against the line's left. One row of the line tall, so it sits level with the line's first row at any text size. */
const NAME_SX: SxProps<Theme> = {
	position: "absolute",
	right: `${100 - TEXT_BOX.nameRight}%`,
	top: `${TEXT_BOX.nameTop - TEXT_BOX.lineTop}cqh`,
	fontSize: `${TEXT_BOX.nameFont}cqh`,
	lineHeight: `calc(${(TEXT_BOX.lineFont * TEXT_BOX.lineHeight) / TEXT_BOX.nameFont} * var(--text-size, 1))`,
	textAlign: "right",
	whiteSpace: "nowrap",
	color: "#cfd3da"
};

/** The whole line, unseen. It sizes the block from the first character, so a long line does not climb as it types. */
const LINE_SPACE_SX: SxProps<Theme> = { visibility: "hidden", ml: `${TEXT_BOX.lineLeft}%`, width: `${TEXT_BOX.lineWidth}%` };

/** The line as typed so far, over the space kept for it. */
const LINE_SX: SxProps<Theme> = { position: "absolute", top: 0, left: `${TEXT_BOX.lineLeft}%`, width: `${TEXT_BOX.lineWidth}%` };

/** A full-stage layer. */
const FILL_SX: SxProps<Theme> = { position: "absolute", inset: 0 };

/** The dark gradient the text sits on. */
const VIGNETTE_SX: SxProps<Theme> = {
	position: "absolute",
	left: 0,
	right: 0,
	bottom: 0,
	height: "38%",
	background: "linear-gradient(transparent, rgba(0,0,0,0.72) 45%, rgba(0,0,0,0.9))",
	pointerEvents: "none"
};

/** Props for StoryStage. */
interface StoryStageProps {
	/** What the stage shows. */
	stage: StageState;
	/** The speaker's name, or null for narration. */
	name?: string | null;
	/** The line being shown, or null when the box is empty. The phone reader leaves it out, since it draws the line itself. */
	line?: { text: string; spans?: Span[] } | null;
	/** How many characters of the line have typed out. */
	typed?: number;
	/** The reader's text size, which scales the line but not the name. Defaults to 1. */
	textSize?: number;
	/** The reader's name, which fills `{@nickname}` in subtitles and stickers. */
	nickname: string;
	/** Which story assets are published. */
	presence: StoryPresence;
	/** Whether the game's in-stage text is hidden, by HIDE or by a layout that draws the line somewhere readable instead. */
	hideText: boolean;
	/** Changes each time the stage should shake. */
	shakeKey: number;
	/** Anything drawn over the stage, such as the controls and choices. */
	children?: ReactNode;
	/** Called when the stage is clicked. The phone reader handles taps around the stage itself, so it passes none. */
	onClick?: () => void;
}

/** The text block's inline style: the text size as a custom property, so moving the slider never adds a new class. */
type TextSizeStyle = CSSProperties & { "--text-size": number };

/**
 * The CSS transform for a layer's placement.
 *
 * @param layer The layer.
 * @param moved Whether its tween has started.
 * @returns The style.
 */
function layerStyle(layer: LayerState, moved: boolean): CSSProperties {
	const at = moved && layer.to ? layer.to : layer.from;
	return {
		transform: `translate(${(at.x / GAME_WIDTH) * 100}%, ${(-at.y / GAME_HEIGHT) * 100}%) scale(${at.xScale}, ${at.yScale})`,
		transition: moved && layer.to ? `transform ${layer.duration}s linear` : "none",
		animation: layer.fade > 0 ? `storyFadeIn ${layer.fade}s ease-out` : "none"
	};
}

/**
 * One background or art scene. It starts at its tween's `from` and moves to `to` on the next frame, so the tween plays.
 *
 * @param props Component props.
 * @returns The layer, or nothing when its art is not published.
 */
function Layer({ layer, presence }: { layer: LayerState; presence: StoryPresence }) {
	const [moved, setMoved] = useState(false);
	useEffect(() => {
		setMoved(false);
		const frame = requestAnimationFrame(() => setMoved(true));
		return () => cancelAnimationFrame(frame);
	}, [layer]);
	const url = storyAssetUrl(layer.kind, layer.name, presence);
	if (!url) {
		return null;
	}
	return <Box sx={{ ...FILL_SX, backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" }} style={layerStyle(layer, moved)} />;
}

/**
 * The line's text up to `typed` characters, keeping each styled run's style.
 *
 * @param line The line.
 * @param typed How many characters to show.
 * @returns The visible runs.
 */
export function typedRuns(line: { text: string; spans?: Span[] }, typed: number): ReactNode[] {
	const runs = line.spans ?? [{ text: line.text }];
	const out: ReactNode[] = [];
	let left = typed;
	runs.forEach((run, index) => {
		if (left <= 0) {
			return;
		}
		const piece = run.text.slice(0, left);
		left -= piece.length;
		out.push(
			<span key={index} style={{ fontStyle: run.i ? "italic" : undefined, fontWeight: run.b ? 600 : undefined, color: run.color }}>
				{piece}
			</span>
		);
	});
	return out;
}

/**
 * The stage's art: background, art scene, sprites, subtitle and sticker. Memoised on the stage, which only changes when the story moves on, so
 * the typewriter's ticks leave it alone.
 *
 * @param props Component props.
 * @returns The art.
 */
const StageArt = memo(function StageArt({ stage, nickname, presence }: { stage: StageState; nickname: string; presence: StoryPresence }) {
	const slots = (Object.keys(stage.sprites) as Slot[]).filter((slot) => stage.sprites[slot]);
	const alone = slots.length === 1;
	return (
		<>
			{/* Keyed on the art, so a new scene mounts fresh and plays its own fade even when the fade time matches the last one. */}
			{stage.background ? <Layer key={stage.background.name} layer={stage.background} presence={presence} /> : null}
			{stage.image ? <Layer key={stage.image.name} layer={stage.image} presence={presence} /> : null}
			{slots.map((slot) => {
				const spriteName = stage.sprites[slot] ?? "";
				const url = storyAssetUrl("sprites", spriteName, presence);
				if (!url) {
					return null;
				}
				const place = alone || slot === "m" ? SPRITE_PLACEMENT.one : SPRITE_PLACEMENT[slot];
				const dimmed = stage.focus !== "all" && stage.focus !== slot;
				return (
					<Box
						key={slot}
						component="img"
						src={url}
						alt=""
						sx={{ position: "absolute", transform: "translateX(-50%)", transition: "filter 0.3s", pointerEvents: "none" }}
						style={{ height: `${place.height}%`, bottom: `${place.bottom}%`, left: `${place.centre}%`, filter: dimmed ? DIMMED : "none" }}
					/>
				);
			})}
			{stage.subtitle ? (
				<Box sx={{ position: "absolute", left: "15%", right: "15%", top: "42%", textAlign: "center", fontSize: "2.6cqh", lineHeight: 1.5 }}>
					{typedRuns(fillNickname(stage.subtitle, nickname), Number.MAX_SAFE_INTEGER)}
				</Box>
			) : null}
			{stage.stickers.length ? (
				<Box sx={{ position: "absolute", left: "10%", right: "10%", top: "15%", display: "grid", gap: "2cqh", fontSize: "2.4cqh", whiteSpace: "pre-line" }}>
					{stage.stickers.map((entry) => (
						<div key={entry.id}>{fillNickname(entry.text, nickname)}</div>
					))}
				</Box>
			) : null}
		</>
	);
});

/**
 * The story stage: the art, the blocker and the text box, laid out with the values tuned against the game.
 *
 * @param props Component props.
 * @returns The stage.
 */
function StoryStage({ stage, name = null, line = null, typed = 0, textSize = 1, nickname, presence, hideText, shakeKey, children, onClick }: StoryStageProps) {
	const textStyle = useMemo<TextSizeStyle>(() => ({ "--text-size": textSize }), [textSize]);
	// The whole line for the unseen copy. It changes with the line, not with each character the typewriter adds.
	const fullLine = useMemo(() => (line ? typedRuns(line, Number.MAX_SAFE_INTEGER) : null), [line]);
	return (
		<Box
			sx={{ ...STAGE_SX, filter: stage.grayscale ? "grayscale(1)" : undefined }}
			style={{ animation: shakeKey ? `storyShake${shakeKey % 2} 0.5s linear` : undefined }}
			onClick={onClick}
			data-region="story-stage"
		>
			<GlobalStyles styles={KEYFRAMES} />
			<StageArt stage={stage} nickname={nickname} presence={presence} />
			{/* The blocker fades the art only. Lines read in the dark stay readable over it, as in the game. */}
			<Box sx={{ ...FILL_SX, pointerEvents: "none" }} style={{ background: stage.blocker.color, opacity: stage.blocker.alpha, transition: `opacity ${stage.blocker.fade}s linear` }} />
			{!hideText && line ? (
				<>
					<Box sx={VIGNETTE_SX} />
					<Box sx={TEXT_BLOCK_SX} style={textStyle}>
						{name ? <Box sx={NAME_SX}>{name}</Box> : null}
						<Box sx={LINE_SPACE_SX} aria-hidden>
							{fullLine}
						</Box>
						<Box sx={LINE_SX} aria-live="polite">
							{typedRuns(line, typed)}
						</Box>
					</Box>
				</>
			) : null}
			{children}
		</Box>
	);
}

export default memo(StoryStage);
