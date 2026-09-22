// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Player

/**
 * Loads one rig into a canvas, plays its animations and draws each pose with `SpineRenderer`. Fetches the skeleton, atlas and page images,
 * builds the `Skeleton`, and frames the setup pose in the canvas with a margin, aspect kept and centred. `play` frames the animation it
 * starts instead. The framing stays put as the pose changes, until `refit` or `play` runs. The caller owns the frame loop and calls `update`
 * once a frame.
 */

import { applyAnimation, loopTime } from "./animation.js";
import { readAtlas } from "./atlas.js";
import { readSkeleton } from "./binary.js";
import { bounds, skeletonTriangles } from "./geometry.js";
import type { PageSize } from "./geometry.js";
import { SpineRenderer } from "./renderer.js";
import type { View } from "./renderer.js";
import { defaultSkinName, Skeleton } from "./skeleton.js";
import type { Animation, Atlas } from "./types.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Share of the canvas kept empty on each side of the fitted drawing. */
const FIT_MARGIN = 0.05;

/** How many evenly spaced times, from 0 to the duration, `play` samples to frame an animation. */
const FIT_SAMPLES = 8;

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
	/** Each animation's framing once worked out, keyed by name and whether it loops, so replaying an animation does not sample it again. */
	boxes: Map<string, View | null>;
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
 * @param out When given, the view written and returned instead of a new one, so a per-frame caller like `render` allocates nothing.
 * @returns The world rectangle that maps onto the whole viewport: `out` when given, otherwise a new object.
 */
export function fitView(box: View, width: number, height: number, out?: View): View {
	const spanX = Math.max(box.maxX - box.minX, 1e-6);
	const spanY = Math.max(box.maxY - box.minY, 1e-6);
	const usable = 1 - FIT_MARGIN * 2;
	// World units per viewport pixel, set by whichever axis is tighter.
	const unit = Math.max(spanX / (width * usable), spanY / (height * usable));
	const centerX = (box.minX + box.maxX) / 2;
	const centerY = (box.minY + box.maxY) / 2;
	const halfWidth = (width * unit) / 2;
	const halfHeight = (height * unit) / 2;
	const minX = centerX - halfWidth;
	const minY = centerY - halfHeight;
	const maxX = centerX + halfWidth;
	const maxY = centerY + halfHeight;
	if (out) {
		out.minX = minX;
		out.minY = minY;
		out.maxX = maxX;
		out.maxY = maxY;
		return out;
	}
	return { minX, minY, maxX, maxY };
}

/**
 * Finds the box around an animation's poses at `FIT_SAMPLES` evenly spaced times. A looping animation is sampled over [0, duration), since a
 * loop wraps to 0 and never shows its end pose. One that plays once is sampled over [0, duration]. It leaves the skeleton posed at the last
 * sample, so the caller poses it again after.
 *
 * @param rig The loaded rig.
 * @param animation The animation to sample.
 * @param loop True when the animation will loop, so its end pose is left out.
 * @returns The union of the sampled poses' bounds, or null when none of them drew anything.
 */
function animationBox(rig: LoadedRig, animation: Animation, loop: boolean): View | null {
	const skeleton = rig.skeleton;
	const samples = animation.duration > 0 ? FIT_SAMPLES : 1;
	let box: View | null = null;
	for (let i = 0; i < samples; i++) {
		skeleton.setToSetupPose();
		applyAnimation(skeleton, animation, samples > 1 ? (animation.duration * i) / (loop ? samples : samples - 1) : 0);
		skeleton.updateWorldTransform();
		box = unionView(box, bounds(skeletonTriangles(skeleton, rig.atlas, rig.pageSizes)));
	}
	return box;
}

/**
 * An animation's framing, sampled once per rig and reused after that.
 *
 * @param rig The loaded rig.
 * @param animation The animation.
 * @param loop True when the animation will loop.
 * @returns The box `animationBox` gives.
 */
function cachedAnimationBox(rig: LoadedRig, animation: Animation, loop: boolean): View | null {
	const key = `${animation.name}|${loop}`;
	if (!rig.boxes.has(key)) {
		rig.boxes.set(key, animationBox(rig, animation, loop));
	}
	return rig.boxes.get(key) ?? null;
}

/**
 * The smallest box holding both boxes.
 *
 * @param a The first box, or null for none.
 * @param b The second box, or null for none.
 * @returns The union, or whichever box exists, or null when neither does.
 */
