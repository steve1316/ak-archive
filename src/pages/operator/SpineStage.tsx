// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Spine stage

/**
 * The live chibi inside the Animations card. Picks the rig for the page's form, kind and facing from the Spine index, plays it with the
 * runtime in `src/spine/`, and falls back to `StagePlaceholder` when there is no rig, the runtime cannot draw it yet, or it fails to load.
 * One canvas and one WebGL context serve every rig the card shows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { ErrorBoundary, useZoomPan } from "archive-kit";

import { loadSpineIndex, spineFormKey, spineRigUrls, spineRoot } from "../../lib/spine.js";
import { isSupported, SUPPORTED_STAGE } from "../../spine/features.js";
import type { SpinePlayer } from "../../spine/player.js";
import type { SpineIndex, SpineRig } from "../../types/spine.js";
import { StagePlaceholder } from "./AnimationsCard.js";
import type { RigFacing, RigKind, StageStatus } from "./AnimationsCard.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Longest step one frame may take, in seconds, so a stall is not played back as one jump. */
const MAX_DELTA = 0.1;

/** The animation each kind starts on when the rig has it. Otherwise the first animation plays. */
const START_ANIMATION: Record<RigKind, string> = { battle: "Idle", dorm: "Relax" };

/** Shown when the rig or the runtime fails to load. */
const LOAD_FAILED = "Couldn't load this chibi.";

/** Shown when the rig needs a runtime stage that has not been built yet. */
const ON_THEIR_WAY = "Chibi animations are on their way.";

/** The gesture surface over the whole stage. It holds the canvas and takes the clicks, wheel and drags. */
const SURFACE_SX: SxProps<Theme> = { position: "absolute", inset: 0 };

/** The canvas fills the surface. Its backing store is sized by the player at the device pixel ratio. */
const CANVAS_STYLE: CSSProperties = { display: "block", width: "100%", height: "100%" };

/** The status reported while no stage is mounted, so the card never shows a caption or Back toggle left over from an earlier rig. */
const EMPTY_STATUS: StageStatus = { hasBack: false, caption: null };

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Types

/** The player module, loaded with a dynamic `import()` so the runtime is its own chunk. */
type PlayerModule = typeof import("../../spine/player.js");

/** How the last load of a rig ended. */
interface LoadResult {
	/** The rig key the result belongs to. A result for any other key is stale. */
	key: string;
	/** The load the result belongs to. A result from any earlier load is stale, even for the same rig. */
	load: number;
	/** Whether the rig plays, uses a feature the runtime lacks, or failed to load. */
	outcome: "ready" | "unsupported" | "error";
}

