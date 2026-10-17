import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { Box, GlobalStyles } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { storyAssetUrl } from "../../lib/story.js";
import type { StoryPresence } from "../../lib/story.js";
import type { Span } from "../../types/story.js";
import { characterOf, fillNickname } from "./engine.js";
import { shakeFrames } from "./shake.js";
import type { Shake } from "./shake.js";
import { SLOT_CENTRES, spriteSize } from "./spriteLayout.js";
import type { Blur, Caption, Curtain, Edge, LayerState, Motion, Slot, StageState, Stamp, Sticker } from "./engine.js";

/**
 * The text box, as % of the stage. Font sizes are % of the stage height. Tuned against `9.png`. The floor is not the game's: it is how low a
 * line may run before it rises instead.
 */
const TEXT_BOX = { nameRight: 26.1, nameTop: 86.9, nameFont: 3.6, lineLeft: 29.9, lineTop: 86.8, lineWidth: 55, lineFont: 2.65, lineHeight: 1.4, lineFloor: 98 };

/** The keyframes the stage uses for fades, slides and sprite motion. */
const KEYFRAMES = {
	"@keyframes storySlideA": { from: { transform: "translate(var(--slide-x), var(--slide-y))" } },
	"@keyframes storySlideB": { from: { transform: "translate(var(--slide-x), var(--slide-y))" } },
	"@keyframes storyFadeIn": { from: { opacity: 0 }, to: { opacity: 1 } },
	"@keyframes storyStampIn": { from: { opacity: 0, translate: "-2cqh 0" }, to: { opacity: 1, translate: "0 0" } },
	"@keyframes storyFadeOnly": { from: { opacity: 0 }, to: { opacity: 1 } },
	"@keyframes storyFadeOut": { from: { opacity: 1 }, to: { opacity: 0 } },
	"@keyframes storyStampStar": {
		"0%": { opacity: 1, transform: "scale(0) rotate(0deg)" },
		"45%": { opacity: 1, transform: "scale(1.5) rotate(45deg)" },
		"100%": { opacity: 0, transform: "scale(0) rotate(90deg)" }
	},
	"@keyframes storyStampCore": { "0%, 40%": { opacity: 0, transform: "scale(0) rotate(-90deg)" }, "100%": { opacity: 1, transform: "scale(1) rotate(0deg)" } },
	"@keyframes storyStampFrame": { "0%, 35%": { opacity: 0, transform: "scale(0.7)" }, "100%": { opacity: 1, transform: "scale(1)" } },
	"@keyframes storyStampRing": { "0%, 45%": { opacity: 0, transform: "scale(1)" }, "52%": { opacity: 0.9 }, "100%": { opacity: 0, transform: "scale(3.2)" } },
	"@keyframes storyJump": { "0%, 100%": { translate: "0 0" }, "50%": { translate: "0 calc(var(--jump) * -1)" } },
	"@keyframes storySpriteShake": {
		"0%, 100%": { translate: "0 0" },
		"10%, 50%, 90%": { translate: "-0.8cqh 0" },
		"30%, 70%": { translate: "0.8cqh 0" }
	},
	"@keyframes storyCurtainV": { from: { height: "var(--from)" }, to: { height: "var(--to)" } },
	"@keyframes storyCurtainH": { from: { width: "var(--from)" }, to: { width: "var(--to)" } }
};

/** How a sprite that is not speaking is drawn. */
const DIMMED = "brightness(0.45)";

/** The game's layout size, which layer offsets are written in. */
const GAME_WIDTH = 1920;
const GAME_HEIGHT = 1080;

/** The game's text space, which subtitle and sticker positions are written in. */
const TEXT_WIDTH = 1280;
const TEXT_HEIGHT = 720;

/** A subtitle or sticker. Its box and font size come from the script, through `captionStyle`. */
const CAPTION_SX: SxProps<Theme> = { position: "absolute", lineHeight: 1.4, whiteSpace: "pre-line", pointerEvents: "none" };