function unionView(a: View | null, b: View | null): View | null {
	if (!a || !b) {
		return a ?? b;
	}
	return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
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

/** Plays one rig at a time in a canvas. */
export class SpinePlayer {
	/** Playback rate: seconds of animation per second of `update` delta. */
	speed = 1;
	/** True to wrap round at the end of the animation, false to stop on its last frame. */
	loop = true;
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
	/** Scratch view `render` fits into every frame, reused in place so the frame loop allocates nothing. */
	private readonly viewScratch: View = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
	/** The animation playing now: `play`'s choice, or the current step of `playSequence`'s run. Null for the setup pose. */
	private current: Animation | null = null;
	/** The animations `playSequence` plays in order, looping the whole run. One animation after `play`. */
	private sequence: Animation[] = [];
	/** Which of `sequence` is playing. */
	private step = 0;
	/** The time within `current`, in seconds, from 0 to its duration. */
	private currentTime = 0;
	/** True while `update` does not advance the time. */
	private isPaused = false;
	/** The zoom `setViewTransform` set, applied on top of the fitted framing. 1 shows the framing as fitted. */
	private viewScale = 1;
	/** The horizontal pan `setViewTransform` set, in CSS pixels, positive to the right. */
	private viewOffsetX = 0;
	/** The vertical pan `setViewTransform` set, in CSS pixels, positive downwards. */
	private viewOffsetY = 0;

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

	/** The name of the animation `play` chose, or null when none is playing. */
	get animation(): string | null {
		return this.current?.name ?? null;
	}

	/** The time within the current animation, in seconds, from 0 to its duration. */
	get time(): number {
		return this.currentTime;
	}

	/** The current animation's duration in seconds, or 0 when none is playing. */
	get duration(): number {
		return this.current?.duration ?? 0;
	}

	/** True while `update` does not advance the time. */
	get paused(): boolean {
		return this.isPaused;
	}

	/**
	 * Starts an animation from its first frame: frames the animation, resets the skeleton to the setup pose, sets the time to 0, poses and
	 * draws. The framing is the union of the pose bounds at `FIT_SAMPLES` evenly spaced times, and it stays put during playback. Playback is
	 * resumed if it was paused.
	 *
	 * @param name The animation's name.
	 * @param loop True to wrap round at the end, false to stop on the last frame. Defaults to true.
	 */
	play(name: string, loop = true): void {
		const rig = this.requireRig();
		const animation = this.findAnimation(rig, name);
		this.startSequence([animation], loop);
		rig.framedBox = cachedAnimationBox(rig, animation, loop);
		this.pose();
	}

	/**
	 * Plays several animations one after another and loops the whole run, such as a skill's wind-up, middle and wind-down. The framing is the
	 * union of every step's framing, so the drawing does not jump between steps. Playback is resumed if it was paused.
	 *
	 * @param names The animations' names, in order. A name may repeat.
	 */
	playSequence(names: readonly string[]): void {
		const rig = this.requireRig();
		const animations = names.map((name) => this.findAnimation(rig, name));
		if (animations.length === 0) {
			throw new Error("A sequence needs at least one animation");
		}
		this.startSequence(animations, true);
		let box: View | null = null;
		for (const animation of new Set(animations)) {
			box = unionView(box, cachedAnimationBox(rig, animation, animations.length === 1));
		}
		rig.framedBox = box;
		this.pose();
	}

	/**
	 * Advances the time by `delta` seconds times `speed`, unless paused, then poses and draws. Without an animation it draws the current pose.
	 *
	 * @param delta Seconds since the last update.
	 */
	update(delta: number): void {
		const animation = this.current;
		if (animation && !this.isPaused) {
			if (this.sequence.length > 1) {
				this.advanceSequence(delta * this.speed);
			} else {
				this.currentTime = loopTime(animation, this.currentTime + delta * this.speed, this.loop);
			}
		}
		this.pose();
	}

	/** Stops `update` from advancing the time. The pose stays as it is. */
	pause(): void {
		this.isPaused = true;
	}

	/** Lets `update` advance the time again. An animation that stopped on its last frame without looping starts over. */
	resume(): void {
		if (this.isPaused && this.current && !this.loop && this.currentTime >= this.current.duration) {
			this.currentTime = 0;
		}
		this.isPaused = false;
	}

	/**
	 * Jumps to a time in the current animation, then poses and draws. Does nothing without an animation.
	 *
	 * @param time The time in seconds, clamped to the animation's duration.
	 */
	seek(time: number): void {
		const animation = this.current;
		if (!animation) {
			return;
		}
		this.currentTime = loopTime(animation, time, false);
		this.pose();
	}

	/**
	 * The loaded rig, or a throw when none is.
	 *
	 * @returns The rig.
	 */
	private requireRig(): LoadedRig {
		if (!this.rig) {
			throw new Error("No rig is loaded");
		}
		return this.rig;
	}

	/**
	 * One of the rig's animations by name.
	 *
	 * @param rig The loaded rig.
	 * @param name The animation's name.
	 * @returns The animation.
	 */
	private findAnimation(rig: LoadedRig, name: string): Animation {
		const animation = rig.skeleton.data.animations.find((candidate) => candidate.name === name);
		if (!animation) {
			throw new Error(`The rig has no animation named ${name}`);
		}
		return animation;
	}

	/**
	 * Starts a run of animations from the first frame of its first step.
	 *
	 * @param animations The run, at least one animation.
	 * @param loop Whether a single animation wraps round. A run of several always loops as a whole.
	 */
	private startSequence(animations: Animation[], loop: boolean): void {
		this.sequence = animations;
		this.step = 0;
		this.current = animations[0] ?? null;
		this.loop = loop;
		this.currentTime = 0;
		this.isPaused = false;
	}

	/**
	 * Moves through a run of several animations by `elapsed` seconds, carrying the leftover time into the next step and wrapping to the first
	 * step after the last. A step with no length is passed straight through, and a run where every step has no length stays put.
	 *
	 * @param elapsed Seconds of animation to advance.
	 */
	private advanceSequence(elapsed: number): void {
		let time = this.currentTime + elapsed;
		let passed = 0;
		while (this.current && time >= this.current.duration && passed < this.sequence.length) {
			time -= this.current.duration;
			this.step = (this.step + 1) % this.sequence.length;
			this.current = this.sequence[this.step] ?? this.current;
			passed = this.current.duration > 0 ? 0 : passed + 1;
		}
		this.currentTime = this.current ? Math.min(time, this.current.duration) : 0;
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
		this.current = null;
		this.currentTime = 0;
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
				framedBox: null,
				boxes: new Map()
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

	/** Frames the current pose: every later `render` fits this pose's bounds to the canvas, until `refit` or `play` frames again. */
	refit(): void {
		const rig = this.rig;
		if (!rig) {
			return;
		}
		rig.skeleton.updateWorldTransform();
		rig.framedBox = bounds(skeletonTriangles(rig.skeleton, rig.atlas, rig.pageSizes));
	}

	/**
	 * Zooms and pans the drawing on top of the fitted framing, the way a CSS `translate(offsetX, offsetY) scale(scale)` about the canvas
	 * centre would, but by changing the view so the drawing stays sharp. Takes effect on the next `render`.
	 *
	 * @param scale The zoom, where 1 is the fitted framing.
	 * @param offsetX The horizontal pan in CSS pixels, positive to the right.
	 * @param offsetY The vertical pan in CSS pixels, positive downwards.
	 */
	setViewTransform(scale: number, offsetX: number, offsetY: number): void {
		this.viewScale = scale > 0 ? scale : 1;
		this.viewOffsetX = offsetX;
		this.viewOffsetY = offsetY;
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
		const view = rig.framedBox ? fitView(rig.framedBox, width, height, this.viewScratch) : null;
		if (view) {
			this.applyViewTransform(view, width / ratio);
		}
		this.lastView = view;
		this.renderer.draw(lists, rig.textures, this.lastView ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }, width, height);
	}

	/** Frees every texture, buffer and the program. The canvas and its context stay with the caller. */
	dispose(): void {
		this.loadCount++;
		this.rig = null;
		this.current = null;
		this.lastView = null;
		this.renderer.dispose();
	}

	/** Resets the skeleton to the setup pose, applies the current animation at the current time, and draws. */
	private pose(): void {
		const rig = this.rig;
		if (rig && this.current) {
			rig.skeleton.setToSetupPose();
			applyAnimation(rig.skeleton, this.current, this.currentTime);
		}
		this.render();
	}

	/**
	 * Applies the zoom and pan from `setViewTransform` to a fitted view, in place. A screen point at CSS offset `q` from the centre shows what
	 * the fitted view had at `(q - offset) / scale`, so the view's centre moves by `-offset / scale` in CSS pixels and its extent shrinks by `scale`.
	 *
	 * @param view The fitted view, changed in place.
	 * @param cssWidth The canvas width in CSS pixels.
	 */
	private applyViewTransform(view: View, cssWidth: number): void {
		const scale = this.viewScale;
		if (scale === 1 && this.viewOffsetX === 0 && this.viewOffsetY === 0) {
			return;
		}
		// World units per CSS pixel. The fit keeps the aspect, so one unit serves both axes. World Y points up, screen Y down.
		const unit = (view.maxX - view.minX) / cssWidth;
		const centerX = (view.minX + view.maxX) / 2 - (this.viewOffsetX * unit) / scale;
		const centerY = (view.minY + view.maxY) / 2 + (this.viewOffsetY * unit) / scale;
		const halfWidth = (view.maxX - view.minX) / 2 / scale;
		const halfHeight = (view.maxY - view.minY) / 2 / scale;
		view.minX = centerX - halfWidth;
		view.maxX = centerX + halfWidth;
		view.minY = centerY - halfHeight;
		view.maxY = centerY + halfHeight;
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
