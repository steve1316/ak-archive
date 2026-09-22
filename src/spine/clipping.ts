// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Clipping

/**
 * Plain polygon helpers for clipping attachments: signed area, a convexity test, ear-clipping triangulation and clipping one textured
 * triangle against a convex polygon. They know nothing of Spine. A polygon is a flat array of x, y pairs. `MATH.md` ("Clipping") derives
 * each one. Scratch arrays are kept at module level and grow when needed, so the helpers allocate nothing once warm.
 */

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Scratch

/** The two polygons Sutherland-Hodgman swaps between, as x, y pairs. Each holds up to `3 + clipCount` vertices. */
let clipFrom = new Float64Array(64);
let clipTo = new Float64Array(64);

/** The vertices ear clipping has not cut off yet, as indices into the polygon. */
let remaining = new Int32Array(32);

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Works out twice the signed area of the triangle a, b, c: positive when the corners run counterclockwise, 0 when they are in a line.
 *
 * @param ax Corner a's X.
 * @param ay Corner a's Y.
 * @param bx Corner b's X.
 * @param by Corner b's Y.
 * @param cx Corner c's X.
 * @param cy Corner c's Y.
 * @returns The cross product of `b - a` and `c - a`.
 */
function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
	return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * Checks whether a point is inside the triangle a, b, c or on its edges. The triangle runs counterclockwise.
 *
 * @param px The point's X.
 * @param py The point's Y.
 * @param ax Corner a's X.
 * @param ay Corner a's Y.
 * @param bx Corner b's X.
 * @param by Corner b's Y.
 * @param cx Corner c's X.
 * @param cy Corner c's Y.
 * @returns True when the point is on the inner side of all three edges.
 */
function inTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
	return cross(ax, ay, bx, by, px, py) >= 0 && cross(bx, by, cx, cy, px, py) >= 0 && cross(cx, cy, ax, ay, px, py) >= 0;
}

/**
 * Checks whether the corner at `remaining[at]` is an ear: it turns counterclockwise, and no other remaining vertex lies in the triangle it
 * makes with its two neighbours. A vertex sitting exactly on one of the three corners is not counted, so repeated points never block.
 *
 * @param polygon The polygon's vertices.
 * @param count How many vertices are still in `remaining`.
 * @param at The corner's place in `remaining`.
 * @returns True when the corner can be cut off.
 */
