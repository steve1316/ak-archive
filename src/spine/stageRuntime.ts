// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Stage runtime

/**
 * The runtime in this folder, wrapped for archive-kit's `AnimationStage`. The stage owns the frame loop, the zoom and the caption, and this
 * turns its calls into `SpinePlayer` calls. The player module loads the first time a stage asks for it, so a page with no rig never downloads it.
 */

import type { StageRuntime } from "archive-kit";

import type { AnimationEntry } from "../lib/animations.js";
import { isSupported } from "./features.js";
import type { RigUrls, SpinePlayer } from "./player.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Shown when a rig needs a feature this runtime has not been built for yet. */
export const UNSUPPORTED_MESSAGE = "This animation isn't supported yet.";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Types

/** What the stage loads: one rig's files, and the entries a tap steps through. An entry's key is its position in `entries`. */
export interface SpineSource {
	/** The rig's file URLs. */
	urls: RigUrls;
	/** The rig's merged animation entries, in `animationEntries` order. */
	entries: readonly AnimationEntry[];
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Runtime

/**
 * Frees a canvas's WebGL context at once rather than waiting for garbage collection, since browsers cap how many can be live.
 *
 * @param canvas The canvas whose context to release.
 */
function releaseContext(canvas: HTMLCanvasElement): void {
	canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
}

/**
 * Builds the runtime inside the stage: one canvas and one `SpinePlayer` for every rig the stage shows, so a rig switch reuses the WebGL context.
 *
 * @param host The stage's host element, which the canvas fills.
 * @returns The runtime.
 */
export async function createSpineRuntime(host: HTMLElement): Promise<StageRuntime<SpineSource>> {
	const module = await import("./player.js");
	const canvas = document.createElement("canvas");
	host.appendChild(canvas);
	let player: SpinePlayer;
	try {
		player = new module.SpinePlayer(canvas);
	} catch (error) {
		canvas.remove();
		throw error;
	}
	let entries: readonly AnimationEntry[] = [];
	return {
		async load(source, signal) {
			entries = source.entries;
			await player.load(source.urls, signal);
			// A backstop for the index's stage: the parsed skeleton is checked against what the runtime draws.
			const data = player.skeleton?.data;
			return data && isSupported(data) ? null : UNSUPPORTED_MESSAGE;
		},
		play(key) {
			const entry = entries[Number(key)];
			if (entry) {
				player.playSequence(entry.steps);
			}
		},
		// The player sizes the backing store to the canvas's box at the device pixel ratio on every draw, so a resize is just a draw.
		resize() {
			player.render();
		},
		setView(scale, x, y) {
			player.setViewTransform(scale, x, y);
		},
		update(seconds) {
			player.update(seconds);
		},
		dispose() {
			player.dispose();
			releaseContext(canvas);
			canvas.remove();
		}
	};
}
