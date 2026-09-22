// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Geometry

/**
 * Turns a posed skeleton's attachments into textured triangles: world positions, page UVs and indices for each drawing slot, in draw
 * order. `MATH.md` explains the region quad, the whitespace strip, the UV mapping at each packed rotation, weighted vertices and linked meshes.
 */

import { localToWorld } from "./skeleton.js";
import type { Skeleton, Slot } from "./skeleton.js";
import type { Atlas, AtlasRegion, BlendMode, Color, LinkedMeshAttachment, MeshAttachment, RegionAttachment } from "./types.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Multiplies degrees into radians. */
const DEG_TO_RAD = Math.PI / 180;

/** The two triangles of a region quad, whose corners run bottom-left, bottom-right, top-right, top-left. */
const QUAD_INDICES = [0, 1, 2, 2, 3, 0];

/** The name the binary reader gives the default skin. */
const DEFAULT_SKIN_NAME = "default";

/** Most linked mesh hops followed before giving up, so a parent loop cannot spin forever. */
const MAX_LINK_DEPTH = 8;

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
	/** Tint: the slot's color times the attachment's color. */
	color: Color;
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
 * Builds a region attachment's quad: the image rectangle cut down to the packed part, then placed in the bone's space and in the world.
 *
 * @param slot The slot showing the attachment.
 * @param attachment The region attachment.
 * @param region The atlas region it draws.
 * @param page The page's real size.
 * @returns The world positions and page UVs of the 4 corners, bottom-left, bottom-right, top-right, top-left.
 */
function regionQuad(slot: Slot, attachment: RegionAttachment, region: AtlasRegion, page: PageSize): { positions: Float32Array; uvs: Float32Array } {
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
	const corners = [
		[left, bottom, 0, region.height],
		[right, bottom, region.width, region.height],
		[right, top, region.width, 0],
		[left, top, 0, 0]
	] as const;
	const positions = new Float32Array(8);
	const uvs = new Float32Array(8);
	corners.forEach(([cx, cy, px, py], i) => {
		const sx = cx * attachment.scaleX;
		const sy = cy * attachment.scaleY;
		const [wx, wy] = localToWorld(slot.bone, cos * sx - sin * sy + attachment.x, sin * sx + cos * sy + attachment.y);
		const [u, v] = packedToPage(region, page, px, py);
		positions[i * 2] = wx;
		positions[i * 2 + 1] = wy;
		uvs[i * 2] = u;
		uvs[i * 2 + 1] = v;
	});
	return { positions, uvs };
}

/**
 * Computes a mesh's world vertex positions. Plain vertices are in the slot bone's space. A weighted vertex is the weighted sum of each
 * influencing bone's world placement of its bind position, and the slot's own bone plays no part.
 *
 * @param skeleton The posed skeleton.
 * @param slot The slot showing the mesh.
 * @param mesh The mesh that owns the geometry.
 * @returns The world positions, flattened as x0, y0, x1, y1, ...
 */
function meshPositions(skeleton: Skeleton, slot: Slot, mesh: MeshAttachment): Float32Array {
	const vertices = mesh.vertices;
	if (!vertices.weighted) {
		const positions = new Float32Array(vertices.values.length);
		for (let i = 0; i < vertices.values.length; i += 2) {
			const [wx, wy] = localToWorld(slot.bone, vertices.values[i]!, vertices.values[i + 1]!);
			positions[i] = wx;
			positions[i + 1] = wy;
		}
		return positions;
	}
	const positions = new Float32Array(mesh.uvs.length);
	let b = 0;
	let v = 0;
	for (let i = 0; i < positions.length; i += 2) {
		const count = vertices.bones[b++]!;
		let x = 0;
		let y = 0;
		for (let k = 0; k < count; k++, v += 3) {
			const bone = skeleton.bones[vertices.bones[b++]!]!;
			const weight = vertices.values[v + 2]!;
			const [wx, wy] = localToWorld(bone, vertices.values[v]!, vertices.values[v + 1]!);
			x += wx * weight;
			y += wy * weight;
		}
		positions[i] = x;
		positions[i + 1] = y;
	}
	return positions;
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
 * Multiplies two colors channel by channel.
 *
 * @param first The first color.
 * @param second The second color.
 * @returns The product.
 */
function multiplyColors(first: Color, second: Color): Color {
	return { r: first.r * second.r, g: first.g * second.g, b: first.b * second.b, a: first.a * second.a };
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Triangles

/**
 * Builds one slot's triangles from its current attachment and the bones' world transforms.
 *
 * @param skeleton The skeleton, with `updateWorldTransform` already run.
 * @param slot The slot to draw.
 * @param atlas The rig's atlas.
 * @param pages Each atlas page's real size, by page index.
 * @returns The slot's triangles, or null when it shows nothing drawable or its region, linked parent or page size is missing.
 */
export function slotTriangles(skeleton: Skeleton, slot: Slot, atlas: Atlas, pages: PageSize[]): TriangleList | null {
	const attachment = slot.attachment;
	if (!attachment || (attachment.type !== "region" && attachment.type !== "mesh" && attachment.type !== "linkedmesh")) {
		return null;
	}
	const found = findRegion(atlas, attachment.path ?? attachment.name);
	const page = found ? pages[found.page] : undefined;
	if (!found || !page) {
		return null;
	}
	const slotIndex = skeleton.slots.indexOf(slot);
	const base = { page: found.page, color: multiplyColors(slot.data.color, attachment.color), blendMode: slot.data.blendMode, slotIndex };
	if (attachment.type === "region") {
		return { ...base, ...regionQuad(slot, attachment, found.region, page), indices: new Uint16Array(QUAD_INDICES) };
	}
	const mesh = resolveMesh(skeleton, slotIndex, attachment);
	if (!mesh) {
		return null;
	}
	return { ...base, positions: meshPositions(skeleton, slot, mesh), uvs: meshUvs(mesh, found.region, page), indices: mesh.triangles };
}

/**
 * Builds every slot's triangles, back to front.
 *
 * @param skeleton The skeleton, with `updateWorldTransform` already run.
 * @param atlas The rig's atlas.
 * @param pages Each atlas page's real size, by page index.
 * @returns One list per drawable slot, in draw order.
 */
export function skeletonTriangles(skeleton: Skeleton, atlas: Atlas, pages: PageSize[]): TriangleList[] {
	const lists: TriangleList[] = [];
	for (const slot of skeleton.drawOrder) {
		const list = slotTriangles(skeleton, slot, atlas, pages);
		if (list) {
			lists.push(list);
		}
	}
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