function isEar(polygon: Float32Array, count: number, at: number): boolean {
	const a = remaining[(at + count - 1) % count]! * 2;
	const b = remaining[at]! * 2;
	const c = remaining[(at + 1) % count]! * 2;
	const ax = polygon[a]!;
	const ay = polygon[a + 1]!;
	const bx = polygon[b]!;
	const by = polygon[b + 1]!;
	const cx = polygon[c]!;
	const cy = polygon[c + 1]!;
	if (cross(ax, ay, bx, by, cx, cy) <= 0) {
		return false;
	}
	for (let k = 0; k < count; k++) {
		const p = remaining[k]! * 2;
		const px = polygon[p]!;
		const py = polygon[p + 1]!;
		if ((px === ax && py === ay) || (px === bx && py === by) || (px === cx && py === cy)) {
			continue;
		}
		if (inTriangle(px, py, ax, ay, bx, by, cx, cy)) {
			return false;
		}
	}
	return true;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Polygons

/**
 * Works out a polygon's signed area with the shoelace formula.
 *
 * @param polygon The vertices, flattened as x0, y0, x1, y1, ...
 * @param count The number of vertices.
 * @returns The area, positive when the vertices run counterclockwise and negative when they run clockwise.
 */
export function signedArea(polygon: Float32Array, count: number): number {
	let twice = 0;
	for (let i = 0, j = count - 1; i < count; j = i++) {
		twice += polygon[j * 2]! * polygon[i * 2 + 1]! - polygon[i * 2]! * polygon[j * 2 + 1]!;
	}
	return twice / 2;
}

/**
 * Finds which way a polygon winds, as a small integer so a caller in the per-frame path never receives a boxed number.
 *
 * @param polygon The vertices, flattened as x0, y0, x1, y1, ...
 * @param count The number of vertices.
 * @returns 1 for counterclockwise, -1 for clockwise, 0 for no area.
 */
export function winding(polygon: Float32Array, count: number): number {
	// The shoelace sum is written out here rather than taken from `signedArea`, whose number return V8 boxes when it is not inlined.
	let twice = 0;
	for (let i = 0, j = count - 1; i < count; j = i++) {
		twice += polygon[j * 2]! * polygon[i * 2 + 1]! - polygon[i * 2]! * polygon[j * 2 + 1]!;
	}
	return twice > 0 ? 1 : twice < 0 ? -1 : 0;
}

/**
 * Removes each vertex that repeats the one before it, including the last vertex when it repeats the first, moving the rest down in place.
 * A repeated vertex makes a zero-length edge, whose turns measure 0 and would hide a concave corner from `isConvex`.
 *
 * @param polygon The vertices, flattened as x0, y0, x1, y1, ..., changed in place.
 * @param count The number of vertices.
 * @returns The number of vertices left.
 */
export function dropRepeats(polygon: Float32Array, count: number): number {
	let kept = 0;
	for (let i = 0; i < count; i++) {
		if (kept > 0 && polygon[i * 2] === polygon[(kept - 1) * 2] && polygon[i * 2 + 1] === polygon[(kept - 1) * 2 + 1]) {
			continue;
		}
		if (kept !== i) {
			polygon[kept * 2] = polygon[i * 2]!;
			polygon[kept * 2 + 1] = polygon[i * 2 + 1]!;
		}
		kept++;
	}
	while (kept > 1 && polygon[(kept - 1) * 2] === polygon[0] && polygon[(kept - 1) * 2 + 1] === polygon[1]) {
		kept--;
	}
	return kept;
}

/**
 * Checks whether a polygon is convex: every corner turns the same way. Corners in a straight line turn neither way and are allowed.
 *
 * @param polygon The vertices, flattened as x0, y0, x1, y1, ...
 * @param count The number of vertices.
 * @returns True when no two corners turn opposite ways.
 */
export function isConvex(polygon: Float32Array, count: number): boolean {
	let left = false;
	let right = false;
	for (let i = 0; i < count; i++) {
		const a = i * 2;
		const b = ((i + 1) % count) * 2;
		const c = ((i + 2) % count) * 2;
		const turn = cross(polygon[a]!, polygon[a + 1]!, polygon[b]!, polygon[b + 1]!, polygon[c]!, polygon[c + 1]!);
		if (turn > 0) {
			left = true;
		} else if (turn < 0) {
			right = true;
		}
	}
	return !(left && right);
}

/**
 * Splits a simple counterclockwise polygon into triangles by ear clipping: cut off a corner whose triangle holds no other vertex, and repeat
 * until 3 vertices are left. A self-intersecting polygon can run out of ears, and then the next corner is cut anyway, so the loop always ends.
 *
 * @param polygon The vertices, flattened as x0, y0, x1, y1, ..., counterclockwise.
 * @param count The number of vertices, at least 3.
 * @param out The array to write, 3 indices per triangle, at least `3 * (count - 2)` long. Each triangle runs counterclockwise.
 * @returns The number of triangles written, `count - 2`.
 */
export function triangulate(polygon: Float32Array, count: number, out: Uint16Array): number {
	if (count < 3) {
		return 0;
	}
	if (remaining.length < count) {
		remaining = new Int32Array(count * 2);
	}
	for (let i = 0; i < count; i++) {
		remaining[i] = i;
	}
	let left = count;
	let triangles = 0;
	while (left > 3) {
		let at = 0;
		while (at < left && !isEar(polygon, left, at)) {
			at++;
		}
		if (at === left) {
			at = 0;
		}
		out[triangles * 3] = remaining[(at + left - 1) % left]!;
		out[triangles * 3 + 1] = remaining[at]!;
		out[triangles * 3 + 2] = remaining[(at + 1) % left]!;
		triangles++;
		remaining.copyWithin(at, at + 1, left);
		left--;
	}
	out[triangles * 3] = remaining[0]!;
	out[triangles * 3 + 1] = remaining[1]!;
	out[triangles * 3 + 2] = remaining[2]!;
	return triangles + 1;
}

/**
 * Checks whether a triangle lies wholly inside a convex counterclockwise polygon, edges included.
 *
 * @param tri The triangle, as x, y, u, v for each of its 3 corners.
 * @param clip The polygon's vertices, flattened as x0, y0, x1, y1, ...
 * @param clipCount The polygon's vertex count.
 * @returns True when every corner is on the inner side of every edge.
 */
export function containsTriangle(tri: Float64Array, clip: Float32Array, clipCount: number): boolean {
	for (let e = 0; e < clipCount; e++) {
		const a = e * 2;
		const b = ((e + 1) % clipCount) * 2;
		const ax = clip[a]!;
		const ay = clip[a + 1]!;
		const bx = clip[b]!;
		const by = clip[b + 1]!;
		if (cross(ax, ay, bx, by, tri[0]!, tri[1]!) < 0 || cross(ax, ay, bx, by, tri[4]!, tri[5]!) < 0 || cross(ax, ay, bx, by, tri[8]!, tri[9]!) < 0) {
			return false;
		}
	}
	return true;
}

/**
 * Checks whether an axis-aligned box lies wholly inside a convex counterclockwise polygon, edges included. Since the polygon is convex, the
 * box is inside when its 4 corners are.
 *
 * @param clip The polygon's vertices, flattened as x0, y0, x1, y1, ...
 * @param clipCount The polygon's vertex count.
 * @param minX The box's least X.
 * @param minY The box's least Y.
 * @param maxX The box's greatest X.
 * @param maxY The box's greatest Y.
 * @returns True when every corner is on the inner side of every edge.
 */
export function containsBox(clip: Float32Array, clipCount: number, minX: number, minY: number, maxX: number, maxY: number): boolean {
	for (let e = 0; e < clipCount; e++) {
		const a = e * 2;
		const b = ((e + 1) % clipCount) * 2;
		const ax = clip[a]!;
		const ay = clip[a + 1]!;
		const bx = clip[b]!;
		const by = clip[b + 1]!;
		if (cross(ax, ay, bx, by, minX, minY) < 0 || cross(ax, ay, bx, by, maxX, minY) < 0 || cross(ax, ay, bx, by, maxX, maxY) < 0 || cross(ax, ay, bx, by, minX, maxY) < 0) {
			return false;
		}
	}
	return true;
}

/**
 * Clips one textured triangle against a convex counterclockwise polygon with Sutherland-Hodgman: the triangle is cut by each edge's line in
 * turn, keeping the part on the inner side. Each kept vertex then gets its UV from its barycentric coordinates in the source triangle. A
 * triangle wholly inside comes back unchanged. The result is convex, so a fan from its first vertex triangulates it.
 *
 * @param tri The triangle, as x, y, u, v for each of its 3 corners.
 * @param clip The polygon's vertices, flattened as x0, y0, x1, y1, ..., counterclockwise and convex.
 * @param clipCount The polygon's vertex count.
 * @param out The array to write, x, y, u, v per vertex, at least `4 * (3 + clipCount)` long.
 * @returns The number of vertices written, 0 when nothing of the triangle is left or it has no area.
 */
export function clipTriangle(tri: Float64Array, clip: Float32Array, clipCount: number, out: Float64Array): number {
	if (containsTriangle(tri, clip, clipCount)) {
		for (let i = 0; i < 12; i++) {
			out[i] = tri[i]!;
		}
		return 3;
	}
	const x0 = tri[0]!;
	const y0 = tri[1]!;
	const e1x = tri[4]! - x0;
	const e1y = tri[5]! - y0;
	const e2x = tri[8]! - x0;
	const e2y = tri[9]! - y0;
	const det = e1x * e2y - e2x * e1y;
	if (det === 0) {
		return 0;
	}
	const size = (3 + clipCount) * 2;
	if (clipFrom.length < size) {
		clipFrom = new Float64Array(size * 2);
		clipTo = new Float64Array(size * 2);
	}
	let from = clipFrom;
	let to = clipTo;
	from[0] = x0;
	from[1] = y0;
	from[2] = tri[4]!;
	from[3] = tri[5]!;
	from[4] = tri[8]!;
	from[5] = tri[9]!;
	let count = 3;
	for (let e = 0; e < clipCount && count > 0; e++) {
		const a = e * 2;
		const b = ((e + 1) % clipCount) * 2;
		const ax = clip[a]!;
		const ay = clip[a + 1]!;
		const bx = clip[b]!;
		const by = clip[b + 1]!;
		let kept = 0;
		let px = from[(count - 1) * 2]!;
		let py = from[(count - 1) * 2 + 1]!;
		let previousSide = cross(ax, ay, bx, by, px, py);
		for (let i = 0; i < count; i++) {
			const cx = from[i * 2]!;
			const cy = from[i * 2 + 1]!;
			const side = cross(ax, ay, bx, by, cx, cy);
			// Only an edge that strictly crosses the line gets a new vertex, so a vertex lying on the line is never written twice.
			if ((previousSide < 0 && side > 0) || (previousSide > 0 && side < 0)) {
				const t = previousSide / (previousSide - side);
				to[kept * 2] = px + (cx - px) * t;
				to[kept * 2 + 1] = py + (cy - py) * t;
				kept++;
			}
			if (side >= 0) {
				to[kept * 2] = cx;
				to[kept * 2 + 1] = cy;
				kept++;
			}
			px = cx;
			py = cy;
			previousSide = side;
		}
		const swap = from;
		from = to;
		to = swap;
		count = kept;
	}
	if (count < 3) {
		return 0;
	}
	const u0 = tri[2]!;
	const v0 = tri[3]!;
	const du1 = tri[6]! - u0;
	const dv1 = tri[7]! - v0;
	const du2 = tri[10]! - u0;
	const dv2 = tri[11]! - v0;
	for (let i = 0; i < count; i++) {
		const x = from[i * 2]!;
		const y = from[i * 2 + 1]!;
		// Barycentric weights of corners 1 and 2, from Cramer's rule on `p - p0 = w1 * e1 + w2 * e2`.
		const w1 = ((x - x0) * e2y - e2x * (y - y0)) / det;
		const w2 = (e1x * (y - y0) - (x - x0) * e1y) / det;
		out[i * 4] = x;
		out[i * 4 + 1] = y;
		out[i * 4 + 2] = u0 + w1 * du1 + w2 * du2;
		out[i * 4 + 3] = v0 + w1 * dv1 + w2 * dv2;
	}
	return count;
}
