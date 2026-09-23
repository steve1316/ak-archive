import { memo, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { storyAssetUrl } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import type { Span } from "../../types/story.js";
import { fillNickname } from "./engine.js";
import type { LayerState, Slot, StageState } from "./engine.js";

/** Where a sprite stands, as % of the stage: height, bottom edge and centre. Tuned against the in-game capture `9.png`. */
const SPRITE_PLACEMENT = { l: { height: 150.5, bottom: -47, centre: 34.5 }, r: { height: 139, bottom: -44, centre: 65.5 }, one: { height: 144, bottom: -45.5, centre: 50 } };

/** The text box, as % of the stage. Font sizes are % of the stage height. Tuned against `9.png`. */
const TEXT_BOX = { nameRight: 26.1, nameTop: 86.9, nameFont: 3.6, lineLeft: 29.9, lineTop: 86.8, lineWidth: 55, lineFont: 2.65, lineHeight: 1.4 };

/** Below this stage width the in-stage text would be a few pixels tall, so the player shows the line under the stage instead. */
export const NARROW_STAGE = "@container (max-width: 600px)";

/** The in-stage text and its vignette, hidden on a narrow stage. */
const TEXT_LAYER_SX: SxProps<Theme> = { [NARROW_STAGE]: { display: "none" } };

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
	name: string | null;
	/** The line being shown, or null when the box is empty. */
	line: { text: string; spans?: Span[] } | null;
	/** How many characters of the line have typed out. */
	typed: number;
	/** The reader's name, which fills `{@nickname}` in subtitles and stickers. */
	nickname: string;
	/** Which story assets are published. */
	presence: StoryPresence;
	/** Whether the text and chrome are hidden. */
	hideText: boolean;
	/** Changes each time the stage should shake. */
	shakeKey: number;
	/** Anything drawn over the stage, such as the controls, choices and Log. */
	children?: ReactNode;
	/** Called when the stage is clicked. */
	onClick: () => void;
}

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
			{stage.background ? <Layer layer={stage.background} presence={presence} /> : null}
			{stage.image ? <Layer layer={stage.image} presence={presence} /> : null}
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
 * The story stage: the art, the text box and the blocker, laid out with the values tuned against the game.
 *
 * @param props Component props.
 * @returns The stage.
 */
function StoryStage({ stage, name, line, typed, nickname, presence, hideText, shakeKey, children, onClick }: StoryStageProps) {
	return (
		<Box
			sx={{ ...STAGE_SX, filter: stage.grayscale ? "grayscale(1)" : undefined }}
			style={{ animation: shakeKey ? `storyShake${shakeKey % 2} 0.5s linear` : undefined }}
			onClick={onClick}
			data-region="story-stage"
		>
			<StageArt stage={stage} nickname={nickname} presence={presence} />
			{!hideText && line ? (
				<Box sx={TEXT_LAYER_SX}>
					<Box sx={VIGNETTE_SX} />
					{name ? (
						<Box
							sx={{ position: "absolute", textAlign: "right", whiteSpace: "nowrap", color: "#cfd3da" }}
							style={{
								right: `${100 - TEXT_BOX.nameRight}%`,
								top: `${TEXT_BOX.nameTop}%`,
								fontSize: `${TEXT_BOX.nameFont}cqh`,
								lineHeight: `${(TEXT_BOX.lineFont * TEXT_BOX.lineHeight) / TEXT_BOX.nameFont}`
							}}
						>
							{name}
						</Box>
					) : null}
					<Box
						sx={{ position: "absolute" }}
						style={{ left: `${TEXT_BOX.lineLeft}%`, top: `${TEXT_BOX.lineTop}%`, width: `${TEXT_BOX.lineWidth}%`, fontSize: `${TEXT_BOX.lineFont}cqh`, lineHeight: TEXT_BOX.lineHeight }}
						aria-live="polite"
					>
						{typedRuns(line, typed)}
					</Box>
				</Box>
			) : null}
			<Box sx={{ ...FILL_SX, pointerEvents: "none" }} style={{ background: stage.blocker.color, opacity: stage.blocker.alpha, transition: `opacity ${stage.blocker.fade}s linear` }} />
			{children}
		</Box>
	);
}

export default memo(StoryStage);