/** How long a cleared stamp takes to fade out, in seconds. The script waits a second after clearing it, so it is gone before the next beat. */
const STAMP_FADE_OUT = 0.6;

/** How far the stamp's text starts from its emblem's centre, as % of the stage height. Measured from a capture of 15-1. */
const STAMP_TEXT_GAP = 6.9;

/**
 * How much wider the stamp's horizontal offset reads than the text space: `pos="-400,-200"` puts the emblem's centre at 8.3% of the width in
 * the game, which is -400 x 4/3 in 1280 units. The vertical offset reads in plain 720 units.
 */
const STAMP_X_SCALE = 4 / 3;

/** A location stamp: a bold place over a lighter time, behind a bar, sliding in from the left. Sizes are % of the stage height. */
const STAMP_SX: SxProps<Theme> = {
	position: "absolute",
	transform: "translateY(-50%)",
	textShadow: "0 0 1cqh rgba(0, 0, 0, 0.8)",
	whiteSpace: "nowrap",
	pointerEvents: "none",
	"& .band": {
		animation: "storyFadeOnly 0.4s ease-out",
		position: "absolute",
		left: "-14cqh",
		top: "50%",
		width: "70cqh",
		height: "26cqh",
		transform: "translateY(-50%)",
		background: "linear-gradient(to right, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0.35) 45%, transparent)"
	},
	"& .emblem": { position: "absolute", left: 0, top: "50%", width: "25cqh", height: "25cqh", transform: "translate(-50%, -50%)" },
	"& .lines": { position: "relative", ml: `${STAMP_TEXT_GAP}cqh`, animation: "storyStampIn 0.5s ease-out 0.35s backwards" },
	// The emblem's parts animate about their own centres: a star, which turns into the emblem, then a ring that radiates out of it.
	"& .emblem g": { transformBox: "fill-box", transformOrigin: "center" },
	"& .star": { animation: "storyStampStar 0.7s ease-in-out forwards" },
	"& .core": { animation: "storyStampCore 0.75s ease-out backwards" },
	"& .frame": { animation: "storyStampFrame 0.9s ease-out backwards" },
	"& .ring": { animation: "storyStampRing 1.5s ease-out forwards" },
	"& .place": { fontSize: "4.25cqh", fontWeight: 700, lineHeight: 1.25, color: "#fff" },
	"& .time": { fontSize: "2.8cqh", fontWeight: 500, lineHeight: 1.4, color: "#e2e4e8" }
};

/** A full-stage frame a sprite moves in, so its offsets are % of the stage rather than of the sprite. */
const SPRITE_FRAME_SX: SxProps<Theme> = { position: "absolute", inset: 0, pointerEvents: "none" };

/** A sprite, scaled from its feet. */
const SPRITE_SX: SxProps<Theme> = { position: "absolute", transformOrigin: "50% 100%", pointerEvents: "none" };

/** A sprite jump's inline style: its height as a custom property the keyframes read. */
type JumpStyle = CSSProperties & { "--jump"?: string; "--slide-x"?: string; "--slide-y"?: string };

/** How strong a full `focusout` blur is, as % of the stage height. */
const BLUR_MAX = 1.2;

/** A letterbox bar. Where it sits comes from its edge, in `CURTAIN_PLACES`. */
const CURTAIN_SX = { position: "absolute", pointerEvents: "none" } as const;

/** Where each curtain sits, and which way its gradient fades toward the middle. */
const CURTAIN_PLACES: Record<Edge, { sx: SxProps<Theme>; inward: string; axis: "V" | "H" }> = {
	top: { sx: { ...CURTAIN_SX, top: 0, left: 0, right: 0 }, inward: "bottom", axis: "V" },
	bottom: { sx: { ...CURTAIN_SX, bottom: 0, left: 0, right: 0 }, inward: "top", axis: "V" },
	left: { sx: { ...CURTAIN_SX, left: 0, top: 0, bottom: 0 }, inward: "right", axis: "H" },
	right: { sx: { ...CURTAIN_SX, right: 0, top: 0, bottom: 0 }, inward: "left", axis: "H" }
};

