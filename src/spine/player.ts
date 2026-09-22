// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Player

/**
 * Loads one rig into a canvas and draws its current pose with `SpineRenderer`. Fetches the skeleton, atlas and page images, builds the
 * `Skeleton`, and frames the setup pose in the canvas with a margin, aspect kept and centred. The framing stays put as the pose changes,
 * until `refit` runs.
 */

import { readAtlas } from "./atlas.js";
import { readSkeleton } from "./binary.js";
import { bounds, skeletonTriangles } from "./geometry.js";
import type { PageSize } from "./geometry.js";
import { SpineRenderer } from "./renderer.js";
import type { View } from "./renderer.js";
import { defaultSkinName, Skeleton } from "./skeleton.js";
import type { Atlas } from "./types.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Share of the canvas kept empty on each side of the fitted drawing. */
const FIT_MARGIN = 0.05;

/**
 * How page images are decoded. The staged PNGs are straight alpha (see `FORMAT-3.8.md`), so they are premultiplied on decode, and the
 * colour values are left as stored.
 */
const BITMAP_OPTIONS: ImageBitmapOptions = { premultiplyAlpha: "premultiply", colorSpaceConversion: "none" };

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Types

/** URLs for one rig's files. A page image's URL is `pageBase` plus that atlas page's own file name. */
export interface RigUrls {
	/** URL of the rig's `.skel` file. */
	skel: string;
	/** URL of the rig's `.atlas` file. */
	atlas: string;
	/** Base URL the rig's atlas page images sit under. */
	pageBase: string;
}

/** Everything a loaded rig holds: parsed data, the live skeleton and one texture per page. */
interface LoadedRig {
	/** The parsed atlas. */
	atlas: Atlas;
	/** The live skeleton. */
	skeleton: Skeleton;
	/** Each page's real pixel size, read from its image. */
	pageSizes: PageSize[];
	/** Each page's texture, by page index. */
	textures: WebGLTexture[];
	/** The world box every `render` fits to the canvas, set by `refit`, or null when the pose drew nothing then. */
	framedBox: View | null;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Fits a world box into a viewport with `FIT_MARGIN` on each side, keeping the aspect and centring the box.
 *
 * @param box The world box to show.
 * @param width Viewport width.
 * @param height Viewport height.
 * @returns The world rectangle that maps onto the whole viewport.
 */
export function fitView(box: View, width: number, height: number): View {
	const spanX = Math.max(box.maxX - box.minX, 1e-6);
	const spanY = Math.max(box.maxY - box.minY, 1e-6);
	const usable = 1 - FIT_MARGIN * 2;
	// World units per viewport pixel, set by whichever axis is tighter.
	const unit = Math.max(spanX / (width * usable), spanY / (height * usable));
	const centerX = (box.minX + box.maxX) / 2;
	const centerY = (box.minY + box.maxY) / 2;
	const halfWidth = (width * unit) / 2;
	const halfHeight = (height * unit) / 2;
	return { minX: centerX - halfWidth, minY: centerY - halfHeight, maxX: centerX + halfWidth, maxY: centerY + halfHeight };
}

/**
 * Fetches a URL and fails on a non-2xx status.
 *
 * @param url The URL.
 * @param signal Cancels the fetch.
 * @returns The response.
 */
async function fetchOk(url: string, signal: AbortSignal | undefined): Promise<Response> {
	const response = await fetch(url, { signal });
	if (!response.ok) {
		throw new Error(`Fetching ${url} gave ${response.status}`);
	}
	return response;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Player

/** Plays one rig at a time in a canvas. This stage draws the setup pose only. */
export class SpinePlayer {
	/** The canvas drawn into. The caller owns it. */
	private readonly canvas: HTMLCanvasElement;
	/** The renderer, which owns every GL object the player makes. */
	private readonly renderer: SpineRenderer;
	/** The loaded rig, or null when empty. */
	private rig: LoadedRig | null = null;
	/** Counts `load` calls, so a load that a newer one overtook drops its result. */
	private loadCount = 0;
	/** The world rectangle the last `render` showed, or null when nothing was framed. */
	private lastView: View | null = null;

	/**
	 * Gets a WebGL2 context on the canvas and builds the renderer.
	 *
	 * @param canvas The canvas to draw into.
	 */
	constructor(canvas: HTMLCanvasElement) {
		const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: true });
		if (!gl) {
			throw new Error("WebGL2 is not available");
		}
		this.canvas = canvas;
		this.renderer = new SpineRenderer(gl);
	}

	/** The live skeleton, or null when no rig is loaded. */
	get skeleton(): Skeleton | null {
		return this.rig?.skeleton ?? null;
	}

