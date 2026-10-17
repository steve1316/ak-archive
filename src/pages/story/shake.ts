// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Camera shake

/** The width and height of the game's text space, which `camerashake` strengths are measured in. */
const SPACE = { width: 1280, height: 720 };

/** A camera shake from `camerashake`. */
export interface Shake {
	/** How long it lasts, in seconds. */
	duration: number;
	/** The furthest it moves sideways, in the game's 1280x720 text space. */
	x: number;
	/** The furthest it moves up or down, in the same space. */
	y: number;
	/** How many jolts it makes each second. */
	vibrato: number;
	/** How far each jolt's direction may stray from straight back, 0 to 90 degrees. */
	randomness: number;
	/** Whether the jolts shrink to nothing by the end. */
	fadeOut: boolean;
}

/**
 * The jolts of a shake as animation keyframes. Each jolt swings back across the middle, turned by up to `randomness` degrees, and the last
 * one comes to rest. The same seed always gives the same shake.
 *
 * @param shake The shake.
 * @param seed A number that varies the shake from one to the next.
 * @returns The keyframes, as percentages of the stage.
 */
export function shakeFrames(shake: Shake, seed: number): { transform: string }[] {
	const jolts = Math.max(2, Math.round(shake.duration * shake.vibrato));
	let state = (seed * 2654435761) >>> 0;
	const random = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
	let angle = random() * 360;
	const frames = [{ transform: "translate(0, 0)" }];
	for (let jolt = 0; jolt < jolts - 1; jolt++) {
		angle += 180 + (random() * 2 - 1) * shake.randomness;
		const size = shake.fadeOut ? 1 - jolt / jolts : 1;
		const x = Math.cos((angle * Math.PI) / 180) * shake.x * size;
		const y = Math.sin((angle * Math.PI) / 180) * shake.y * size;
		frames.push({ transform: `translate(${((x / SPACE.width) * 100).toFixed(3)}%, ${((y / SPACE.height) * 100).toFixed(3)}%)` });
	}
	frames.push({ transform: "translate(0, 0)" });
	return frames;
}
