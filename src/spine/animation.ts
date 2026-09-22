// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Animation

/**
 * Samples an animation's timelines at a time and writes the result into a live skeleton's bones, slots and draw order. `MATH.md`
 * ("Animation") explains the curve, key search and timeline rules and the JSON format page text behind them.
 */

import { deformSource } from "./geometry.js";
import { deformLengthOf, deformableVertices } from "./skeleton.js";
import type { Skeleton, Slot } from "./skeleton.js";
import type { Animation, Color, Curve, DeformTimeline, DrawOrderChange } from "./types.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Types

/** Working space for building one skeleton's draw order. Both arrays are all empty between uses. */
interface DrawOrderScratch {
	/** The slot put at each draw order place so far, or null for a free place. */
	placed: (Slot | null)[];
	/** 1 for each slot index a draw order key moves, else 0. */
	moved: Uint8Array;
}

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

/**
 * Scratch for the eased fraction. Slot `FRACTION` holds the fraction from the found key toward the next one that the latest `easeInto`
 * or `keyFraction` call worked out, or 0 when the key holds. A typed array stores the double in place, where a module `let` would box a
 * new number on every write once the writer is not inlined.
 */
const found = new Float64Array(1);

/** The slot in `found` that holds the eased fraction. */
const FRACTION = 0;

/** Per-skeleton scratch for building a draw order, made once so applying a draw order key allocates nothing. */
const drawOrderScratch = new WeakMap<Skeleton, DrawOrderScratch>();

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Curves

/**
 * Eases the time fraction in `found[FRACTION]` into a value fraction and writes it back there. A bezier runs from (0, 0) to (1, 1) with x
 * as time and y as value. The parameter whose x equals the time fraction is found by bisection. A fraction at or past either end gives
 * exactly 0 or 1. The fraction goes in and out through `found`, so no number crosses a call that may not be inlined, where it would be boxed.
 *
 * @param curve The curve from one key to the next.
 */
function easeInto(curve: Curve): void {
	if (curve === "linear") {
		return;
	}
	const t = found[FRACTION]!;
	// The ends are exact. A control x outside [0, 1] can make the search land on a far crossing of x = 0 or x = 1.
	if (curve === "stepped" || t <= 0) {
		found[FRACTION] = 0;
		return;
	}
	if (t >= 1) {
		found[FRACTION] = 1;
		return;
	}
	const bezier = curve.bezier;
	const cx1 = bezier[0];
	const cx2 = bezier[2];
	let low = 0;
	let high = 1;
	for (let step = 0; step < BEZIER_STEPS; step++) {
		const s = (low + high) / 2;
		const u = 1 - s;
		if (3 * u * u * s * cx1 + 3 * u * s * s * cx2 + s * s * s < t) {
			low = s;
		} else {
			high = s;
		}
	}
	const s = (low + high) / 2;
	const u = 1 - s;
	found[FRACTION] = 3 * u * u * s * bezier[1] + 3 * u * s * s * bezier[3] + s * s * s;
}

/**
 * Eases a time fraction between two keys into a value fraction, as `easeInto` does.
 *
 * @param curve The curve from one key to the next.
 * @param t The time fraction between the two keys, 0 to 1.
 * @returns The value fraction. A bezier may overshoot [0, 1].
 */
export function curveValue(curve: Curve, t: number): number {
	found[FRACTION] = t;
	easeInto(curve);
	return found[FRACTION]!;
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
 * Finds the key that applies at a time and sets `found[FRACTION]` to the eased fraction toward the next key. The last key of a run holds.
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
		found[FRACTION] = 0;
		return index;
	}
	const start = times[index]!;
	found[FRACTION] = (time - start) / (times[index + 1]! - start);
	easeInto(curves[index]!);
	return index;
}

/**
 * Writes two key colors blended by `found[FRACTION]` into a color in place, channel by channel, each clamped to [0, 1]. Alpha is left
 * alone when `withAlpha` is false.
 *
 * @param target The color to write.
 * @param colors The key colors.
 * @param index The key found by `keyFraction`.
 * @param withAlpha True to write alpha too.
 */
