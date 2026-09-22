// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Geometry

/**
 * Turns a posed skeleton's attachments into textured triangles: world positions, page UVs and indices for each drawing slot, in draw
 * order. `MATH.md` explains the region quad, the whitespace strip, the UV mapping at each packed rotation, weighted vertices and linked meshes.
 * `skeletonTriangles` also applies clipping attachments, cutting the slots they cover down to the clip polygon ("Clipping" in `MATH.md`).
 * The output lists are pooled per skeleton, so a list is only valid until the next call on the same skeleton.
 */

import { clipTriangle, containsBox, containsTriangle, dropRepeats, isConvex, triangulate, winding } from "./clipping.js";
import { DEG_TO_RAD, MAX_LINK_DEPTH, linkedParent } from "./skeleton.js";
import type { Bone, Skeleton, Slot } from "./skeleton.js";
import type { Atlas, AtlasRegion, Attachment, BlendMode, ClippingAttachment, Color, LinkedMeshAttachment, MeshAttachment, MeshVertices, RegionAttachment } from "./types.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** The two triangles of a region quad, whose corners run bottom-left, bottom-right, top-right, top-left. Every region list shares it. */
const QUAD_INDICES = new Uint16Array([0, 1, 2, 2, 3, 0]);

/** An empty array a new pooled list starts with, before its first build fills it. */
const NO_VALUES = new Float32Array(0);

/** What `slotTriangles` works out once per drawable attachment, keyed by the attachment object. */
const attachmentCache = new WeakMap<DrawableAttachment, AttachmentEntry>();

/** Each skeleton's reusable output. */
const pools = new WeakMap<Skeleton, TrianglePool>();

/**
 * Most vertices one clipped list may hold, since its indices are 16-bit. Triangles past it are dropped without a warning, because a wrapped
 * index would draw garbage. The largest clipped list in the staged corpus has 859 vertices, so the cap is never reached in practice.
 */
const MAX_CLIPPED_VERTICES = 65536;

/** The source triangle being clipped, as x, y, u, v for each of its 3 corners. */
const clipTri = new Float64Array(12);

/** What `clipTriangle` writes, as x, y, u, v per vertex. It grows with the largest clip piece. */
let clipOut = new Float64Array(4 * 16);

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Types

/** An atlas page's real pixel size, read from its PNG, since the staged atlases never declare one. */
export interface PageSize {
	/** Page width in pixels. */
	width: number;
	/** Page height in pixels. */
	height: number;
}

/** One slot's drawable triangles, ready for a renderer. */
export interface TriangleList {
	/** Index of the atlas page the UVs sample. */
	page: number;
	/** World positions, flattened as x0, y0, x1, y1, ... */
	positions: Float32Array;
	/** Page UVs matching `positions`, 0-1 with v pointing down the page's pixel rows. */
	uvs: Float32Array;
	/** Triangle indices into the vertex list, 3 per triangle. */
	indices: Uint16Array;
	/** Tint: the slot's live color times the attachment's color. */
	color: Color;
	/** The slot's live dark color, or null when the slot has none. */
	darkColor: Color | null;
	/** How the slot's triangles blend with what is under them. */
	blendMode: BlendMode;
	/** Index of the slot these triangles belong to. */
	slotIndex: number;
}

/** Where an atlas region sits: its page index and the region itself. */
interface FoundRegion {
	/** Index of the page holding the region. */
	page: number;
	/** The region. */
	region: AtlasRegion;
}

/** An attachment type that draws triangles. */
type DrawableAttachment = RegionAttachment | MeshAttachment | LinkedMeshAttachment;

/** One attachment's region, resolved mesh and page UVs, and the inputs they were worked out from. */
interface AttachmentEntry {
	/** The atlas the region was found in. */
	atlas: Atlas;
	/** The page sizes the UVs were mapped with. */
	pages: PageSize[];
	/** The skeleton data a linked mesh's parent was looked up in. */
	data: Skeleton["data"];
	/** The slot a linked mesh's parent was looked up in. */
	slotIndex: number;
	/** Index of the page holding the region. */
	page: number;
	/** The region, or null when the attachment draws nothing: its region, linked parent or page size is missing. */
	region: AtlasRegion | null;
	/** The mesh that owns the geometry, or null for a region attachment. */
	mesh: MeshAttachment | null;
	/** The page UVs, or null when the attachment draws nothing. */
	uvs: Float32Array | null;
}

/** One slot's reusable clipped output. The arrays grow and are then shared by exact-length views, so a list's arrays keep their lengths. */
interface ClippedPool {
	/** Backing store for clipped positions. */
	positions: Float32Array;
	/** Backing store for clipped UVs, the same length as `positions`. */
	uvs: Float32Array;
	/** Backing store for clipped triangle indices. */
	indices: Uint16Array;
	/** Views on `positions` by length, cleared when it grows. */
	positionViews: Map<number, Float32Array>;
	/** Views on `uvs` by length, cleared when it grows. */
	uvViews: Map<number, Float32Array>;
	/** Views on `indices` by length, cleared when it grows. */
	indexViews: Map<number, Uint16Array>;
	/** Each source vertex's index in the output, or -1 before it is copied. Only triangles kept whole reuse source vertices. */
	remap: Int32Array;
}