	/** The loaded rig's atlas, or null when no rig is loaded. */
	get atlas(): Atlas | null {
		return this.rig?.atlas ?? null;
	}

	/** The loaded rig's animation names, in file order. */
	get animations(): string[] {
		return this.rig?.skeleton.data.animations.map((animation) => animation.name) ?? [];
	}

	/** The world rectangle the last `render` fitted to the canvas, or null when nothing was framed. */
	get view(): View | null {
		return this.lastView;
	}

	/**
	 * Loads a rig, replacing any rig already loaded. The old rig is dropped at once, so on an abort or a failed fetch the player is empty.
	 * The skin starts as `defaultSkinName` picks, in the setup pose, and the framing fits that pose.
	 *
	 * @param urls The rig's file URLs.
	 * @param signal Cancels the fetches. An abort rejects the returned promise.
	 */
	async load(urls: RigUrls, signal?: AbortSignal): Promise<void> {
		const loadId = ++this.loadCount;
		this.clear();
		const [skelResponse, atlasResponse] = await Promise.all([fetchOk(urls.skel, signal), fetchOk(urls.atlas, signal)]);
		const [skelBytes, atlasText] = await Promise.all([skelResponse.arrayBuffer(), atlasResponse.text()]);
		const data = readSkeleton(new Uint8Array(skelBytes));
		const atlas = readAtlas(atlasText);
		const settled = await Promise.allSettled(atlas.pages.map(async (page) => createImageBitmap(await (await fetchOk(urls.pageBase + page.name, signal)).blob(), BITMAP_OPTIONS)));
		const images = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
		try {
			const failed = settled.find((result) => result.status === "rejected");
			if (failed) {
				throw failed.reason;
			}
			signal?.throwIfAborted();
			if (loadId !== this.loadCount) {
				throw new Error("A newer load replaced this one");
			}
			const skeleton = new Skeleton(data);
			this.rig = {
				atlas,
				skeleton,
				pageSizes: images.map((image) => ({ width: image.width, height: image.height })),
				textures: images.map((image) => this.renderer.upload(image)),
				framedBox: null
			};
			this.setSkin(null);
			this.setToSetupPose();
			this.refit();
		} finally {
			for (const image of images) {
				image.close();
			}
		}
	}

	/**
	 * Sets the skin and swaps in its attachments, as `Skeleton.setSkin` does. The pose is left alone, so call `setToSetupPose` for a reset.
	 *
	 * @param name The skin's name, or null for the skin `defaultSkinName` picks.
	 */
	setSkin(name: string | null): void {
		const skeleton = this.rig?.skeleton;
		if (!skeleton) {
			return;
		}
		skeleton.setSkin(name ?? defaultSkinName(skeleton.data));
	}

	/** Puts the skeleton back in the setup pose with the current skin. Does nothing when no rig is loaded. */
	setToSetupPose(): void {
		this.rig?.skeleton.setToSetupPose();
	}

	/** Frames the current pose: every later `render` fits this pose's bounds to the canvas, however the pose moves after. */
	refit(): void {
		const rig = this.rig;
		if (!rig) {
			return;
		}
		rig.skeleton.updateWorldTransform();
		rig.framedBox = bounds(skeletonTriangles(rig.skeleton, rig.atlas, rig.pageSizes));
	}

	/**
	 * Resizes the canvas's backing store to its displayed size and draws the current pose in the framing `refit` set. Draws nothing when no
	 * rig is loaded.
	 */
	render(): void {
		const canvas = this.canvas;
		const ratio = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
		const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		const rig = this.rig;
		if (!rig) {
			this.lastView = null;
			this.renderer.draw([], [], { minX: 0, minY: 0, maxX: 1, maxY: 1 }, width, height);
			return;
		}
		rig.skeleton.updateWorldTransform();
		const lists = skeletonTriangles(rig.skeleton, rig.atlas, rig.pageSizes);
		this.lastView = rig.framedBox ? fitView(rig.framedBox, width, height) : null;
		this.renderer.draw(lists, rig.textures, this.lastView ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }, width, height);
	}

	/** Frees every texture, buffer and the program. The canvas and its context stay with the caller. */
	dispose(): void {
		this.loadCount++;
		this.rig = null;
		this.lastView = null;
		this.renderer.dispose();
	}

	/** Drops the loaded rig and frees its textures. */
	private clear(): void {
		for (const texture of this.rig?.textures ?? []) {
			this.renderer.release(texture);
		}
		this.rig = null;
		this.lastView = null;
	}
}
