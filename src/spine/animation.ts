// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Animation

/**
 * Samples an animation's timelines at a time and writes the result into a live skeleton's bones. `MATH.md` ("Animation") explains the curve,
 * key search and timeline rules and the JSON format page text behind them.
 */

import type { Skeleton } from "./skeleton.js";
import type { Animation, Curve } from "./types.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** How many halvings the bezier search takes. 30 pins the curve parameter to about 1e-9. */
const BEZIER_STEPS = 30;

/** The run starts of a timeline whose key times never go down: one run, starting at key 0. */
const SINGLE_RUN: readonly number[] = [0];

/** The first key of each sorted run of key times, worked out once per `times` array. */
const runStartsCache = new WeakMap<readonly number[], readonly number[]>();

/** The index one past the last key of the run the latest `keyIndex` call searched. Set by `keyIndex`, read right after it. */
let foundRunEnd = 0;

/** The fraction from the found key toward the next one that the latest `keyFraction` call worked out, or 0 when the key holds. */
let foundFraction = 0;

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Curves

/**
 * Evaluates a cubic bezier coordinate from 0 to 1 with control values `p1` and `p2`, at curve parameter `s`.
 *
 * @param p1 The first control point's coordinate.
 * @param p2 The second control point's coordinate.
 * @param s The curve parameter, 0 to 1.
 * @returns The coordinate at `s`.
 */
function bezierAt(p1: number, p2: number, s: number): number {
	const u = 1 - s;
	return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s;
}

/**
 * Eases a time fraction between two keys into a value fraction. A bezier runs from (0, 0) to (1, 1) with x as time and y as value. The
 * parameter whose x equals `t` is found by bisection. A `t` at or past either end gives exactly 0 or 1.
 *
 * @param curve The curve from one key to the next.
 * @param t The time fraction between the two keys, 0 to 1.
 * @returns The value fraction. A bezier may overshoot [0, 1].
 */
