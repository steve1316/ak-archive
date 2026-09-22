// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Spine stage

/**
 * The live chibi inside the Animations card, for any subject. The caller picks the rig and builds its URLs, and this plays it with the
 * runtime in `src/spine/`, falling back to the caller's placeholder when there is no rig, the runtime cannot draw it yet, or it fails to
 * load. One canvas and one WebGL context serve every rig the card shows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import { ErrorBoundary, useZoomPan } from "archive-kit";

import { isSupported, SUPPORTED_STAGE } from "../spine/features.js";
import type { RigUrls, SpinePlayer } from "../spine/player.js";
import type { SpineRig } from "../types/spine.js";
import type { StageStatus } from "./AnimationsCard.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Longest step one frame may take, in seconds, so a stall is not played back as one jump. */
const MAX_DELTA = 0.1;

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
type PlayerModule = typeof import("../spine/player.js");

/** Where a rig index's fetch stands. */
export type RigIndexState = "loading" | "ready" | "failed";

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
export interface SpineStageProps {
	/** Resets the stage's error guard when it changes, such as the operator or enemy id. */
	guardKey: string;
	/** The selected rig's identity, such as `char_002_amiya/base/battle`, or null when there is no rig. */
	rigKey: string | null;
	/** The selected rig, or null when there is none. */
	rig: SpineRig | null;
	/** The selected rig's file URLs, stable across renders for the same rig, or null when there is no rig. */
	urls: RigUrls | null;
	/** Where the rig index's fetch stands. The missing-rig message only shows once the index is ready. */
	indexState: RigIndexState;
	/** The animation to start on when the rig has it. Otherwise the first animation plays. */
	startAnimation: string;
	/** Shown when the index is ready but names no rig for the selection. */
	missingMessage: string;
	/** Draws the placeholder for a reason no chibi plays. */
	renderPlaceholder: (message: string) => ReactNode;
	/** The canvas's accessible name. */
	canvasLabel: string;
	/** Whether the selection has a back-facing rig, reported to the card for its Back toggle. */
	hasBack: boolean;
	/** Reports the stage's status to the card. */
	onStatus: (status: StageStatus) => void;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Frees a canvas's WebGL context at once rather than waiting for garbage collection, since browsers cap how many can be live.
 *
 * @param canvas The canvas whose context to release.
 */
function releaseContext(canvas: HTMLCanvasElement): void {
	canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
}

/**
 * Fetches a rig index, and fetches it again on the next `retryKey` change after a failure. The loader shares one request across callers.
 *
 * @param load The index loader, such as `loadSpineIndex`. Must be stable.
 * @param retryKey Changes when the selection changes, which is when a failed fetch is retried.
 * @returns The index once loaded, and where the fetch stands.
 */
export function useRigIndex<T>(load: () => Promise<T>, retryKey: string): { index: T | null; state: RigIndexState } {
	const [index, setIndex] = useState<T | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (index !== null) {
			return;
		}
		let active = true;
		setFailed(false);
		load().then(
			(loaded) => {
				if (active) {
					setIndex(() => loaded);
				}
			},
			() => {
				if (active) {
					setFailed(true);
				}
			}
		);
		return () => {
			active = false;
		};
	}, [index, load, retryKey]);
	return { index, state: index !== null ? "ready" : failed ? "failed" : "loading" };
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Component

/**
 * Plays the given rig. Every animation loops, and a click (not a drag) moves to the next one in index order. The wheel zooms and a drag pans
 * through the player's view, so the chibi stays sharp. The frame loop stops while the stage is off screen or the tab is hidden. Runtime
 * errors fall back to the load-failure placeholder rather than escaping the card.
 *
 * @param props Component props.
 * @returns The stage contents: the canvas, and the placeholder when no chibi plays.
 */
function LiveStage({ rigKey, rig, urls, indexState, startAnimation, missingMessage, renderPlaceholder, canvasLabel, hasBack, onStatus }: SpineStageProps) {
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

	const drawable = rig !== null && rig.stage <= SUPPORTED_STAGE;
	const current = result !== null && result.key === rigKey && result.load === loadCount.current ? result : null;
	const ready = current?.outcome === "ready";
	const anims = useMemo(() => rig?.anims ?? [], [rig]);

	// Why no chibi plays, or null while one plays or is still loading.
	let message: string | null = null;
	if (indexState === "failed" || playerFailed) {
		message = LOAD_FAILED;
	} else if (indexState === "ready" && !rig) {
		message = missingMessage;
	} else if (rig && !drawable) {
		message = ON_THEIR_WAY;
	} else if (current !== null && current.outcome !== "ready") {
		message = current.outcome === "unsupported" ? ON_THEIR_WAY : LOAD_FAILED;
	}
	const loading = message === null && !ready;

	// The runtime is fetched the first time a rig can play, so a page with none never downloads it.
	useEffect(() => {
		if (!drawable || playerModule) {
			return;
		}
		let active = true;
		import("../spine/player.js").then(
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
		if (!player || !rig || rigKey === null || !urls || !drawable) {
			return;
		}
		const controller = new AbortController();
		player
			.load(urls, controller.signal)
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
				const first = Math.max(0, rig.anims.indexOf(startAnimation));
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
	}, [player, rig, rigKey, urls, drawable, startAnimation, resetZoom]);

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
		onStatus({ hasBack, caption: ready && name !== undefined ? `${name} - ${animIndex + 1} / ${anims.length}` : null });
	}, [onStatus, hasBack, ready, anims, animIndex]);

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
				<canvas ref={canvasRef} style={CANVAS_STYLE} aria-label={canvasLabel} />
			</Box>
			{message !== null ? renderPlaceholder(message) : null}
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
 * taking down the page. The guard resets when `guardKey` changes.
 *
 * @param props Component props.
 * @returns The guarded stage.
 */
export default function SpineStage(props: SpineStageProps) {
	return (
		<ErrorBoundary key={props.guardKey} fallback={props.renderPlaceholder(LOAD_FAILED)}>
			<LiveStage {...props} />
		</ErrorBoundary>
	);
}