/** One slot's reusable output. */
interface SlotPool {
	/** The list returned for this slot, rewritten on each call. */
	list: TriangleList;
	/** The list's dark color, used as `list.darkColor` whenever the slot has one. */
	darkColor: Color;
	/** Position arrays by length, so a slot that swaps between attachments reuses an array for each size. */
	positions: Map<number, Float32Array>;
	/** The clipped output, made the first time the slot is clipped. */
	clipped: ClippedPool | null;
}

/** The active clip polygon, split into convex counterclockwise pieces. */
interface ClipState {
	/** The clip polygon's world vertices, flattened as x0, y0, x1, y1, ..., turned counterclockwise. */
	polygon: Float32Array;
	/** A concave polygon's ear-clipped triangles, 3 indices into `polygon` each. */
	triangles: Uint16Array;
	/** Each piece's vertices. A convex polygon is one piece, `polygon` itself. A concave one has one 3-vertex array per triangle. */
	pieces: Float32Array[];
	/** Spare 3-vertex arrays for triangle pieces, kept across frames. */
	trianglePieces: Float32Array[];
	/** Each piece's vertex count. */
	sizes: Int32Array;
	/** Each piece's bounding box, as min X, min Y, max X, max Y. */
	bounds: Float64Array;
	/** How many pieces there are. 0 clips everything away. */
	count: number;
}