export function curveValue(curve: Curve, t: number): number {
	if (curve === "linear") {
		return t;
	}
	if (curve === "stepped") {
		return 0;
	}
	// The ends are exact. A control x outside [0, 1] can make the search land on a far crossing of x = 0 or x = 1.
	if (t <= 0) {
		return 0;
	}
	if (t >= 1) {
		return 1;
	}
	const [cx1, cy1, cx2, cy2] = curve.bezier;
	let low = 0;
	let high = 1;
	for (let step = 0; step < BEZIER_STEPS; step++) {
		const middle = (low + high) / 2;
		if (bezierAt(cx1, cx2, middle) < t) {
			low = middle;
		} else {
			high = middle;
		}
	}
	return bezierAt(cy1, cy2, (low + high) / 2);
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Key search

/**
 * Gives the first key of each maximal run of non-decreasing key times. Most timelines have one run. Some upstream slot and deform timelines
 * join 2 or 3 runs end to end (see `FORMAT-3.8.md`). The result is cached per `times` array, so later calls allocate nothing.
 *
 * @param times The key times.
 * @returns The index of each run's first key, in order.
 */
function runStarts(times: readonly number[]): readonly number[] {
	const cached = runStartsCache.get(times);
	if (cached) {
		return cached;
	}
	let starts: number[] | null = null;
	for (let i = 1; i < times.length; i++) {
		if (times[i]! < times[i - 1]!) {
			starts ??= [0];
			starts.push(i);
		}
	}
	const result = starts ?? SINGLE_RUN;
	runStartsCache.set(times, result);
	return result;
}

/**
 * Finds the key that applies at a time and sets `foundRunEnd` to the end of its run. The last run whose first key is at or before the time
 * wins, and inside it the last key at or before the time. See `MATH.md` for the sorted runs rule.
 *
 * @param times The key times, which may hold several sorted runs.
 * @param time The time, in seconds.
 * @returns The key's index, or -1 when no run starts at or before the time.
 */
export function keyIndex(times: readonly number[], time: number): number {
	if (times.length === 0) {
		return -1;
	}
	const starts = runStarts(times);
	let run = starts.length - 1;
	while (run >= 0 && times[starts[run]!]! > time) {
		run--;
	}
	if (run < 0) {
		return -1;
	}
	const end = run + 1 < starts.length ? starts[run + 1]! : times.length;
	foundRunEnd = end;
	// Binary search for the first key after the time. The key before it is the last one at or before the time, the last of any equal times.
	let low = starts[run]! + 1;
	let high = end;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (times[middle]! <= time) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low - 1;
}

/**
 * Finds the key that applies at a time and sets `foundFraction` to the eased fraction toward the next key. The last key of a run holds.
 *
 * @param times The key times.
 * @param curves The curve from each key to the next.
 * @param time The time, in seconds.
 * @returns The key's index, or -1 when the timeline does not apply yet.
 */
function keyFraction(times: readonly number[], curves: readonly Curve[], time: number): number {
	const index = keyIndex(times, time);
	if (index < 0) {
		return -1;
	}
	if (index + 1 >= foundRunEnd) {
		foundFraction = 0;
		return index;
	}
	const start = times[index]!;
	foundFraction = curveValue(curves[index]!, (time - start) / (times[index + 1]! - start));
	return index;
}

/**
 * Blends two key values by `foundFraction`. A key that holds has no next key, so it gives its own value.
 *
 * @param values The key values.
 * @param index The key found by `keyFraction`.
 * @returns The blended value.
 */
function blend(values: readonly number[], index: number): number {
	const value = values[index]!;
	return foundFraction === 0 ? value : value + (values[index + 1]! - value) * foundFraction;
}

/**
 * Blends two key angles by `foundFraction` the short way round: the difference is wrapped into [-180, 180) first.
 *
 * @param angles The key angles in degrees.
 * @param index The key found by `keyFraction`.
 * @returns The blended angle in degrees.
 */
function blendAngle(angles: readonly number[], index: number): number {
	const angle = angles[index]!;
	if (foundFraction === 0) {
		return angle;
	}
	const difference = angles[index + 1]! - angle;
	return angle + (difference - 360 * Math.floor((difference + 180) / 360)) * foundFraction;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Applying

/**
 * Maps a play time onto an animation's own time.
 *
 * @param animation The animation.
 * @param time The time since the animation started, in seconds.
 * @param loop True to wrap round at the end, false to stop on the last frame.
 * @returns The time within the animation, from 0 to its duration. A NaN time gives 0, and so does an infinite one when looping.
 */
export function loopTime(animation: Animation, time: number, loop: boolean): number {
	const duration = animation.duration;
	if (duration <= 0 || Number.isNaN(time)) {
		return 0;
	}
	if (!loop) {
		return time < 0 ? 0 : Math.min(time, duration);
	}
	if (!Number.isFinite(time)) {
		return 0;
	}
	const wrapped = time % duration;
	return wrapped < 0 ? wrapped + duration : wrapped;
}

/**
 * Poses a skeleton's bones at a time in an animation. Each bone timeline writes its bone's local transform from the setup values: rotate,
 * translate and shear add to them, scale multiplies them. A timeline whose first key is after `time` leaves its bone alone. Constraint,
 * deform and event timelines are skipped. Allocates nothing once each timeline has been seen. Call `updateWorldTransform` after.
 *
 * @param skeleton The skeleton, just reset by `setToSetupPose`.
 * @param animation The animation to sample.
 * @param time The time within the animation, in seconds. See `loopTime`.
 */
export function applyAnimation(skeleton: Skeleton, animation: Animation, time: number): void {
	const bones = skeleton.bones;
	const timelines = animation.timelines;
	for (let i = 0; i < timelines.length; i++) {
		const timeline = timelines[i]!;
		switch (timeline.type) {
			case "rotate": {
				const index = keyFraction(timeline.times, timeline.curves, time);
				if (index >= 0) {
					const bone = bones[timeline.boneIndex]!;
					bone.rotation = bone.data.rotation + blendAngle(timeline.angles, index);
				}
				break;
			}
			case "translate":
			case "scale":
			case "shear": {
				const index = keyFraction(timeline.times, timeline.curves, time);
				if (index < 0) {
					break;
				}
				const bone = bones[timeline.boneIndex]!;
				const x = blend(timeline.x, index);
				const y = blend(timeline.y, index);
				const data = bone.data;
				if (timeline.type === "translate") {
					bone.x = data.x + x;
					bone.y = data.y + y;
				} else if (timeline.type === "scale") {
					bone.scaleX = data.scaleX * x;
					bone.scaleY = data.scaleY * y;
				} else {
					bone.shearX = data.shearX + x;
					bone.shearY = data.shearY + y;
				}
				break;
			}
			case "attachment":
			case "color":
			case "twoColor":
			case "drawOrder":
				// Slot and draw order timelines are not applied yet. The setup values stay.
				break;
			default:
				// Constraint, deform and event timelines are skipped.
				break;
		}
	}
}
