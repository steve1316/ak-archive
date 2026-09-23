import { useEffect, useRef } from "react";

import type { StageState } from "./engine.js";

/** How loud the music and sound effects play before the script's own volume is applied. */
const MUSIC_VOLUME = 0.5;
const EFFECT_VOLUME = 0.7;

/** Props-like input for the hook. */
interface StoryAudioInput {
	/** The track the stage wants, or null for silence. */
	music: StageState["music"];
	/** Sounds to play now, with a counter that changes each time a new batch arrives. */
	sounds: { id: number; list: { key: string; volume: number }[]; stop: boolean };
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
export function useStoryAudio({ music, sounds, muted, urlOf }: StoryAudioInput): () => void {
	const track = useRef<HTMLAudioElement | null>(null);
	const effects = useRef<HTMLAudioElement[]>([]);
	const mutedRef = useRef(muted);
	const loopKey = music?.loop ?? null;
	const introKey = music?.intro ?? null;
	const volume = music?.volume ?? 1;

	useEffect(() => {
		mutedRef.current = muted;
		if (track.current) {
			track.current.muted = muted;
		}
		for (const effect of effects.current) {
			effect.muted = muted;
		}
	}, [muted]);

	useEffect(() => {
		track.current?.pause();
		track.current = null;
		const loopUrl = loopKey ? urlOf(loopKey) : null;
		if (!loopUrl) {
			return;
		}
		const introUrl = introKey ? urlOf(introKey) : null;
		const loop = new Audio(loopUrl);
		loop.loop = true;
		loop.volume = MUSIC_VOLUME * volume;
		loop.muted = mutedRef.current;
		if (introUrl) {
			const intro = new Audio(introUrl);
			intro.volume = MUSIC_VOLUME * volume;
			intro.muted = mutedRef.current;
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
		if (sounds.stop) {
			for (const effect of effects.current) {
				effect.pause();
			}
			effects.current = [];
		}
		for (const sound of sounds.list) {
			const url = urlOf(sound.key);
			if (!url) {
				continue;
			}
			const effect = new Audio(url);
			effect.volume = Math.min(1, EFFECT_VOLUME * sound.volume);
			effect.muted = mutedRef.current;
			effects.current.push(effect);
			effect.addEventListener("ended", () => {
				effects.current = effects.current.filter((entry) => entry !== effect);
			});
			void effect.play().catch(() => undefined);
		}
	}, [sounds, urlOf]);

	useEffect(
		() => () => {
			track.current?.pause();
			for (const effect of effects.current) {
				effect.pause();
			}
		},
		[]
	);

	return () => {
		if (track.current?.paused) {
			void track.current.play().catch(() => undefined);
		}
	};
}