/** A curtain's inline style: where its move starts and ends, as custom properties the keyframes read. */
type CurtainStyle = CSSProperties & { "--from": string; "--to": string };

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
	/** The shake to play when `shakeKey` changes. */
	shake: Shake | null;
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
 * The filter for a blurred layer, easing between sharp and blurred. A sharp layer has no filter, so it costs nothing to draw.
 *
 * @param blur The layer's blur, if it has one.
 * @returns The style.
 */
function blurStyle(blur: Blur | undefined): CSSProperties {
	return blur ? { filter: blur.amount > 0 ? `blur(${blur.amount * BLUR_MAX}cqh)` : "none", transition: `filter ${blur.duration}s ease-in-out` } : {};
}

/**
 * A letterbox bar's style: its size, and the move from its start size to it.
 *
 * @param edge The edge it comes in from.
 * @param curtain The bar.
 * @returns The style.
 */
function curtainStyle(edge: Edge, curtain: Curtain): CurtainStyle {
	const { inward, axis } = CURTAIN_PLACES[edge];
	const size = `${curtain.to * 100}%`;
	return {
		"--from": `${curtain.from * 100}%`,
		"--to": size,
		[axis === "V" ? "height" : "width"]: size,
		background: curtain.grad ? `linear-gradient(to ${inward}, #000 60%, transparent)` : "#000",
		animation: curtain.fade > 0 ? `storyCurtain${axis} ${curtain.fade}s ease-in-out` : "none"
	};
}

/**
 * Where a caption sits on stage, from its box in the game's text space.
 *
 * @param caption The caption.
 * @returns The style.
 */
function captionStyle(caption: Caption): CSSProperties {
	return {
		left: `${(caption.x / TEXT_WIDTH) * 100}%`,
		top: `${(caption.y / TEXT_HEIGHT) * 100}%`,
		width: `${(caption.width / TEXT_WIDTH) * 100}%`,
		fontSize: `${(caption.size / TEXT_HEIGHT) * 100}cqh`,
		textAlign: caption.align
	};
}

/**
 * Where a sprite's frame has moved to, sliding there over the move's time.
 *
 * @param motion The sprite's motion, if it has moved.
 * @returns The style.
 */
function motionStyle(motion: Motion | undefined): JumpStyle {
	if (!motion) {
		return {};
	}
	const style: JumpStyle = { transform: `translate(${(motion.x / TEXT_WIDTH) * 100}%, ${(-motion.y / TEXT_HEIGHT) * 100}%)`, transition: `transform ${motion.duration}s ease-in-out` };
	if (motion.from && motion.duration > 0) {
		// The two keyframes take turns, so a second slide restarts the animation.
		style["--slide-x"] = `${(motion.from.x / TEXT_WIDTH) * 100}%`;
		style["--slide-y"] = `${(-motion.from.y / TEXT_HEIGHT) * 100}%`;
		style.animation = `storySlide${motion.cue % 2 ? "A" : "B"} ${motion.duration}s ease-in-out`;
	}
	return style;
}

/**
 * A sprite frame's style with its fade-in added to any slide it plays.
 *
 * @param style The frame's motion style.
 * @param fade How long it fades in, in seconds, or 0 for no fade.
 * @returns The style.
 */
function withFade(style: JumpStyle, fade: number): JumpStyle {
	if (fade <= 0) {
		return style;
	}
	const fadeIn = `storyFadeIn ${fade}s ease-out`;
	return { ...style, animation: style.animation ? `${fadeIn}, ${style.animation}` : fadeIn };
}

