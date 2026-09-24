// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Spine stage

/**
 * The live animation inside the Animations card, for any subject. The caller picks the rig and builds its URLs, and archive-kit's
 * `AnimationStage` plays it through the runtime in `src/spine/`. It shows the caller's placeholder when the index fails, there is no rig, or
 * the runtime cannot draw the rig yet.
 */

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { AnimationStage } from "archive-kit";
import type { StageEntry } from "archive-kit";

import { animationEntries } from "../lib/animations.js";
import { SUPPORTED_STAGE } from "../spine/features.js";
import type { RigUrls } from "../spine/player.js";
import { createSpineRuntime, UNSUPPORTED_MESSAGE } from "../spine/stageRuntime.js";
import type { SpineSource } from "../spine/stageRuntime.js";
import type { SpineRig } from "../types/spine.js";
import { STAGE_SX } from "./AnimationsCard.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Shown when the rig index fails to load, in the same words the stage uses for a rig that fails. */
const INDEX_FAILED = "Couldn't load this animation.";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Types

/** Where a rig index's fetch stands. */
export type RigIndexState = "loading" | "ready" | "failed";

/** Props for SpineStage. */
export interface SpineStageProps {
	/** The selected rig's identity, such as `char_002_amiya/base/battle`, or null when there is no rig. */
	rigKey: string | null;
	/** The selected rig, or null when there is none. */
	rig: SpineRig | null;
	/** The selected rig's file URLs, stable across renders for the same rig, or null when there is no rig. */
	urls: RigUrls | null;
	/** Where the rig index's fetch stands. The missing-rig message only shows once the index is ready. */
	indexState: RigIndexState;
	/** Shown when the index is ready but names no rig for the selection. */
	missingMessage: string;
	/** Draws the placeholder for a reason no animation plays. */
	renderPlaceholder: (message: string) => ReactNode;
	/** The animation's accessible name. */
	canvasLabel: string;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Fetches a rig index bucket, fetches the new one when `file` changes, and fetches again on the next `retryKey` change after a failure. The
 * loader shares one request across callers.
 *
 * @param load The bucket loader, such as `loadSpineIndexFile`. Must be stable.
 * @param file The bucket that holds the shown operator or enemy.
 * @param retryKey Changes when the selection changes, which is when a failed fetch is retried.
 * @returns The bucket once loaded, and where the fetch stands.
 */
export function useRigIndex<T>(load: (file: string) => Promise<T>, file: string, retryKey: string): { index: T | null; state: RigIndexState } {
	const [loaded, setLoaded] = useState<{ file: string; index: T } | null>(null);
	const [failed, setFailed] = useState(false);
	const index = loaded?.file === file ? loaded.index : null;
	useEffect(() => {
		if (index !== null) {
			return;
		}
		let active = true;
		setFailed(false);
		load(file).then(
			(next) => {
				if (active) {
					setLoaded({ file, index: next });
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
	}, [index, load, file, retryKey]);
	return { index, state: index !== null ? "ready" : failed ? "failed" : "loading" };
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Component

/**
 * Plays the given rig on archive-kit's stage. A tap steps through `animationEntries` order, starting on Idle, or on Relax for a dorm rig.
 *
 * @param props Component props.
 * @returns The stage and its caption.
 */
export default function SpineStage({ rigKey, rig, urls, indexState, missingMessage, renderPlaceholder, canvasLabel }: SpineStageProps) {
	const drawable = rig !== null && rig.stage <= SUPPORTED_STAGE;
	// What a tap steps through: Defaults dropped, each wind-up, middle and wind-down merged into one move, Idle first. See `animationEntries`.
	const animations = useMemo(() => (rig ? animationEntries(rig.anims) : []), [rig]);
	const entries = useMemo<StageEntry[]>(() => animations.map((entry, position) => ({ key: String(position), label: entry.label })), [animations]);
	const source = useMemo<SpineSource | null>(() => (drawable && urls ? { urls, entries: animations } : null), [drawable, urls, animations]);

	// Why no animation plays, or null while one plays or is still loading.
	let notice: string | null = null;
	if (indexState === "failed") {
		notice = INDEX_FAILED;
	} else if (indexState === "ready" && !rig) {
		notice = missingMessage;
	} else if (rig && !drawable) {
		notice = UNSUPPORTED_MESSAGE;
	}

	return (
		<AnimationStage
			runtime={createSpineRuntime}
			source={source}
			sourceKey={source ? rigKey : null}
			entries={entries}
			notice={notice}
			label={canvasLabel}
			renderMessage={renderPlaceholder}
			sx={STAGE_SX}
		/>
	);
}