/** One skeleton's reusable output. */
interface TrianglePool {
	/** The array `skeletonTriangles` returns, refilled on each call. */
	lists: TriangleList[];
	/** Each slot's pool by slot index, made the first time the slot draws. */
	slots: (SlotPool | undefined)[];
	/** The active clip, rebuilt each time a clipping slot starts clipping. */
	clip: ClipState;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Finds a region by name, the first match across the atlas's pages.
 *
 * @param atlas The atlas to search.
 * @param name The region name, exactly as the attachment gives it, including any trailing space.
 * @returns The page index and region, or null when no region has that name.
 */
export function findRegion(atlas: Atlas, name: string): FoundRegion | null {
	for (let page = 0; page < atlas.pages.length; page++) {
		const region = atlas.pages[page]!.regions.find((candidate) => candidate.name === name);
		if (region) {
			return { page, region };
		}
	}
	return null;
}

/**
 * Finds the mesh whose geometry a mesh or linked mesh draws with. A linked mesh uses its parent's vertices, UVs and triangles. The parent
 * is in the same slot, in the skin the linked mesh names or in the default skin when it names none.
 *
 * @param skeleton The skeleton whose skins hold the parent.
 * @param slotIndex Index of the slot holding the attachment.
 * @param attachment The mesh or linked mesh.
 * @returns The mesh that owns the geometry, or null when a linked parent is missing or is not a mesh.
 */
export function resolveMesh(skeleton: Skeleton, slotIndex: number, attachment: MeshAttachment | LinkedMeshAttachment): MeshAttachment | null {
	let current: Attachment | null = attachment;
	for (let depth = 0; depth <= MAX_LINK_DEPTH && current !== null; depth++) {
		if (current.type === "mesh") {
			return current;
		}
		if (current.type !== "linkedmesh") {
			return null;
		}
		current = linkedParent(skeleton.data, slotIndex, current);
	}
	return null;
}

/**
 * Finds the attachment a deform timeline must name to move an attachment's vertices. A linked mesh whose `deform` flag is set takes its
 * parent's deform timelines, so it is followed to its parent, and on while each link has the flag. Anything else answers for itself.
 *
 * @param skeleton The skeleton whose skins hold a linked mesh's parent.
 * @param slotIndex Index of the slot holding the attachment.
 * @param attachment The attachment the slot shows.
 * @returns The attachment a deform timeline must name, compared by identity.
 */
export function deformSource(skeleton: Skeleton, slotIndex: number, attachment: Attachment): Attachment {
	let current = attachment;
	for (let depth = 0; depth < MAX_LINK_DEPTH && current.type === "linkedmesh" && current.deform; depth++) {
		const parent = linkedParent(skeleton.data, slotIndex, current);
		if (!parent || (parent.type !== "mesh" && parent.type !== "linkedmesh")) {
			break;
		}
		current = parent;
	}
	return current;
}

/**
 * Maps a point in a region's packed image to page UVs. The packed image is the original image after whitespace stripping, in pixels with
 * y pointing down. A region packed at 90 degrees was stored turned 90 degrees counterclockwise, so its box on the page is `height x width`.
 *
 * @param region The atlas region.
 * @param page The page's real size.
 * @param px X in the packed image, 0 at its left edge.
 * @param py Y in the packed image, 0 at its top edge.
 * @returns The page UV as `[u, v]`.
 */
function packedToPage(region: AtlasRegion, page: PageSize, px: number, py: number): [number, number] {
	const { width: w, height: h } = region;
	let qx = px;
	let qy = py;
	switch (region.rotate) {
		case 90:
			qx = py;
			qy = w - px;
			break;
		case 180:
			qx = w - px;
			qy = h - py;
			break;
		case 270:
			qx = h - py;
			qy = px;
			break;
	}
	return [(region.x + qx) / page.width, (region.y + qy) / page.height];
}

/**
 * Maps a region attachment's 4 corners to page UVs, bottom-left, bottom-right, top-right, top-left, in the packed image's pixels.
 *
 * @param region The atlas region.
 * @param page The page's real size.
 * @returns The page UVs, flattened as u0, v0, u1, v1, ...
 */
function regionUvs(region: AtlasRegion, page: PageSize): Float32Array {
	const corners = [
		[0, region.height],
		[region.width, region.height],
		[region.width, 0],
		[0, 0]
	] as const;
	const uvs = new Float32Array(8);
	corners.forEach(([px, py], i) => {
		const [u, v] = packedToPage(region, page, px, py);
		uvs[i * 2] = u;
		uvs[i * 2 + 1] = v;
	});
	return uvs;
}

/**
 * Places one region corner: scales it along the attachment's axes, turns it, moves it to the attachment's origin, then puts it in the world.
 *
 * @param positions The array to write.
 * @param offset Index of the corner's X in `positions`.
 * @param bone The slot's bone, with its world transform up to date.
 * @param attachment The region attachment.
 * @param cos Cosine of the attachment's rotation.
 * @param sin Sine of the attachment's rotation.
 * @param cornerX The corner's X in the attachment's unscaled space.
 * @param cornerY The corner's Y in the attachment's unscaled space.
 */
function writeCorner(positions: Float32Array, offset: number, bone: Bone, attachment: RegionAttachment, cos: number, sin: number, cornerX: number, cornerY: number): void {
	const sx = cornerX * attachment.scaleX;
	const sy = cornerY * attachment.scaleY;
	const x = cos * sx - sin * sy + attachment.x;
	const y = sin * sx + cos * sy + attachment.y;
	positions[offset] = bone.a * x + bone.b * y + bone.worldX;
	positions[offset + 1] = bone.c * x + bone.d * y + bone.worldY;
}

/**
 * Writes a region attachment's quad: the image rectangle cut down to the packed part, then placed in the bone's space and in the world.
 *
 * @param positions The array to write, 8 long: the 4 corners, bottom-left, bottom-right, top-right, top-left.
 * @param slot The slot showing the attachment.
 * @param attachment The region attachment.
 * @param region The atlas region it draws.
 */
function writeRegionPositions(positions: Float32Array, slot: Slot, attachment: RegionAttachment, region: AtlasRegion): void {
	// Attachment units per original image pixel. The packed image starts `offset` pixels in from the original's bottom-left corner.
	const unitX = attachment.width / region.originalWidth;
	const unitY = attachment.height / region.originalHeight;
	const left = -attachment.width / 2 + region.offsetX * unitX;
	const bottom = -attachment.height / 2 + region.offsetY * unitY;
	const right = left + region.width * unitX;
	const top = bottom + region.height * unitY;

	const angle = attachment.rotation * DEG_TO_RAD;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	writeCorner(positions, 0, slot.bone, attachment, cos, sin, left, bottom);
	writeCorner(positions, 2, slot.bone, attachment, cos, sin, right, bottom);
	writeCorner(positions, 4, slot.bone, attachment, cos, sin, right, top);
	writeCorner(positions, 6, slot.bone, attachment, cos, sin, left, top);
}

/**
 * Counts the numbers in a mesh's world positions: one pair per vertex.
 *
 * @param mesh The mesh that owns the geometry.
 * @returns The length of its flattened positions.
 */
function meshPositionsLength(mesh: MeshAttachment): number {
	return mesh.vertices.weighted ? mesh.uvs.length : mesh.vertices.values.length;
}

/**
 * Writes an attachment's world vertex positions with the slot's deform offsets applied. Plain vertices are in the slot bone's space, and
 * offset `2i, 2i+1` moves vertex `i`. A weighted vertex is the weighted sum of each influencing bone's world placement of its bind
 * position. Offset `2k, 2k+1` moves influence `k`'s bind position, and the slot's own bone plays no part. The offsets count only when the
 * slot's `deformLength` matches these vertices.
 *
 * @param skeleton The posed skeleton.
 * @param slot The slot showing the attachment.
 * @param vertices The vertices: the attachment's own, or a linked mesh's parent's.
 * @param out The array to write, at least 2 per vertex, flattened as x0, y0, x1, y1, ...
 */
export function computeWorldVertices(skeleton: Skeleton, slot: Slot, vertices: MeshVertices, out: Float32Array): void {
	const deform = slot.deform;
	const values = vertices.values;
	if (!vertices.weighted) {
		const bone = slot.bone;
		const deformed = slot.deformLength === values.length;
		for (let i = 0; i < values.length; i += 2) {
			let x = values[i]!;
			let y = values[i + 1]!;
			if (deformed) {
				x += deform[i]!;
				y += deform[i + 1]!;
			}
			out[i] = bone.a * x + bone.b * y + bone.worldX;
			out[i + 1] = bone.c * x + bone.d * y + bone.worldY;
		}
		return;
	}
	const bones = skeleton.bones;
	const influences = vertices.bones;
	const deformed = slot.deformLength === (values.length / 3) * 2;
	let b = 0;
	let v = 0;
	let d = 0;
	for (let i = 0; b < influences.length; i += 2) {
		const count = influences[b++]!;
		let x = 0;
		let y = 0;
		for (let k = 0; k < count; k++, v += 3, d += 2) {
			const bone = bones[influences[b++]!]!;
			let bindX = values[v]!;
			let bindY = values[v + 1]!;
			if (deformed) {
				bindX += deform[d]!;
				bindY += deform[d + 1]!;
			}
			const weight = values[v + 2]!;
			x += (bone.a * bindX + bone.b * bindY + bone.worldX) * weight;
			y += (bone.c * bindX + bone.d * bindY + bone.worldY) * weight;
		}
		out[i] = x;
		out[i + 1] = y;
	}
}

/**
 * Maps a mesh's UVs, which run 0-1 across the region's original image with v pointing down, to page UVs through the region's packing.
 *
 * @param mesh The mesh that owns the UVs.
 * @param region The atlas region it draws.
 * @param page The page's real size.
 * @returns The page UVs, flattened as u0, v0, u1, v1, ...
 */
function meshUvs(mesh: MeshAttachment, region: AtlasRegion, page: PageSize): Float32Array {
	// Stripped whitespace above the packed image, from the left and bottom offsets the atlas stores.
	const offsetTop = region.originalHeight - region.height - region.offsetY;
	const uvs = new Float32Array(mesh.uvs.length);
	for (let i = 0; i < mesh.uvs.length; i += 2) {
		const px = mesh.uvs[i]! * region.originalWidth - region.offsetX;
		const py = mesh.uvs[i + 1]! * region.originalHeight - offsetTop;
		const [u, v] = packedToPage(region, page, px, py);
		uvs[i] = u;
		uvs[i + 1] = v;
	}
	return uvs;
}

/**
 * Gets an attachment's region, resolved mesh and page UVs, working them out on the first call and whenever the atlas object, the pages
 * array, the skeleton data or the slot differ from last time. The arrays are compared by identity, so neither may be changed in place.
 *
 * @param skeleton The skeleton whose skins hold a linked mesh's parent.
 * @param slotIndex Index of the slot showing the attachment.
 * @param attachment The attachment.
 * @param atlas The rig's atlas.
 * @param pages Each atlas page's real size, by page index.
 * @returns The entry. Its `uvs` is null when the region, linked parent or page size is missing.
 */
function attachmentEntry(skeleton: Skeleton, slotIndex: number, attachment: DrawableAttachment, atlas: Atlas, pages: PageSize[]): AttachmentEntry {
	const cached = attachmentCache.get(attachment);
	if (cached && cached.atlas === atlas && cached.pages === pages && cached.data === skeleton.data && cached.slotIndex === slotIndex) {
		return cached;
	}
	const entry: AttachmentEntry = { atlas, pages, data: skeleton.data, slotIndex, page: 0, region: null, mesh: null, uvs: null };
	attachmentCache.set(attachment, entry);
	const found = findRegion(atlas, attachment.path ?? attachment.name);
	const page = found ? pages[found.page] : undefined;
	if (!found || !page) {
		return entry;
	}
	if (attachment.type === "region") {
		entry.uvs = regionUvs(found.region, page);
	} else {
		entry.mesh = resolveMesh(skeleton, slotIndex, attachment);
		if (!entry.mesh) {
			return entry;
		}
		entry.uvs = meshUvs(entry.mesh, found.region, page);
	}
	entry.page = found.page;
	entry.region = found.region;
	return entry;
}

/**
 * Gets a skeleton's pool, making it on first use.
 *
 * @param skeleton The skeleton.
 * @returns The pool.
 */
function poolFor(skeleton: Skeleton): TrianglePool {
	let pool = pools.get(skeleton);
	if (!pool) {
		const clip: ClipState = {
			polygon: new Float32Array(32),
			triangles: new Uint16Array(48),
			pieces: [],
			trianglePieces: [],
			sizes: new Int32Array(16),
			bounds: new Float64Array(64),
			count: 0
		};
		pool = { lists: [], slots: [], clip };
		pools.set(skeleton, pool);
	}
	return pool;
}

/**
 * Gets a slot's pool, making it on first use.
 *
 * @param pool The skeleton's pool.
 * @param slot The slot.
 * @returns The slot's pool.
 */
function slotPoolFor(pool: TrianglePool, slot: Slot): SlotPool {
	let slotPool = pool.slots[slot.index];
	if (!slotPool) {
		const list: TriangleList = {
			page: 0,
			positions: NO_VALUES,
			uvs: NO_VALUES,
			indices: QUAD_INDICES,
			color: { r: 1, g: 1, b: 1, a: 1 },
			darkColor: null,
			blendMode: "normal",
			slotIndex: slot.index
		};
		slotPool = { list, darkColor: { r: 0, g: 0, b: 0, a: 1 }, positions: new Map(), clipped: null };
		pool.slots[slot.index] = slotPool;
	}
	return slotPool;
}

/**
 * Gets a slot's position array of a given length, making it on first use.
 *
 * @param slotPool The slot's pool.
 * @param length The number of values needed.
 * @returns The array, exactly `length` long.
 */
function positionsFor(slotPool: SlotPool, length: number): Float32Array {
	let positions = slotPool.positions.get(length);
	if (!positions) {
		positions = new Float32Array(length);
		slotPool.positions.set(length, positions);
	}
	return positions;
}

/**
 * Builds one slot's triangles into its pooled list.
 *
 * @param pool The skeleton's pool.
 * @param skeleton The skeleton, with `updateWorldTransform` already run.
 * @param slot The slot to draw.
 * @param atlas The rig's atlas.
 * @param pages Each atlas page's real size, by page index.
 * @returns The slot's pooled list, or null when it shows nothing drawable or its region, linked parent or page size is missing.
 */
function buildSlotTriangles(pool: TrianglePool, skeleton: Skeleton, slot: Slot, atlas: Atlas, pages: PageSize[]): TriangleList | null {
	const attachment = slot.attachment;
	if (!attachment || (attachment.type !== "region" && attachment.type !== "mesh" && attachment.type !== "linkedmesh")) {
		return null;
	}
	const entry = attachmentEntry(skeleton, slot.index, attachment, atlas, pages);
	const { region, mesh, uvs } = entry;
	if (!region || !uvs) {
		return null;
	}
	const slotPool = slotPoolFor(pool, slot);
	const list = slotPool.list;
	if (attachment.type === "region") {
		list.positions = positionsFor(slotPool, 8);
		writeRegionPositions(list.positions, slot, attachment, region);
		list.indices = QUAD_INDICES;
	} else if (mesh) {
		list.positions = positionsFor(slotPool, meshPositionsLength(mesh));
		computeWorldVertices(skeleton, slot, mesh.vertices, list.positions);
		list.indices = mesh.triangles;
	} else {
		return null;
	}
	list.page = entry.page;
	list.uvs = uvs;
	list.blendMode = slot.data.blendMode;
	const color = list.color;
	const tint = attachment.color;
	color.r = slot.color.r * tint.r;
	color.g = slot.color.g * tint.g;
	color.b = slot.color.b * tint.b;
	color.a = slot.color.a * tint.a;
	const darkColor = slot.darkColor;
	if (darkColor) {
		const target = slotPool.darkColor;
		target.r = darkColor.r;
		target.g = darkColor.g;
		target.b = darkColor.b;
		target.a = darkColor.a;
		list.darkColor = target;
	} else {
		list.darkColor = null;
	}
	return list;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Clipping

/**
 * Counts a vertex list's vertices: one per x, y pair, or one per run of bone influences when weighted.
 *
 * @param vertices The vertices.
 * @returns The vertex count.
 */
function vertexCount(vertices: MeshVertices): number {
	if (!vertices.weighted) {
		return vertices.values.length >> 1;
	}
	const bones = vertices.bones;
	let count = 0;
	for (let b = 0; b < bones.length; b += bones[b]! + 1) {
		count++;
	}
	return count;
}

/**
 * Records a piece in the clip state, with its bounding box.
 *
 * @param clip The clip state.
 * @param piece The piece's vertices.
 * @param size The piece's vertex count.
 */
function addPiece(clip: ClipState, piece: Float32Array, size: number): void {
	const index = clip.count++;
	if (clip.sizes.length <= index) {
		const sizes = new Int32Array(index * 2);
		sizes.set(clip.sizes);
		clip.sizes = sizes;
		const bounds = new Float64Array(index * 8);
		bounds.set(clip.bounds);
		clip.bounds = bounds;
	}
	clip.pieces[index] = piece;
	clip.sizes[index] = size;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (let i = 0; i < size * 2; i += 2) {
		minX = Math.min(minX, piece[i]!);
		minY = Math.min(minY, piece[i + 1]!);
		maxX = Math.max(maxX, piece[i]!);
		maxY = Math.max(maxY, piece[i + 1]!);
	}
	const bounds = clip.bounds;
	bounds[index * 4] = minX;
	bounds[index * 4 + 1] = minY;
	bounds[index * 4 + 2] = maxX;
	bounds[index * 4 + 3] = maxY;
	if (clipOut.length < 4 * (3 + size)) {
		clipOut = new Float64Array(4 * (3 + size) * 2);
	}
}

/**
 * Builds the clip polygon for a clipping slot: its world vertices with the slot's deform, with repeated vertices dropped, turned
 * counterclockwise, then split into convex pieces. A convex polygon is one piece. A concave one is ear-clipped and each triangle is a
 * piece. A polygon with fewer than 3 vertices or no area leaves no pieces, so it clips everything away.
 *
 * @param clip The clip state to fill.
 * @param skeleton The posed skeleton.
 * @param slot The clipping slot.
 * @param attachment Its clipping attachment.
 */
function startClip(clip: ClipState, skeleton: Skeleton, slot: Slot, attachment: ClippingAttachment): void {
	clip.count = 0;
	const total = vertexCount(attachment.vertices);
	if (total < 3) {
		return;
	}
	if (clip.polygon.length < total * 2) {
		clip.polygon = new Float32Array(total * 4);
	}
	const polygon = clip.polygon;
	computeWorldVertices(skeleton, slot, attachment.vertices, polygon);
	// Repeated vertices go first, so neither the convexity test nor ear clipping sees a zero-length edge.
	const count = dropRepeats(polygon, total);
	if (count < 3) {
		return;
	}
	const turn = winding(polygon, count);
	if (turn === 0) {
		return;
	}
	if (turn < 0) {
		for (let i = 0, j = count - 1; i < j; i++, j--) {
			const x = polygon[i * 2]!;
			const y = polygon[i * 2 + 1]!;
			polygon[i * 2] = polygon[j * 2]!;
			polygon[i * 2 + 1] = polygon[j * 2 + 1]!;
			polygon[j * 2] = x;
			polygon[j * 2 + 1] = y;
		}
	}
	if (isConvex(polygon, count)) {
		addPiece(clip, polygon, count);
		return;
	}
	if (clip.triangles.length < (count - 2) * 3) {
		clip.triangles = new Uint16Array(count * 6);
	}
	const triangles = clip.triangles;
	const triangleCount = triangulate(polygon, count, triangles);
	let used = 0;
	for (let t = 0; t < triangleCount; t++) {
		let piece = clip.trianglePieces[used];
		if (!piece) {
			piece = new Float32Array(6);
			clip.trianglePieces[used] = piece;
		}
		for (let k = 0; k < 3; k++) {
			const v = triangles[t * 3 + k]! * 2;
			piece[k * 2] = polygon[v]!;
			piece[k * 2 + 1] = polygon[v + 1]!;
		}
		// A flat triangle, from vertices in a line, covers nothing, so it is not a piece.
		if ((piece[2]! - piece[0]!) * (piece[5]! - piece[1]!) - (piece[3]! - piece[1]!) * (piece[4]! - piece[0]!) > 0) {
			addPiece(clip, piece, 3);
			used++;
		}
	}
}

/**
 * Gets a slot's clipped pool, making it on first use.
 *
 * @param slotPool The slot's pool.
 * @returns The clipped pool.
 */
function clippedPoolFor(slotPool: SlotPool): ClippedPool {
	let clipped = slotPool.clipped;
	if (!clipped) {
		clipped = {
			positions: new Float32Array(64),
			uvs: new Float32Array(64),
			indices: new Uint16Array(96),
			positionViews: new Map(),
			uvViews: new Map(),
			indexViews: new Map(),
			remap: new Int32Array(32)
		};
		slotPool.clipped = clipped;
	}
	return clipped;
}

/**
 * Makes room in a clipped pool, keeping what is already written.
 *
 * @param clipped The clipped pool.
 * @param vertices How many vertices it must hold.
 * @param indices How many indices it must hold.
 */
function reserveClipped(clipped: ClippedPool, vertices: number, indices: number): void {
	if (clipped.positions.length < vertices * 2) {
		const size = Math.max(vertices * 2, clipped.positions.length * 2);
		const positions = new Float32Array(size);
		positions.set(clipped.positions);
		clipped.positions = positions;
		const uvs = new Float32Array(size);
		uvs.set(clipped.uvs);
		clipped.uvs = uvs;
		clipped.positionViews.clear();
		clipped.uvViews.clear();
	}
	if (clipped.indices.length < indices) {
		const next = new Uint16Array(Math.max(indices, clipped.indices.length * 2));
		next.set(clipped.indices);
		clipped.indices = next;
		clipped.indexViews.clear();
	}
}

/**
 * Gets a view of the first `length` values of a backing array, made the first time that length is asked for.
 *
 * @param views The pool's views by length.
 * @param backing The backing array.
 * @param length The view's length.
 * @returns The view.
 */
function viewOf<T extends Float32Array | Uint16Array>(views: Map<number, T>, backing: T, length: number): T {
	let view = views.get(length);
	if (!view) {
		view = backing.subarray(0, length) as T;
		views.set(length, view);
	}
	return view;
}

/**
 * Cuts one slot's triangles down to the active clip's pieces, and points its list at the result. A slot whose bounding box is inside a
 * convex clip is kept as it is. Otherwise each triangle is tested against each piece. One wholly inside a piece is kept as it is, sharing
 * source vertices. Otherwise each piece's part of it is kept as a fan.
 *
 * @param clip The active clip.
 * @param slotPool The slot's pool.
 * @param list The slot's unclipped list, which is rewritten.
 * @returns False when nothing of the slot is left.
 */
function clipList(clip: ClipState, slotPool: SlotPool, list: TriangleList): boolean {
	if (clip.count === 0) {
		return false;
	}
	const positions = list.positions;
	const uvs = list.uvs;
	const indices = list.indices;
	const sourceCount = positions.length >> 1;
	// A slot wholly inside a convex clip is left as it is, which saves testing each triangle.
	if (clip.count === 1) {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (let i = 0; i < positions.length; i += 2) {
			minX = Math.min(minX, positions[i]!);
			minY = Math.min(minY, positions[i + 1]!);
			maxX = Math.max(maxX, positions[i]!);
			maxY = Math.max(maxY, positions[i + 1]!);
		}
		if (containsBox(clip.pieces[0]!, clip.sizes[0]!, minX, minY, maxX, maxY)) {
			return true;
		}
	}
	const clipped = clippedPoolFor(slotPool);
	if (clipped.remap.length < sourceCount) {
		clipped.remap = new Int32Array(sourceCount * 2);
	}
	const remap = clipped.remap;
	remap.fill(-1, 0, sourceCount);
	const pieces = clip.pieces;
	const sizes = clip.sizes;
	const bounds = clip.bounds;
	let vertexTotal = 0;
	let indexTotal = 0;
	for (let t = 0; t < indices.length; t += 3) {
		const i0 = indices[t]!;
		const i1 = indices[t + 1]!;
		const i2 = indices[t + 2]!;
		clipTri[0] = positions[i0 * 2]!;
		clipTri[1] = positions[i0 * 2 + 1]!;
		clipTri[2] = uvs[i0 * 2]!;
		clipTri[3] = uvs[i0 * 2 + 1]!;
		clipTri[4] = positions[i1 * 2]!;
		clipTri[5] = positions[i1 * 2 + 1]!;
		clipTri[6] = uvs[i1 * 2]!;
		clipTri[7] = uvs[i1 * 2 + 1]!;
		clipTri[8] = positions[i2 * 2]!;
		clipTri[9] = positions[i2 * 2 + 1]!;
		clipTri[10] = uvs[i2 * 2]!;
		clipTri[11] = uvs[i2 * 2 + 1]!;
		const minX = Math.min(clipTri[0]!, clipTri[4]!, clipTri[8]!);
		const minY = Math.min(clipTri[1]!, clipTri[5]!, clipTri[9]!);
		const maxX = Math.max(clipTri[0]!, clipTri[4]!, clipTri[8]!);
		const maxY = Math.max(clipTri[1]!, clipTri[5]!, clipTri[9]!);
		for (let p = 0; p < clip.count; p++) {
			if (minX > bounds[p * 4 + 2]! || maxX < bounds[p * 4]! || minY > bounds[p * 4 + 3]! || maxY < bounds[p * 4 + 1]!) {
				continue;
			}
			const piece = pieces[p]!;
			const size = sizes[p]!;
			if (containsTriangle(clipTri, piece, size)) {
				// Counts 3 new vertices even when some are reused, so it may stop up to 2 vertices short of the cap. Output below it is the same.
				if (vertexTotal + 3 > MAX_CLIPPED_VERTICES) {
					break;
				}
				reserveClipped(clipped, vertexTotal + 3, indexTotal + 3);
				for (let k = 0; k < 3; k++) {
					const source = indices[t + k]!;
					let index = remap[source]!;
					if (index < 0) {
						index = vertexTotal++;
						remap[source] = index;
						clipped.positions[index * 2] = positions[source * 2]!;
						clipped.positions[index * 2 + 1] = positions[source * 2 + 1]!;
						clipped.uvs[index * 2] = uvs[source * 2]!;
						clipped.uvs[index * 2 + 1] = uvs[source * 2 + 1]!;
					}
					clipped.indices[indexTotal++] = index;
				}
				// Pieces never overlap, so no other piece can hold any of this triangle.
				break;
			}
			const kept = clipTriangle(clipTri, piece, size, clipOut);
			if (kept < 3 || vertexTotal + kept > MAX_CLIPPED_VERTICES) {
				continue;
			}
			reserveClipped(clipped, vertexTotal + kept, indexTotal + (kept - 2) * 3);
			const out = clipped.positions;
			const outUvs = clipped.uvs;
			for (let k = 0; k < kept; k++) {
				out[(vertexTotal + k) * 2] = clipOut[k * 4]!;
				out[(vertexTotal + k) * 2 + 1] = clipOut[k * 4 + 1]!;
				outUvs[(vertexTotal + k) * 2] = clipOut[k * 4 + 2]!;
				outUvs[(vertexTotal + k) * 2 + 1] = clipOut[k * 4 + 3]!;
			}
			for (let k = 1; k + 1 < kept; k++) {
				clipped.indices[indexTotal++] = vertexTotal;
				clipped.indices[indexTotal++] = vertexTotal + k;
				clipped.indices[indexTotal++] = vertexTotal + k + 1;
			}
			vertexTotal += kept;
		}
	}
	if (indexTotal === 0) {
		return false;
	}
	list.positions = viewOf(clipped.positionViews, clipped.positions, vertexTotal * 2);
	list.uvs = viewOf(clipped.uvViews, clipped.uvs, vertexTotal * 2);
	list.indices = viewOf(clipped.indexViews, clipped.indices, indexTotal);
	return true;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Triangles

/**
 * Builds one slot's triangles from its current attachment and the bones' world transforms. The list and its arrays are pooled: they are
 * only valid until the next `slotTriangles` or `skeletonTriangles` call on the same skeleton, and must not be changed.
 *
 * @param skeleton The skeleton, with `updateWorldTransform` already run.
 * @param slot The slot to draw.
 * @param atlas The rig's atlas.
 * @param pages Each atlas page's real size, by page index.
 * @returns The slot's triangles, or null when it shows nothing drawable or its region, linked parent or page size is missing.
 */
export function slotTriangles(skeleton: Skeleton, slot: Slot, atlas: Atlas, pages: PageSize[]): TriangleList | null {
	return buildSlotTriangles(poolFor(skeleton), skeleton, slot, atlas, pages);
}

/**
 * Builds every slot's triangles, back to front, clipped by any clipping attachment shown. Walking the live draw order, a slot showing a
 * clipping attachment starts clipping, unless a clip is already active. Every later slot is clipped until the walk has drawn the end slot.
 * An end slot that is the clip slot itself, or that came earlier in the draw order, never arrives, so clipping runs to the end. A slot
 * clipped to nothing is left out. Allocates nothing once each slot's pool has grown to fit. The returned array, its lists and their arrays
 * are only valid until the next `slotTriangles` or `skeletonTriangles` call on the same skeleton, and must not be changed.
 *
 * @param skeleton The skeleton, with `updateWorldTransform` already run.
 * @param atlas The rig's atlas.
 * @param pages Each atlas page's real size, by page index.
 * @returns One list per drawable slot, in draw order.
 */
export function skeletonTriangles(skeleton: Skeleton, atlas: Atlas, pages: PageSize[]): TriangleList[] {
	const pool = poolFor(skeleton);
	const lists = pool.lists;
	const drawOrder = skeleton.drawOrder;
	let count = 0;
	let clipping = false;
	let clipEnd = -1;
	for (let i = 0; i < drawOrder.length; i++) {
		const slot = drawOrder[i]!;
		const attachment = slot.attachment;
		if (attachment !== null && attachment.type === "clipping") {
			if (!clipping) {
				startClip(pool.clip, skeleton, slot, attachment);
				clipping = true;
				clipEnd = attachment.endSlotIndex === slot.index ? -1 : attachment.endSlotIndex;
			}
		} else {
			const list = buildSlotTriangles(pool, skeleton, slot, atlas, pages);
			if (list && (!clipping || clipList(pool.clip, pool.slots[slot.index]!, list))) {
				lists[count++] = list;
			}
		}
		if (clipping && slot.index === clipEnd) {
			clipping = false;
		}
	}
	lists.length = count;
	return lists;
}

/**
 * Finds the axis-aligned box around every position in a set of triangle lists.
 *
 * @param lists The triangle lists.
 * @returns The box, or null when the lists hold no positions.
 */
export function bounds(lists: TriangleList[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const list of lists) {
		for (let i = 0; i < list.positions.length; i += 2) {
			minX = Math.min(minX, list.positions[i]!);
			minY = Math.min(minY, list.positions[i + 1]!);
			maxX = Math.max(maxX, list.positions[i]!);
			maxY = Math.max(maxY, list.positions[i + 1]!);
		}
	}
	return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
