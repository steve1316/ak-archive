// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Paths

/**
 * Path attachments as curves in world space. A path's vertices come in triplets, handle in, knot, handle out, one per knot, and curve k is
 * the cubic Bezier from knot k through its out handle and the next knot's in handle to the next knot. An open path has one curve fewer than
 * it has knots, and a closed one joins the last knot back to the first. Each curve is measured by summing chords at `CURVE_SAMPLES` evenly
 * spaced parameters, and a distance along the path is found in that table. Past either end of an open path, the path carries on in a
 * straight line along the end's direction. `MATH.md` ("Paths") records the readings and the corpus evidence.
 */

import { computeWorldVertices } from "./geometry.js";
import type { Skeleton, Slot } from "./skeleton.js";
import type { MeshVertices, PathAttachment } from "./types.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Chords summed per curve for its arc length. 32 keeps a quarter circle within 0.02% of its true length. */
const CURVE_SAMPLES = 32;

/** A length below this counts as zero, so no direction can be taken from it. */
const EPSILON = 1e-9;

/** Scratch for one curve evaluation: the point's x and y, then the derivative's x and y. A typed array keeps the doubles unboxed. */
const curveScratch = new Float64Array(4);

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Types

/** One path attachment's working buffers, sized once for its vertex count and refilled by `samplePath` each frame. */
export interface PathSampler {
	/** The path's world vertices, flattened as x0, y0, x1, y1, ... */
	world: Float32Array;
	/** Cumulative arc length at each sample: entry `k * CURVE_SAMPLES + s` is the length up to parameter `s / CURVE_SAMPLES` of curve `k`. */
	table: Float64Array;
	/** How many curves the path has: one fewer than its knots when open, as many when closed. */
	curves: number;
	/** The path's total length after the last `samplePath`. */
	total: number;
	/** True when the last knot joins back to the first. */
	closed: boolean;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Counts a path's vertices. Plain vertices hold two numbers each. Weighted ones are groups, each starting with its influence count.
 *
 * @param vertices The path's vertices.
 * @returns The vertex count.
 */
function vertexCount(vertices: MeshVertices): number {
	if (!vertices.weighted) {
		return vertices.values.length / 2;
	}
	const influences = vertices.bones;
	let count = 0;
	for (let b = 0; b < influences.length; b += influences[b]! + 1) {
		count++;
	}
	return count;
}

/**
 * Evaluates one curve at a parameter into `curveScratch`: the point, then the derivative. Control points are vertices `3k+1` to `3k+4` of
 * the world vertices, wrapping on a closed path. `P(t) = u^3 P0 + 3u^2 t P1 + 3u t^2 P2 + t^3 P3` and
 * `P'(t) = 3u^2 (P1 - P0) + 6ut (P2 - P1) + 3t^2 (P3 - P2)`, with `u = 1 - t`.
 *
 * @param world The path's world vertices.
 * @param curve The curve's index.
 * @param t The parameter, from 0 to 1.
 */
function evaluateCurve(world: Float32Array, curve: number, t: number): void {
	const count = world.length / 2;
	const i0 = ((3 * curve + 1) % count) * 2;
	const i1 = ((3 * curve + 2) % count) * 2;
	const i2 = ((3 * curve + 3) % count) * 2;
	const i3 = ((3 * curve + 4) % count) * 2;
	const x0 = world[i0]!;
	const y0 = world[i0 + 1]!;
	const x1 = world[i1]!;
	const y1 = world[i1 + 1]!;
	const x2 = world[i2]!;
	const y2 = world[i2 + 1]!;
	const x3 = world[i3]!;
	const y3 = world[i3 + 1]!;
	const u = 1 - t;
	const uu = u * u;
	const tt = t * t;
	curveScratch[0] = uu * u * x0 + 3 * uu * t * x1 + 3 * u * tt * x2 + tt * t * x3;
	curveScratch[1] = uu * u * y0 + 3 * uu * t * y1 + 3 * u * tt * y2 + tt * t * y3;
	curveScratch[2] = 3 * uu * (x1 - x0) + 6 * u * t * (x2 - x1) + 3 * tt * (x3 - x2);
	curveScratch[3] = 3 * uu * (y1 - y0) + 6 * u * t * (y2 - y1) + 3 * tt * (y3 - y2);
}

/**
 * Writes a point a distance along a straight line from a vertex, heading from one vertex toward another. When those two coincide, the
 * direction falls back to heading from a third vertex toward the fourth.
 *
 * @param world The path's world vertices.
 * @param base Index of the vertex the line starts from.
 * @param from Index of the vertex the direction heads from.
 * @param to Index of the vertex the direction heads toward.
 * @param fallbackFrom Index of the vertex the fallback direction heads from.
 * @param fallbackTo Index of the vertex the fallback direction heads toward.
 * @param distance How far along the line, which may be negative.
 * @param out The array to write `x, y, angle` into.
 * @param offset Where in `out` to write.
 */
function writeLine(world: Float32Array, base: number, from: number, to: number, fallbackFrom: number, fallbackTo: number, distance: number, out: Float64Array, offset: number): void {
	let dx = world[to * 2]! - world[from * 2]!;
	let dy = world[to * 2 + 1]! - world[from * 2 + 1]!;
	if (dx * dx + dy * dy < EPSILON * EPSILON) {
		dx = world[fallbackTo * 2]! - world[fallbackFrom * 2]!;
		dy = world[fallbackTo * 2 + 1]! - world[fallbackFrom * 2 + 1]!;
	}
	const length = Math.sqrt(dx * dx + dy * dy);
	const ux = length > EPSILON ? dx / length : 1;
	const uy = length > EPSILON ? dy / length : 0;
	out[offset] = world[base * 2]! + ux * distance;
	out[offset + 1] = world[base * 2 + 1]! + uy * distance;
	out[offset + 2] = Math.atan2(uy, ux);
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Sampling

/**
 * Makes the working buffers for one path attachment.
 *
 * @param attachment The path attachment.
 * @returns The sampler, empty until `samplePath` fills it.
 */
export function createPathSampler(attachment: PathAttachment): PathSampler {
	const count = vertexCount(attachment.vertices);
	const knots = Math.floor(count / 3);
	const curves = Math.max(0, attachment.closed ? knots : knots - 1);
	return { world: new Float32Array(count * 2), table: new Float64Array(curves * CURVE_SAMPLES + 1), curves, total: 0, closed: attachment.closed };
}

/**
 * Places a path in world space for the current pose and measures it: the world vertices with the slot's deform applied, then the cumulative
 * chord length at every sample of every curve.
 *
 * @param sampler The path's sampler, from `createPathSampler`.
 * @param skeleton The posed skeleton.
 * @param slot The slot showing the path.
 * @param attachment The path attachment the sampler was made for.
 */
export function samplePath(sampler: PathSampler, skeleton: Skeleton, slot: Slot, attachment: PathAttachment): void {
	const world = sampler.world;
	computeWorldVertices(skeleton, slot, attachment.vertices, world);
	const table = sampler.table;
	table[0] = 0;
	let length = 0;
	let previousX = 0;
	let previousY = 0;
	for (let curve = 0; curve < sampler.curves; curve++) {
		evaluateCurve(world, curve, 0);
		previousX = curveScratch[0]!;
		previousY = curveScratch[1]!;
		for (let s = 1; s <= CURVE_SAMPLES; s++) {
			evaluateCurve(world, curve, s / CURVE_SAMPLES);
			const dx = curveScratch[0]! - previousX;
			const dy = curveScratch[1]! - previousY;
			length += Math.sqrt(dx * dx + dy * dy);
			previousX = curveScratch[0]!;
			previousY = curveScratch[1]!;
			table[curve * CURVE_SAMPLES + s] = length;
		}
	}
	sampler.total = length;
}

/**
 * Finds the point and direction a distance along a sampled path. A closed path wraps the distance into its length both ways. An open path
 * carries on in a straight line past either end: before the start along the first knot's out handle, and past the end along the last
 * knot's in handle. A path with no length gives its first knot, facing along +X.
 *
 * @param sampler The path's sampler, after `samplePath`.
 * @param distance The distance along the path from its first knot.
 * @param out The array to write `x, y, angle` into, the angle in radians counterclockwise from +X.
 * @param offset Where in `out` to write.
 */
export function pointAt(sampler: PathSampler, distance: number, out: Float64Array, offset: number): void {
	const world = sampler.world;
	const count = world.length / 2;
	const total = sampler.total;
	if (sampler.curves === 0 || total <= EPSILON) {
		const knot = count > 1 ? 1 : 0;
		out[offset] = world[knot * 2] ?? 0;
		out[offset + 1] = world[knot * 2 + 1] ?? 0;
		out[offset + 2] = 0;
		return;
	}
	if (sampler.closed) {
		distance = ((distance % total) + total) % total;
	} else if (distance < 0) {
		writeLine(world, 1, 1, 2, 1, 4, distance, out, offset);
		return;
	} else if (distance > total) {
		writeLine(world, count - 2, count - 3, count - 2, count - 5, count - 2, distance - total, out, offset);
		return;
	}

	// The last sample at or before the distance.
	const table = sampler.table;
	let low = 0;
	let high = table.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if (table[middle]! <= distance) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}
	const last = table.length - 1;
	const j = Math.min(low, last - 1);
	const curve = Math.min(Math.floor(j / CURVE_SAMPLES), sampler.curves - 1);
	const span = table[j + 1]! - table[j]!;
	const within = span > EPSILON ? (distance - table[j]!) / span : 0;
	const t = (j - curve * CURVE_SAMPLES + within) / CURVE_SAMPLES;
	evaluateCurve(world, curve, t);
	out[offset] = curveScratch[0]!;
	out[offset + 1] = curveScratch[1]!;
	let dx = curveScratch[2]!;
	let dy = curveScratch[3]!;
	if (dx * dx + dy * dy < EPSILON * EPSILON) {
		// A knot whose handle sits on it has no derivative there, so the direction is the chord across this sample.
		const pointX = curveScratch[0]!;
		const pointY = curveScratch[1]!;
		const sampleStart = (j - curve * CURVE_SAMPLES) / CURVE_SAMPLES;
		evaluateCurve(world, curve, sampleStart);
		const startX = curveScratch[0]!;
		const startY = curveScratch[1]!;
		evaluateCurve(world, curve, sampleStart + 1 / CURVE_SAMPLES);
		dx = curveScratch[0]! - startX;
		dy = curveScratch[1]! - startY;
		out[offset] = pointX;
		out[offset + 1] = pointY;
	}
	out[offset + 2] = Math.atan2(dy, dx);
}