function blendColor(target: Color, colors: readonly Color[], index: number, withAlpha: boolean): void {
	const from = colors[index]!;
	const t = found[FRACTION]!;
	if (t === 0) {
		target.r = from.r;
		target.g = from.g;
		target.b = from.b;
		if (withAlpha) {
			target.a = from.a;
		}
		return;
	}
	// A bezier that overshoots its two keys would push a channel past either end, so each channel is clamped.
	const to = colors[index + 1]!;
	target.r = Math.min(1, Math.max(0, from.r + (to.r - from.r) * t));
	target.g = Math.min(1, Math.max(0, from.g + (to.g - from.g) * t));
	target.b = Math.min(1, Math.max(0, from.b + (to.b - from.b) * t));
	if (withAlpha) {
		target.a = Math.min(1, Math.max(0, from.a + (to.a - from.a) * t));
	}
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Draw order

/**
 * Gives a skeleton's draw order scratch, made on first use.
 *
 * @param skeleton The skeleton.
 * @returns The scratch, cleared.
 */
function scratchFor(skeleton: Skeleton): DrawOrderScratch {
	const count = skeleton.slots.length;
	let scratch = drawOrderScratch.get(skeleton);
	if (!scratch || scratch.placed.length !== count) {
		scratch = { placed: new Array<Slot | null>(count).fill(null), moved: new Uint8Array(count) };
		drawOrderScratch.set(skeleton, scratch);
	}
	return scratch;
}

/**
 * Writes a draw order key into the skeleton's own draw order. Each changed slot goes to its setup index plus its offset, and the other
 * slots fill the free places in setup order. No changes means the setup order. A key that moves a slot twice, out of range, or onto a place
 * another slot already took leaves the setup order, so the draw order is always a permutation.
 *
 * @param skeleton The skeleton.
 * @param changes The key's slot moves.
 */
function applyDrawOrder(skeleton: Skeleton, changes: readonly DrawOrderChange[]): void {
	const slots = skeleton.slots;
	const drawOrder = skeleton.drawOrder;
	const count = slots.length;
	const { placed, moved } = scratchFor(skeleton);
	let valid = true;
	for (let i = 0; i < changes.length; i++) {
		const { slotIndex, offset } = changes[i]!;
		const target = slotIndex + offset;
		if (slotIndex < 0 || slotIndex >= count || moved[slotIndex] === 1 || target < 0 || target >= count || placed[target] !== null) {
			valid = false;
			break;
		}
		placed[target] = slots[slotIndex]!;
		moved[slotIndex] = 1;
	}
	if (valid && changes.length > 0) {
		// Walk the slots in setup order, skip the moved ones, and put each other slot in the next free place.
		let free = 0;
		for (let index = 0; index < count; index++) {
			if (moved[index] === 1) {
				continue;
			}
			while (placed[free] !== null) {
				free++;
			}
			placed[free] = slots[index]!;
		}
		for (let index = 0; index < count; index++) {
			drawOrder[index] = placed[index]!;
		}
	} else {
		for (let index = 0; index < count; index++) {
			drawOrder[index] = slots[index]!;
		}
	}
	placed.fill(null);
	moved.fill(0);
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Deform

/**
 * Applies a deform timeline to its slot when the slot shows the timeline's attachment, or a linked mesh that takes its deforms. The key's
 * offsets, blended toward the next key's by the eased fraction, are written into `slot.deform`. Offsets outside a key's stored range are 0.
 *
 * @param skeleton The skeleton.
 * @param timeline The deform timeline.
 * @param time The time within the animation, in seconds.
 */
function applyDeform(skeleton: Skeleton, timeline: DeformTimeline, time: number): void {
	const slotIndex = timeline.slotIndex;
	const slot = skeleton.slots[slotIndex];
	const shown = slot?.attachment;
	if (!slot || !shown) {
		return;
	}
	const data = skeleton.data;
	const target = data.skins[timeline.skinIndex]?.attachments.get(slotIndex)?.get(timeline.attachmentName);
	if (!target || deformSource(skeleton, slotIndex, shown) !== target) {
		return;
	}
	const vertices = deformableVertices(data, slotIndex, target);
	if (!vertices) {
		return;
	}
	const length = deformLengthOf(vertices);
	const deform = slot.deform;
	if (deform.length < length) {
		return;
	}
	const index = keyFraction(timeline.times, timeline.curves, time);
	if (index < 0) {
		return;
	}
	// Write the key's own offsets, then move each toward the next key's.
	const from = timeline.values[index]!;
	const fromStart = timeline.starts[index]!;
	deform.fill(0, 0, length);
	for (let j = 0; j < from.length && fromStart + j < length; j++) {
		deform[fromStart + j] = from[j]!;
	}
	const fraction = found[FRACTION]!;
	if (fraction !== 0) {
		const to = timeline.values[index + 1]!;
		const toStart = timeline.starts[index + 1]!;
		const toEnd = toStart + to.length;
		for (let j = 0; j < length; j++) {
			const next = j >= toStart && j < toEnd ? to[j - toStart]! : 0;
			deform[j] = deform[j]! + (next - deform[j]!) * fraction;
		}
	}
	slot.deformLength = length;
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
 * Poses a skeleton at a time in an animation, applying its timelines in file order. Each bone timeline writes its bone's local transform
 * from the setup values: rotate, translate and shear add to them, scale multiplies them. Slot timelines set a slot's attachment or replace
 * its colors, and a draw order timeline rewrites the draw order in place. An IK timeline sets its constraint's mix, softness, bend
 * direction, compress and stretch. A deform timeline writes its slot's vertex offsets. A timeline whose first key is after `time` leaves
 * its bone, slot, constraint or draw order alone. Transform, path and event timelines are skipped. Once each timeline and skeleton has
 * been seen, it allocates nothing: the eased fraction lives in a typed array, no hot helper returns a number, and the draw order work
 * arrays are kept per skeleton. Colors and deform offsets are written into the slot's own objects. Call `updateWorldTransform` after.
 *
 * @param skeleton The skeleton, just reset by `setToSetupPose`.
 * @param animation The animation to sample.
 * @param time The time within the animation, in seconds. See `loopTime`.
 */
export function applyAnimation(skeleton: Skeleton, animation: Animation, time: number): void {
	const bones = skeleton.bones;
	const slots = skeleton.slots;
	const timelines = animation.timelines;
	for (let i = 0; i < timelines.length; i++) {
		const timeline = timelines[i]!;
		switch (timeline.type) {
			case "rotate": {
				const index = keyFraction(timeline.times, timeline.curves, time);
				if (index < 0) {
					break;
				}
				// Blend the short way round: the difference is wrapped into [-180, 180) first.
				const angles = timeline.angles;
				const fraction = found[FRACTION]!;
				let angle = angles[index]!;
				if (fraction !== 0) {
					const difference = angles[index + 1]! - angle;
					angle += (difference - 360 * Math.floor((difference + 180) / 360)) * fraction;
				}
				const bone = bones[timeline.boneIndex]!;
				bone.rotation = bone.data.rotation + angle;
				break;
			}
			case "translate":
			case "scale":
			case "shear": {
				const index = keyFraction(timeline.times, timeline.curves, time);
				if (index < 0) {
					break;
				}
				// A key that holds has no next key, so it gives its own value.
				const fraction = found[FRACTION]!;
				const xs = timeline.x;
				const ys = timeline.y;
				let x = xs[index]!;
				let y = ys[index]!;
				if (fraction !== 0) {
					x += (xs[index + 1]! - x) * fraction;
					y += (ys[index + 1]! - y) * fraction;
				}
				const bone = bones[timeline.boneIndex]!;
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
			case "attachment": {
				// Attachment keys are always stepped, so only the key itself matters.
				const index = keyIndex(timeline.times, time);
				if (index >= 0) {
					skeleton.setAttachment(timeline.slotIndex, timeline.names[index] ?? null);
				}
				break;
			}
			case "color": {
				const index = keyFraction(timeline.times, timeline.curves, time);
				if (index >= 0) {
					blendColor(slots[timeline.slotIndex]!.color, timeline.colors, index, true);
				}
				break;
			}
			case "twoColor": {
				const index = keyFraction(timeline.times, timeline.curves, time);
				if (index < 0) {
					break;
				}
				const slot = slots[timeline.slotIndex]!;
				blendColor(slot.color, timeline.lights, index, true);
				// The dark alpha has no meaning. A slot with no dark color of its own ignores the dark keys.
				if (slot.darkColor !== null) {
					blendColor(slot.darkColor, timeline.darks, index, false);
				}
				break;
			}
			case "drawOrder": {
				const index = keyIndex(timeline.times, time);
				if (index >= 0) {
					applyDrawOrder(skeleton, timeline.changes[index]!);
				}
				break;
			}
			case "ik": {
				const index = keyFraction(timeline.times, timeline.curves, time);
				if (index < 0) {
					break;
				}
				// Mix and softness blend along the curve. Bend direction, compress and stretch hold from the key.
				const fraction = found[FRACTION]!;
				const mixes = timeline.mixes;
				const softness = timeline.softness;
				let mix = mixes[index]!;
				let soft = softness[index]!;
				if (fraction !== 0) {
					mix += (mixes[index + 1]! - mix) * fraction;
					soft += (softness[index + 1]! - soft) * fraction;
				}
				const constraint = skeleton.ikConstraints[timeline.constraintIndex]!;
				constraint.mix = mix;
				constraint.softness = soft;
				constraint.bendDirection = timeline.bendDirections[index]!;
				constraint.compress = timeline.compress[index]!;
				constraint.stretch = timeline.stretch[index]!;
				break;
			}
			case "deform":
				applyDeform(skeleton, timeline, time);
				break;
			default:
				// Transform, path and event timelines are skipped.
				break;
		}
	}
}