/** Props for SpineStage. */
interface SpineStageProps {
	/** The upstream operator id, such as `char_172_svrash`. */
	operatorId: string;
	/** The page's selected form key, as `?skin=` carries it, or null when the operator has no forms. */
	formKey: string | null;
	/** The selected rig kind. */
	kind: RigKind;
	/** The selected facing, used for the battle kind only. */
	facing: RigFacing;
	/** The operator's class, whose icon the placeholder shows. */
	profession: string;
	/** Reports the stage's status to the card. */
	onStatus: (status: StageStatus) => void;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Picks the animation a rig starts on: the kind's usual one when the rig has it, otherwise the first.
 *
 * @param anims The rig's animation names, in index order.
 * @param kind The rig kind.
 * @returns The index of the starting animation.
 */
function startIndex(anims: string[], kind: RigKind): number {
	return Math.max(0, anims.indexOf(START_ANIMATION[kind]));
}

/**
 * Frees a canvas's WebGL context at once rather than waiting for garbage collection, since browsers cap how many can be live.
 *
 * @param canvas The canvas whose context to release.
 */
function releaseContext(canvas: HTMLCanvasElement): void {
	canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Component

/**
 * Plays an operator's chibi for the selected form, kind and facing. Every animation loops, and a click (not a drag) moves to the next one
 * in index order. The wheel zooms and a drag pans through the player's view, so the chibi stays sharp. The frame loop stops while the stage
 * is off screen or the tab is hidden. Runtime errors fall back to the load-failure placeholder rather than escaping the card.
 *
 * @param props Component props.
 * @returns The stage contents: the canvas, and the placeholder when no chibi plays.
 */
function LiveStage({ operatorId, formKey, kind, facing, profession, onStatus }: SpineStageProps) {
	const [spineIndex, setSpineIndex] = useState<SpineIndex | null>(null);
	const [indexFailed, setIndexFailed] = useState(false);
	const [playerModule, setPlayerModule] = useState<PlayerModule | null>(null);
	const [player, setPlayer] = useState<SpinePlayer | null>(null);
	const [playerFailed, setPlayerFailed] = useState(false);
	const [result, setResult] = useState<LoadResult | null>(null);
	const [animIndex, setAnimIndex] = useState(0);
	const [onScreen, setOnScreen] = useState(false);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const zoom = useZoomPan<HTMLDivElement>({ minScale: 1, maxScale: 4, doubleClickZoom: false });
	const { containerRef: surfaceRef, reset: resetZoom, wasDragged } = zoom;
	// Read by the frame loop, so a zoom or pan never restarts it.
	const transformRef = useRef(zoom.transform);
	transformRef.current = zoom.transform;
	// Counts loads, so a result can be told apart from one an earlier load of the same rig left behind.
	const loadCount = useRef(0);

	// The form's rigs, and the one rig the selection names. The key identifies that rig, so a load result can be matched to it.
	const entry = spineIndex?.[operatorId];
	const spineKey = entry && formKey !== null ? spineFormKey(formKey, entry) : null;
	const form = entry && spineKey !== null ? entry[spineKey] : undefined;
	const rigKind = kind === "dorm" ? "dorm" : facing === "back" && form?.back ? "back" : "battle";
	const rig: SpineRig | undefined = form?.[rigKind];
	const rigKey = rig && spineKey !== null ? `${operatorId}/${spineKey}/${rigKind}` : null;
	const drawable = rig !== undefined && rig.stage <= SUPPORTED_STAGE;
	const current = result !== null && result.key === rigKey && result.load === loadCount.current ? result : null;
	const ready = current?.outcome === "ready";
	const anims = useMemo(() => rig?.anims ?? [], [rig]);

	// Why no chibi plays, or null while one plays or is still loading.
	let message: string | null = null;
	if (indexFailed || playerFailed) {
		message = LOAD_FAILED;
	} else if (spineIndex && !rig) {
		message = kind === "dorm" ? "No dorm chibi for this outfit." : "No battle chibi for this outfit.";
	} else if (rig && !drawable) {
		message = ON_THEIR_WAY;
	} else if (current !== null && current.outcome !== "ready") {
		message = current.outcome === "unsupported" ? ON_THEIR_WAY : LOAD_FAILED;
	}
	const loading = message === null && !ready;

	// Fetches the index, and fetches it again on the next selection change after a failure. `loadSpineIndex` shares one request.
	const selection = `${operatorId}/${formKey}/${kind}/${facing}`;
	useEffect(() => {
		if (spineIndex) {
			return;
		}
		let active = true;
		setIndexFailed(false);
		loadSpineIndex().then(
			(index) => {
				if (active) {
					setSpineIndex(index);
				}
			},
			() => {
				if (active) {
					setIndexFailed(true);
				}
			}
		);
		return () => {
			active = false;
		};
	}, [spineIndex, selection]);

	// The runtime is fetched the first time a rig can play, so a page with none never downloads it.
	useEffect(() => {
		if (!drawable || playerModule) {
			return;
		}
		let active = true;
		import("../../spine/player.js").then(
			(module) => {
				if (active) {
					setPlayerModule(module);
				}
			},
			() => {
				if (active) {
					setPlayerFailed(true);
				}
			}
		);
		return () => {
			active = false;
		};
	}, [drawable, playerModule]);

	// One player for the stage's lifetime. Rig switches reuse it and its WebGL context, which is released on unmount. `playerModule` is set
	// once and never changes, so this cleanup runs only on unmount, and a lost context is never handed to a second player on the same canvas.
	// StrictMode's extra mount-time run happens while `playerModule` is still null, so it creates nothing.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!playerModule || !canvas) {
			return;
		}
		let created: SpinePlayer;
		try {
			created = new playerModule.SpinePlayer(canvas);
		} catch {
			setPlayerFailed(true);
			return;
		}
		setPlayer(created);
		return () => {
			created.dispose();
			releaseContext(canvas);
			setPlayer(null);
		};
	}, [playerModule]);

	// Loads the selected rig and starts its first animation, with the zoom back at fitted. Each run is a new load, so a result an earlier load
	// left behind no longer counts as ready. A switch aborts the previous load, and its result is dropped.
	useEffect(() => {
		resetZoom();
		const load = ++loadCount.current;
		setResult(null);
		if (!player || !rig || rigKey === null || spineKey === null || !drawable) {
			return;
		}
		const controller = new AbortController();
		player
			.load(spineRigUrls(spineRoot(), operatorId, spineKey, rigKind, rig), controller.signal)
			.then(() => {
				if (controller.signal.aborted) {
					return;
				}
				// A backstop for the index's stage: the parsed skeleton is checked against what the runtime draws.
				const data = player.skeleton?.data;
				if (!data || !isSupported(data)) {
					setResult({ key: rigKey, load, outcome: "unsupported" });
					return;
				}
				const first = startIndex(rig.anims, kind);
				player.play(rig.anims[first] ?? "", true);
				setAnimIndex(first);
				setResult({ key: rigKey, load, outcome: "ready" });
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setResult({ key: rigKey, load, outcome: "error" });
				}
			});
		try {
			// `load` drops the old rig at once, so this clears the canvas while the new one loads.
			player.render();
		} catch {
			setResult({ key: rigKey, load, outcome: "error" });
		}
		return () => controller.abort();
	}, [player, rig, rigKey, rigKind, spineKey, drawable, operatorId, kind, resetZoom]);

	// Marks the current load as failed, which swaps in the load-failure placeholder. Read through a ref by the observers and the frame loop.
	const fail = useCallback(() => {
		if (rigKey !== null) {
			setResult({ key: rigKey, load: loadCount.current, outcome: "error" });
		}
	}, [rigKey]);
	const failRef = useRef(fail);
	failRef.current = fail;

	// Clears the card's caption and Back toggle when the stage goes away.
	useEffect(() => () => onStatus(EMPTY_STATUS), [onStatus]);

	useEffect(() => {
		const name = anims[animIndex];
		onStatus({ hasBack: form?.back !== undefined, caption: ready && name !== undefined ? `${name} - ${animIndex + 1} / ${anims.length}` : null });
	}, [onStatus, form, ready, anims, animIndex]);

	// Tracks whether the stage is on screen, so the frame loop can stop while it is scrolled away.
	useEffect(() => {
		const surface = surfaceRef.current;
		if (!surface) {
			return;
		}
		const observer = new IntersectionObserver((entries) => {
			const latest = entries[entries.length - 1];
			if (latest) {
				setOnScreen(latest.isIntersecting);
			}
		});
		observer.observe(surface);
		return () => observer.disconnect();
	}, [surfaceRef]);

	// Redraws when the stage's box changes size. The player sizes the backing store to the box at the device pixel ratio on each render.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!player || !canvas) {
			return;
		}
		const observer = new ResizeObserver(() => {
			try {
				player.render();
			} catch {
				failRef.current();
			}
		});
		observer.observe(canvas);
		return () => observer.disconnect();
	}, [player]);

	// The frame loop: runs while a rig plays, the stage is on screen and the tab is visible.
	useEffect(() => {
		if (!player || !ready || !onScreen) {
			return;
		}
		let frame: number | null = null;
		let last: number | null = null;
		const tick = (now: number) => {
			const delta = last === null ? 0 : Math.min((now - last) / 1000, MAX_DELTA);
			last = now;
			const transform = transformRef.current;
			player.setViewTransform(transform.scale, transform.x, transform.y);
			try {
				player.update(delta);
			} catch {
				frame = null;
				failRef.current();
				return;
			}
			frame = requestAnimationFrame(tick);
		};
		const start = () => {
			if (frame === null && !document.hidden) {
				// A fresh start takes a zero step, so time spent hidden or off screen is never played back as one jump.
				last = null;
				frame = requestAnimationFrame(tick);
			}
		};
		const stop = () => {
			if (frame !== null) {
				cancelAnimationFrame(frame);
				frame = null;
			}
		};
		const handleVisibility = () => (document.hidden ? stop() : start());
		document.addEventListener("visibilitychange", handleVisibility);
		start();
		return () => {
			stop();
			document.removeEventListener("visibilitychange", handleVisibility);
		};
	}, [player, ready, onScreen]);

	// A drag ends in a click, so only a click that never moved cycles the animation.
	// Every animation loops, so the cycle never stalls on one that would otherwise stop at its end.
	const handleClick = useCallback(() => {
		if (!player || !ready || wasDragged() || anims.length === 0) {
			return;
		}
		const next = (animIndex + 1) % anims.length;
		try {
			player.play(anims[next] ?? "", true);
			setAnimIndex(next);
		} catch {
			fail();
		}
	}, [player, ready, wasDragged, anims, animIndex, fail]);

	return (
		<>
			<Box
				ref={surfaceRef}
				sx={SURFACE_SX}
				style={{ ...zoom.containerStyle, visibility: ready ? "visible" : "hidden" }}
				onPointerDown={zoom.handlers.onPointerDown}
				onDoubleClick={zoom.handlers.onDoubleClick}
				onClick={handleClick}
			>
				<canvas ref={canvasRef} style={CANVAS_STYLE} aria-label="Operator chibi animation" />
			</Box>
			{message !== null ? <StagePlaceholder profession={profession} message={message} /> : null}
			{loading ? (
				<Typography variant="body2" color="text.secondary" role="status">
					Loading...
				</Typography>
			) : null}
		</>
	);
}

/**
 * The chibi stage, guarded so that a throw the stage's own error handling misses shows the load-failure placeholder in the card instead of
 * taking down the operator page. The guard resets when the operator changes.
 *
 * @param props Component props.
 * @returns The guarded stage.
 */
export default function SpineStage(props: SpineStageProps) {
	return (
		<ErrorBoundary key={props.operatorId} fallback={<StagePlaceholder profession={props.profession} message={LOAD_FAILED} />}>
			<LiveStage {...props} />
		</ErrorBoundary>
	);
}
