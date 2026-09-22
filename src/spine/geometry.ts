// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Geometry

/**
 * Turns a posed skeleton's attachments into textured triangles: world positions, page UVs and indices for each drawing slot, in draw
 * order. `MATH.md` explains the region quad, the whitespace strip, the UV mapping at each packed rotation, weighted vertices and linked meshes.
 * The output lists are pooled per skeleton, so a list is only valid until the next call on the same skeleton.
 */

import { DEFAULT_SKIN_NAME, DEG_TO_RAD } from "./skeleton.js";
import type { Bone, Skeleton, Slot } from "./skeleton.js";
import type { Atlas, AtlasRegion, BlendMode, Color, LinkedMeshAttachment, MeshAttachment, RegionAttachment } from "./types.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** The two triangles of a region quad, whose corners run bottom-left, bottom-right, top-right, top-left. Every region list shares it. */
const QUAD_INDICES = new Uint16Array([0, 1, 2, 2, 3, 0]);

/** An empty array a new pooled list starts with, before its first build fills it. */
const NO_VALUES = new Float32Array(0);

/** Most linked mesh hops followed before giving up, so a parent loop cannot spin forever. */
const MAX_LINK_DEPTH = 8;

/** What `slotTriangles` works out once per drawable attachment, keyed by the attachment object. */
const attachmentCache = new WeakMap<DrawableAttachment, AttachmentEntry>();

/** Each skeleton's reusable output. */
const pools = new WeakMap<Skeleton, TrianglePool>();

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

/** One slot's reusable output. */
interface SlotPool {
	/** The list returned for this slot, rewritten on each call. */
	list: TriangleList;
	/** The list's dark color, used as `list.darkColor` whenever the slot has one. */
	darkColor: Color;
	/** Position arrays by length, so a slot that swaps between attachments reuses an array for each size. */
	positions: Map<number, Float32Array>;
}

/** One skeleton's reusable output. */
interface TrianglePool {
	/** The array `skeletonTriangles` returns, refilled on each call. */
	lists: TriangleList[];
	/** Each slot's pool by slot index, made the first time the slot draws. */
	slots: (SlotPool | undefined)[];
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
	let current: MeshAttachment | LinkedMeshAttachment = attachment;
	for (let depth = 0; depth <= MAX_LINK_DEPTH; depth++) {
		if (current.type === "mesh") {
			return current;
		}
		const skinName: string = current.parentSkin ?? DEFAULT_SKIN_NAME;
		const parent = skeleton.data.skins
			.find((skin) => skin.name === skinName)
			?.attachments.get(slotIndex)
			?.get(current.parentName);
		if (!parent || (parent.type !== "mesh" && parent.type !== "linkedmesh")) {
			return null;
		}
		current = parent;
	}
	return null;
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
 * Writes a mesh's world vertex positions. Plain vertices are in the slot bone's space. A weighted vertex is the weighted sum of each
 * influencing bone's world placement of its bind position, and the slot's own bone plays no part.
 *
 * @param positions The array to write, `meshPositionsLength` long, flattened as x0, y0, x1, y1, ...
 * @param skeleton The posed skeleton.
 * @param slot The slot showing the mesh.
 * @param mesh The mesh that owns the geometry.
 */
function writeMeshPositions(positions: Float32Array, skeleton: Skeleton, slot: Slot, mesh: MeshAttachment): void {
	const vertices = mesh.vertices;
	if (!vertices.weighted) {
		const bone = slot.bone;
		const values = vertices.values;
		for (let i = 0; i < values.length; i += 2) {
			const x = values[i]!;
			const y = values[i + 1]!;
			positions[i] = bone.a * x + bone.b * y + bone.worldX;
			positions[i + 1] = bone.c * x + bone.d * y + bone.worldY;
		}
		return;
	}
	const bones = skeleton.bones;
	const influences = vertices.bones;
	const values = vertices.values;
	let b = 0;
	let v = 0;
	for (let i = 0; i < positions.length; i += 2) {
		const count = influences[b++]!;
		let x = 0;
		let y = 0;
		for (let k = 0; k < count; k++, v += 3) {
			const bone = bones[influences[b++]!]!;
			const bindX = values[v]!;
			const bindY = values[v + 1]!;
			const weight = values[v + 2]!;
			x += (bone.a * bindX + bone.b * bindY + bone.worldX) * weight;
			y += (bone.c * bindX + bone.d * bindY + bone.worldY) * weight;
		}
		positions[i] = x;
		positions[i + 1] = y;
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
		pool = { lists: [], slots: [] };
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
		slotPool = { list, darkColor: { r: 0, g: 0, b: 0, a: 1 }, positions: new Map() };
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
		writeMeshPositions(list.positions, skeleton, slot, mesh);
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
 * Builds every slot's triangles, back to front. Allocates nothing once each slot's pool has grown to fit. The returned array, its lists and
 * their arrays are only valid until the next `slotTriangles` or `skeletonTriangles` call on the same skeleton, and must not be changed.
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
	for (let i = 0; i < drawOrder.length; i++) {
		const list = buildSlotTriangles(pool, skeleton, drawOrder[i]!, atlas, pages);
		if (list) {
			lists[count++] = list;
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
