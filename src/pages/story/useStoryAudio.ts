import { useCallback, useEffect, useRef, useState } from "react";

import type { Effects, StageState } from "./engine.js";

/** How loud the music and sound effects play before the script's own volume is applied. */
const MUSIC_VOLUME = 0.5;
const EFFECT_VOLUME = 0.7;

/** How often a fade steps the volume, in milliseconds. */
const FADE_STEP_MS = 50;

/** The running fade on each element, so a new fade replaces an old one instead of fighting it. */
const FADES = new WeakMap<HTMLAudioElement, number>();

/** Props-like input for the hook. */
interface StoryAudioInput {
	/** The track the stage wants, or null for silence. */
	music: StageState["music"];
	/** The last walk's effects. A new object each walk, so its sound cues run once per walk. */
	effects: Effects;
	/** Whether everything is muted. */
	muted: boolean;
	/** Resolves a reference to its published URL, or null. */
	urlOf: (ref: string) => string | null;
}

/** What the hook gives back. */
export interface StoryAudio {
	/** Retries playback the browser blocked. Called on every click and key press in the player. */
	resume: () => void;
	/** Whether the browser is holding playback until the reader clicks. */
	blocked: boolean;
}

/** A sound effect playing now, with the channel it was started on. */
interface PlayingSound {
	/** The element playing it. */
	audio: HTMLAudioElement;
	/** The script's channel, or null when none was named. */
	channel: string | null;
}

/**
 * Ramp an element's volume over time, replacing any fade already running on it. A fade of 0 seconds jumps straight to the end.
 *
 * @param audio The element.
 * @param to The volume to end at, 0 to 1.
 * @param seconds How long the fade takes.
 * @param done Called once the fade ends.
 */
function fadeVolume(audio: HTMLAudioElement, to: number, seconds: number, done?: () => void) {
	window.clearInterval(FADES.get(audio));
	if (seconds <= 0) {
		audio.volume = to;
		done?.();
		return;
	}
	const from = audio.volume;
	const steps = Math.max(1, Math.round((seconds * 1000) / FADE_STEP_MS));
	let step = 0;
	const timer = window.setInterval(() => {
		step++;
		audio.volume = Math.min(1, Math.max(0, from + ((to - from) * step) / steps));
		if (step >= steps) {
			window.clearInterval(timer);
			FADES.delete(audio);
			done?.();
		}
	}, FADE_STEP_MS);
	FADES.set(audio, timer);
}

/**
 * Play the stage's music and sound effects.
 *
 * The track plays its intro once and then loops its loop, fading in and out with the script's crossfade and `stopmusic` fade. Sound effects play
 * on the script's channels: a looping sound repeats until a `stopsound` for its channel, and a new sound on a busy channel replaces the old one.
 * A reference with no published file stays silent. The browser may block playback until the reader clicks, which `blocked` reports and `resume`
 * retries.
 *
 * @param input The music, effects, mute state and URL resolver.
 * @returns The resume function and whether playback is blocked.
 */
export function useStoryAudio({ music, effects, muted, urlOf }: StoryAudioInput): StoryAudio {
	const track = useRef<HTMLAudioElement | null>(null);
	const playing = useRef<PlayingSound[]>([]);
	const fadingOut = useRef(new Set<HTMLAudioElement>());
	const mutedRef = useRef(muted);
	const fades = useRef({ crossfade: 0, stop: 0 });
	const [blocked, setBlocked] = useState(false);
	const loopKey = music?.loop ?? null;
	const introKey = music?.intro ?? null;
	const volume = music?.volume ?? 1;

	const play = useCallback((audio: HTMLAudioElement) => {
		audio.play().then(
			() => setBlocked(false),
			(error: unknown) => {
				if (error instanceof DOMException && error.name === "NotAllowedError") {
					setBlocked(true);
				}
			}
		);
	}, []);

	const fadeOut = useCallback((audio: HTMLAudioElement, seconds: number) => {
		fadingOut.current.add(audio);
		fadeVolume(audio, 0, seconds, () => {
			audio.pause();
			fadingOut.current.delete(audio);
		});
	}, []);

	// The fade times for the music effect below, which runs only when the track itself changes.
	useEffect(() => {
		fades.current = { crossfade: music?.crossfade ?? 0, stop: effects.musicFade };
	});

	useEffect(() => {
		mutedRef.current = muted;
		for (const audio of [track.current, ...playing.current.map((sound) => sound.audio), ...fadingOut.current]) {
			if (audio) {
				audio.muted = muted;
			}
		}
	}, [muted]);

	useEffect(() => {
		const loopUrl = loopKey ? urlOf(loopKey) : null;
		const { crossfade, stop } = fades.current;
		if (track.current) {
			fadeOut(track.current, loopUrl ? crossfade : stop);
			track.current = null;
		}
		if (!loopUrl) {
			return;
		}
		const introUrl = introKey ? urlOf(introKey) : null;
		const target = MUSIC_VOLUME * volume;
		const makeTrack = (url: string) => {
			const audio = new Audio(url);
			audio.volume = target;
			audio.muted = mutedRef.current;
			return audio;
		};
		const loop = makeTrack(loopUrl);
		loop.loop = true;
		const first = introUrl ? makeTrack(introUrl) : loop;
		if (first !== loop) {
			first.addEventListener("ended", () => {
				if (track.current === first) {
					track.current = loop;
					play(loop);
				}
			});
		}
		track.current = first;
		if (crossfade > 0) {
			first.volume = 0;
			fadeVolume(first, target, crossfade);
		}
		play(first);
	}, [loopKey, introKey, volume, urlOf, play, fadeOut]);

	useEffect(() => {
		for (const cue of effects.sounds) {
			if (cue.kind === "stop") {
				const stopping = playing.current.filter((sound) => cue.channel === null || sound.channel === cue.channel);
				playing.current = playing.current.filter((sound) => !stopping.includes(sound));
				for (const sound of stopping) {
					fadeOut(sound.audio, cue.fade);
				}
				continue;
			}
			const url = urlOf(cue.key);
			if (!url) {
				continue;
			}
			if (cue.channel !== null) {
				for (const sound of playing.current.filter((entry) => entry.channel === cue.channel)) {
					sound.audio.pause();
				}
				playing.current = playing.current.filter((entry) => entry.channel !== cue.channel);
			}
			const audio = new Audio(url);
			audio.volume = Math.min(1, EFFECT_VOLUME * cue.volume);
			audio.loop = cue.loop;
			audio.muted = mutedRef.current;
			const sound = { audio, channel: cue.channel };
			playing.current.push(sound);
			audio.addEventListener("ended", () => {
				playing.current = playing.current.filter((entry) => entry !== sound);
			});
			play(audio);
		}
	}, [effects, urlOf, play, fadeOut]);

	// Leaving the story silences everything, including sounds still fading out.
	useEffect(
		() => () => {
			for (const audio of [track.current, ...playing.current.map((sound) => sound.audio), ...fadingOut.current]) {
				audio?.pause();
			}
		},
		[]
	);

	const resume = useCallback(() => {
		// One-shot sounds missed while blocked are stale by now, so only the music and looping sounds pick up again.
		for (const audio of [track.current, ...playing.current.filter((sound) => sound.audio.loop).map((sound) => sound.audio)]) {
			if (audio?.paused) {
				play(audio);
			}
		}
	}, [play]);

	return { resume, blocked };
}