/**
 * The jump or shake a sprite plays, if its last action was one.
 *
 * @param motion The sprite's motion, if it has moved.
 * @returns The style.
 */
function cueStyle(motion: Motion | undefined): JumpStyle {
	if (motion?.jump) {
		const { power, times, duration } = motion.jump;
		return { "--jump": `${(power / TEXT_HEIGHT) * 100}cqh`, animation: `storyJump ${duration / times}s ease-in-out ${times}` };
	}
	return motion?.shake ? { animation: `storySpriteShake ${motion.shake}s linear` } : {};
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
	return <Box sx={{ ...FILL_SX, backgroundImage: `url(${url})`, backgroundSize: layer.fit, backgroundRepeat: "no-repeat", backgroundPosition: "center" }} style={layerStyle(layer, moved)} />;
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
 * The stage's art: background, art scene, sprites, their blurs and the letterbox curtains. Memoised on the stage, which only changes when the story moves on, so
 * the typewriter's ticks leave it alone.
 *
 * @param props Component props.
 * @returns The art.
 */
const StageArt = memo(function StageArt({ stage, presence }: { stage: StageState; presence: StoryPresence }) {
	const slots = (Object.keys(stage.sprites) as Slot[]).filter((slot) => stage.sprites[slot]);
	// A sprite that exited is out of sight, so it does not keep a lone sprite from standing in the middle.
	const alone = slots.filter((slot) => !stage.motion[slot]?.gone).length === 1;
	return (
		<>
			{/* Keyed on the art, so a new scene mounts fresh and plays its own fade even when the fade time matches the last one. */}
			<Box sx={FILL_SX} style={blurStyle(stage.blur.background)}>
				{stage.background ? <Layer key={stage.background.name} layer={stage.background} presence={presence} /> : null}
			</Box>
			<Box sx={FILL_SX} style={blurStyle(stage.blur.image)}>
				{stage.image ? <Layer key={stage.image.name} layer={stage.image} presence={presence} /> : null}
			</Box>
			<Box sx={FILL_SX} style={blurStyle(stage.blur.sprites)}>
				{slots.map((slot) => {
					const spriteName = stage.sprites[slot] ?? "";
					const url = storyAssetUrl("sprites", spriteName, presence);
					if (!url) {
						return null;
					}
					const size = spriteSize(spriteName);
					const centre = alone ? SLOT_CENTRES.m : SLOT_CENTRES[slot];
					const dimmed = stage.focus !== "all" && stage.focus !== slot;
					const motion = stage.motion[slot];
					const scale = motion?.scale ?? 1;
					const fade = stage.fadeIn[slot] ?? 0;
					return (
						// Keyed on the character, so one arriving fades in while a new expression of the same one changes at once.
						<Box key={`${slot}:${characterOf(spriteName)}`} sx={SPRITE_FRAME_SX} style={withFade(motionStyle(motion), fade)}>
							{/* Keyed on the cue, so each new jump or shake plays from its start. */}
							<Box key={motion?.cue ?? 0} sx={SPRITE_FRAME_SX} style={cueStyle(motion)}>
								<Box
									component="img"
									src={url}
									alt=""
									sx={SPRITE_SX}
									style={{
										height: `${size.height}%`,
										top: `${size.top}%`,
										left: `${centre}%`,
										filter: dimmed ? DIMMED : "none",
										transform: `translateX(-50%) scale(${scale})`,
										transition: `filter 0.3s, transform ${motion?.duration ?? 0}s ease-in-out`
									}}
								/>
							</Box>
						</Box>
					);
				})}
				{(Object.keys(stage.leaving) as Slot[]).map((slot) => {
					const leaving = stage.leaving[slot];
					const url = leaving ? storyAssetUrl("sprites", leaving.name, presence) : null;
					if (!leaving || !url) {
						return null;
					}
					const size = spriteSize(leaving.name);
					// Keyed on the sprite, so it fades out once from where it stood and then stays hidden.
					return (
						<Box
							key={`leaving:${slot}:${leaving.name}`}
							component="img"
							src={url}
							alt=""
							sx={SPRITE_SX}
							style={{
								height: `${size.height}%`,
								top: `${size.top}%`,
								left: `${SLOT_CENTRES[slot]}%`,
								transform: "translateX(-50%)",
								animation: `storyFadeOut ${leaving.fade}s ease-in forwards`
							}}
						/>
					);
				})}
			</Box>
			{(Object.keys(stage.curtains) as Edge[]).map((edge) => {
				const curtain = stage.curtains[edge];
				// Keyed on the cue, so each new curtain on this edge replays its move.
				return curtain ? <Box key={`${edge}-${curtain.cue}`} sx={CURTAIN_PLACES[edge].sx} style={curtainStyle(edge, curtain)} /> : null;
			})}
		</>
	);
});

/**
 * The stamp's emblem, drawn after the game's `group_location_stamp` art: a soft outer diamond, a white outlined diamond, a grey diamond and a
 * compass needle. It opens as the game's does: a star that turns into the emblem, then a ring that radiates out from it. Its units are tenths
 * of a % of the stage height, so it scales with the stage.
 *
 * @returns The emblem.
 */
function StampEmblem() {
	return (
		<svg className="emblem" viewBox="-125 -125 250 250" aria-hidden>
			<defs>
				<filter id="stampSoft">
					<feGaussianBlur stdDeviation="1.6" />
				</filter>
			</defs>
			<g className="frame">
				<rect transform="rotate(45)" x="-84" y="-84" width="168" height="168" fill="rgba(0, 0, 0, 0.35)" stroke="rgba(200, 200, 200, 0.45)" strokeWidth="10" filter="url(#stampSoft)" />
			</g>
			<g className="ring">
				<rect transform="rotate(45)" x="-34" y="-34" width="68" height="68" fill="none" stroke="#fff" strokeWidth="2.6" />
			</g>
			<g className="core">
				<rect transform="rotate(45)" x="-34" y="-34" width="68" height="68" fill="none" stroke="#fff" strokeWidth="2.6" />
				<rect transform="rotate(45)" x="-23" y="-23" width="46" height="46" fill="#9f9a99" />
				<polygon points="0,-26 8,0 -8,0" fill="#fff" />
				<polygon points="8,0 0,26 -8,0" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
			</g>
			<g className="star">
				<polygon points="0,-30 6,-6 30,0 6,6 0,30 -6,6 -30,0 -6,-6" fill="#fff" />
			</g>
		</svg>
	);
}

/**
 * The location stamp: its emblem at the script's offset from the stage's centre, with the place and time to its right.
 *
 * @param props Component props.
 * @returns The stamp.
 */
function StampView({ stamp }: { stamp: Stamp }) {
	const style = useMemo(
		() => ({
			left: `${((TEXT_WIDTH / 2 + stamp.x * STAMP_X_SCALE) / TEXT_WIDTH) * 100}%`,
			top: `${((TEXT_HEIGHT / 2 - stamp.y) / TEXT_HEIGHT) * 100}%`,
			// A cleared stamp fades out rather than vanishing.
			...(stamp.leaving ? { opacity: 0, transition: `opacity ${STAMP_FADE_OUT}s ease-in` } : {})
		}),
		[stamp]
	);
	return (
		<Box sx={STAMP_SX} style={style}>
			<div className="band" />
			<StampEmblem />
			<div className="lines">
				{stamp.place ? <div className="place">{stamp.place}</div> : null}
				{stamp.time ? <div className="time">{stamp.time}</div> : null}
			</div>
		</Box>
	);
}

/**
 * The location stamp, subtitle and stickers, each where its script puts it. Drawn over the fade, so narration over a darkened scene stays readable.
 *
 * @param props Component props.
 * @returns The captions.
 */
/** Typing slower than a frame is worth drawing. Anything quicker shows all at once. */
const MIN_TYPING = 0.016;

/**
 * One caption, typed out a character at a time at the script's pace. The whole text sits unseen underneath, so the box keeps its size and the
 * words do not shift as they appear. More text added to the same caption carries on from where it had got to.
 *
 * @param props Component props.
 * @param props.caption The caption, with the reader's name filled in.
 * @returns The caption.
 */
function CaptionView({ caption }: { caption: Caption }) {
	const total = caption.text.length;
	const instant = caption.typing < MIN_TYPING;
	const [typed, setTyped] = useState(instant ? total : 0);
	const last = useRef(caption.text);
	useEffect(() => {
		if (!caption.text.startsWith(last.current)) {
			setTyped(0);
		}
		last.current = caption.text;
	}, [caption.text]);
	useEffect(() => {
		if (instant || typed >= total) {
			return;
		}
		const timer = window.setTimeout(() => setTyped((count) => count + 1), caption.typing * 1000);
		return () => window.clearTimeout(timer);
	}, [instant, typed, total, caption.typing]);
	const shown = instant ? total : typed;
	return (
		<Box sx={CAPTION_SX} style={captionStyle(caption)}>
			<Box sx={{ visibility: instant ? "visible" : "hidden" }}>{typedRuns(caption, Number.MAX_SAFE_INTEGER)}</Box>
			{instant ? null : <Box sx={{ position: "absolute", inset: 0 }}>{typedRuns(caption, shown)}</Box>}
		</Box>
	);
}

const Captions = memo(function Captions({ subtitle, stickers, stamp, nickname }: { subtitle: Caption | null; stickers: Sticker[]; stamp: Stamp | null; nickname: string }) {
	return (
		<>
			{/* Keyed on the text, so a new stamp slides in again. */}
			{stamp ? <StampView key={`${stamp.place}|${stamp.time}`} stamp={stamp} /> : null}
			{subtitle ? <CaptionView caption={fillNickname(subtitle, nickname)} /> : null}
			{stickers.map((entry) => (
				<CaptionView key={entry.id} caption={fillNickname(entry, nickname)} />
			))}
		</>
	);
});

/**
 * The story stage: the art, the blocker and the text box, laid out with the values tuned against the game.
 *
 * @param props Component props.
 * @returns The stage.
 */
function StoryStage({ stage, name = null, line = null, typed = 0, textSize = 1, nickname, presence, hideText, shakeKey, shake, children, onClick }: StoryStageProps) {
	const shaker = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (shakeKey && shake) {
			shaker.current?.animate?.(shakeFrames(shake, shakeKey), { duration: shake.duration * 1000, easing: "linear" });
		}
		// Only a new shakeKey starts a shake.
	}, [shakeKey]);
	const textStyle = useMemo<TextSizeStyle>(() => ({ "--text-size": textSize }), [textSize]);
	// The whole line for the unseen copy. It changes with the line, not with each character the typewriter adds.
	const fullLine = useMemo(() => (line ? typedRuns(line, Number.MAX_SAFE_INTEGER) : null), [line]);
	return (
		<Box sx={{ ...STAGE_SX, filter: stage.grayscale ? "grayscale(1)" : undefined }} ref={shaker} onClick={onClick} data-region="story-stage">
			<GlobalStyles styles={KEYFRAMES} />
			<StageArt stage={stage} presence={presence} />
			{/* The blocker fades the art only. Lines read in the dark stay readable over it, as in the game. */}
			<Box sx={{ ...FILL_SX, pointerEvents: "none" }} style={{ background: stage.blocker.color, opacity: stage.blocker.alpha, transition: `opacity ${stage.blocker.fade}s linear` }} />
			<Captions subtitle={stage.subtitle} stickers={stage.stickers} stamp={stage.stamp} nickname={nickname} />
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
