import { useCallback, useEffect, useRef } from "react";

import type { Effects, StageState } from "./engine.js";

/** How loud the music and sound effects play before the script's own volume is applied. */
const MUSIC_VOLUME = 0.5;
const EFFECT_VOLUME = 0.7;

/** Props-like input for the hook. */
interface StoryAudioInput {
	/** The track the stage wants, or null for silence. */
	music: StageState["music"];
	/** The last walk's effects. A new object each walk, so its sounds play once per walk. */
	effects: Effects;
	/** Whether everything is muted. */
	muted: boolean;
	/** Resolves a reference to its published URL, or null. */
	urlOf: (ref: string) => string | null;
}

/**
 * Play the stage's music and sound effects. The track plays its intro once and then loops its loop. A reference with no published file stays
 * silent. The browser may block playback until the reader clicks. The returned `resume` retries it and is called on every click.
 *
 * @param input The music, sounds, mute state and URL resolver.
 * @returns A function that resumes blocked playback.
 */
export function useStoryAudio({ music, effects, muted, urlOf }: StoryAudioInput): () => void {
	const track = useRef<HTMLAudioElement | null>(null);
	const playing = useRef<HTMLAudioElement[]>([]);
	const mutedRef = useRef(muted);
	const loopKey = music?.loop ?? null;
	const introKey = music?.intro ?? null;
	const volume = music?.volume ?? 1;

	useEffect(() => {
		mutedRef.current = muted;
		if (track.current) {
			track.current.muted = muted;
		}
		for (const effect of playing.current) {
			effect.muted = muted;
		}
	}, [muted]);

	useEffect(() => {
		const loopUrl = loopKey ? urlOf(loopKey) : null;
		if (!loopUrl) {
			return;
		}
		const introUrl = introKey ? urlOf(introKey) : null;
		const makeTrack = (url: string) => {
			const audio = new Audio(url);
			audio.volume = MUSIC_VOLUME * volume;
			audio.muted = mutedRef.current;
			return audio;
		};
		const loop = makeTrack(loopUrl);
		loop.loop = true;
		if (introUrl) {
			const intro = makeTrack(introUrl);
			intro.addEventListener("ended", () => {
				if (track.current === intro) {
					track.current = loop;
					void loop.play().catch(() => undefined);
				}
			});
			track.current = intro;
		} else {
			track.current = loop;
		}
		void track.current.play().catch(() => undefined);
		return () => {
			track.current?.pause();
			track.current = null;
		};
	}, [loopKey, introKey, volume, urlOf]);

	useEffect(() => {
		if (effects.stopSounds) {
			for (const effect of playing.current) {
				effect.pause();
			}
			playing.current = [];
		}
		for (const sound of effects.sounds) {
			const url = urlOf(sound.key);
			if (!url) {
				continue;
			}
			const effect = new Audio(url);
			effect.volume = Math.min(1, EFFECT_VOLUME * sound.volume);
			effect.muted = mutedRef.current;
			playing.current.push(effect);
			effect.addEventListener("ended", () => {
				playing.current = playing.current.filter((entry) => entry !== effect);
			});
			void effect.play().catch(() => undefined);
		}
	}, [effects, urlOf]);

	// The music effect's cleanup stops the track on unmount. Sound effects outlive their walk, so they are stopped here.
	useEffect(
		() => () => {
			for (const effect of playing.current) {
				effect.pause();
			}
		},
		[]
	);

	return useCallback(() => {
		if (track.current?.paused) {
			void track.current.play().catch(() => undefined);
		}
	}, []);
}
