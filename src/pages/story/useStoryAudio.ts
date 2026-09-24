import { useCallback, useEffect, useRef, useState } from "react";

import type { Effects, StageState } from "./engine.js";

/** How loud the music and sound effects play before the script's own volume and the reader's volumes apply. */
const MUSIC_VOLUME = 0.5;
const EFFECT_VOLUME = 0.7;

/** How often a fade steps the volume, in milliseconds. */
const FADE_STEP_MS = 50;

/** The running fade on each element, so a new fade replaces an old one instead of fighting it. */
const FADES = new WeakMap<HTMLAudioElement, number>();

/**
 * Each element's level before the reader's own volume: the balance above times the script's volume. Fades move this rather than the element's
 * volume, so a slider moved mid-fade carries through the rest of the fade.
 */
const LEVELS = new WeakMap<HTMLAudioElement, number>();

/** The elements that play music, which follow the reader's BGM volume. Every other element follows the SFX volume. */
const MUSIC_TRACKS = new WeakSet<HTMLAudioElement>();

/** Props-like input for the hook. */
interface StoryAudioInput {
	/** The track the stage wants, or null for silence. */
	music: StageState["music"];
	/** The last walk's effects. A new object each walk, so its sound cues run once per walk. */
	effects: Effects;
	/** Whether everything is muted. */
	muted: boolean;
	/** The reader's music volume, 0 to 1, over the balance above. */
	bgm: number;
	/** The reader's sound effect volume, 0 to 1, over the balance above. */
	sfx: number;
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
 * Ramp an element's level over time, replacing any fade already running on it. A fade of 0 seconds jumps straight to the end.
 *
 * @param audio The element.
 * @param to The level to end at, 0 to 1.
 * @param seconds How long the fade takes.
 * @param apply Writes the element's level, times the reader's volume, to the element.
 * @param done Called once the fade ends.
 */
function fadeVolume(audio: HTMLAudioElement, to: number, seconds: number, apply: (audio: HTMLAudioElement) => void, done?: () => void) {
	window.clearInterval(FADES.get(audio));
	if (seconds <= 0) {
		LEVELS.set(audio, to);
		apply(audio);
		done?.();
		return;
	}
	const from = LEVELS.get(audio) ?? 0;
	const steps = Math.max(1, Math.round((seconds * 1000) / FADE_STEP_MS));
	let step = 0;
	const timer = window.setInterval(() => {
		step++;
		LEVELS.set(audio, from + ((to - from) * step) / steps);
		apply(audio);
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
 * @param input The music, effects, mute state, the reader's volumes and the URL resolver.
 * @returns The resume function and whether playback is blocked.
 */
export function useStoryAudio({ music, effects, muted, bgm, sfx, urlOf }: StoryAudioInput): StoryAudio {
	const track = useRef<HTMLAudioElement | null>(null);
	const playing = useRef<PlayingSound[]>([]);
	const fadingOut = useRef(new Set<HTMLAudioElement>());
	const mutedRef = useRef(muted);
	const gains = useRef({ bgm, sfx });
	const fades = useRef({ crossfade: 0, stop: 0 });
	const [blocked, setBlocked] = useState(false);
	const loopKey = music?.loop ?? null;
	const introKey = music?.intro ?? null;
	const volume = music?.volume ?? 1;

	/** Every element this hook owns: the track, the sound effects and anything still fading out. */
	const allAudio = useCallback(() => [track.current, ...playing.current.map((sound) => sound.audio), ...fadingOut.current].filter((audio) => audio !== null), []);

	/**
	 * Write an element's level, times the reader's volume for its kind, to the element.
	 *
	 * @param audio The element.
	 */
	const apply = useCallback((audio: HTMLAudioElement) => {
		const gain = MUSIC_TRACKS.has(audio) ? gains.current.bgm : gains.current.sfx;
		audio.volume = Math.min(1, Math.max(0, (LEVELS.get(audio) ?? 0) * gain));
	}, []);

	const play = useCallback((audio: HTMLAudioElement) => {
		audio.play().then(
			() => setBlocked(false),
			(error: unknown) => {
				if (error instanceof DOMException && error.name === "NotAllowedError") {
					setBlocked(true);
				}
				// A one-shot that could not start is stale by the time it could, so it is dropped rather than resumed later.
				if (!audio.loop) {
					playing.current = playing.current.filter((sound) => sound.audio !== audio);
				}
			}
		);
	}, []);

	const fadeOut = useCallback(
		(audio: HTMLAudioElement, seconds: number) => {
			fadingOut.current.add(audio);
			fadeVolume(audio, 0, seconds, apply, () => {
				audio.pause();
				fadingOut.current.delete(audio);
			});
		},
		[apply]
	);

	const stopChannel = useCallback(
		(channel: string | null, seconds: number) => {
			const stopping = playing.current.filter((sound) => channel === null || sound.channel === channel);
			playing.current = playing.current.filter((sound) => !stopping.includes(sound));
			for (const sound of stopping) {
				fadeOut(sound.audio, seconds);
			}
		},
		[fadeOut]
	);

	// The fade times for the music effect below, which runs only when the track itself changes.
	const crossfade = music?.crossfade ?? 0;
	useEffect(() => {
		fades.current = { crossfade, stop: effects.musicFade };
	}, [crossfade, effects.musicFade]);

	useEffect(() => {
		mutedRef.current = muted;
		for (const audio of allAudio()) {
			audio.muted = muted;
		}
	}, [muted, allAudio]);

	// The reader's volumes apply at once: to the track, the sounds and anything fading, whose next step then uses them too.
	useEffect(() => {
		gains.current = { bgm, sfx };
		for (const audio of allAudio()) {
			apply(audio);
		}
	}, [bgm, sfx, allAudio, apply]);

	useEffect(() => {
		const loopUrl = loopKey ? urlOf(loopKey) : null;
		const { crossfade: fadeIn, stop } = fades.current;
		if (track.current) {
			fadeOut(track.current, loopUrl ? fadeIn : stop);
			track.current = null;
		}
		if (!loopUrl) {
			return;
		}
		const introUrl = introKey ? urlOf(introKey) : null;
		const target = MUSIC_VOLUME * volume;
		const makeTrack = (url: string) => {
			const audio = new Audio(url);
			MUSIC_TRACKS.add(audio);
			LEVELS.set(audio, target);
			apply(audio);
			audio.muted = mutedRef.current;
			return audio;
		};
		const loop = makeTrack(loopUrl);
		loop.loop = true;
		const first = introUrl ? makeTrack(introUrl) : loop;
		if (introUrl) {
			first.addEventListener("ended", () => {
				if (track.current === first) {
					// The loop waited out the intro outside the owned elements, so it takes the reader's current volume and mute now.
					track.current = loop;
					apply(loop);
					loop.muted = mutedRef.current;
					play(loop);
				}
			});
		}
		track.current = first;
		if (fadeIn > 0) {
			fadeVolume(first, 0, 0, apply);
			fadeVolume(first, target, fadeIn, apply);
		}
		play(first);
	}, [loopKey, introKey, volume, urlOf, play, fadeOut, apply]);

	useEffect(() => {
		for (const cue of effects.sounds) {
			if (cue.kind === "stop") {
				stopChannel(cue.channel, cue.fade);
				continue;
			}
			const url = urlOf(cue.key);
			if (!url) {
				continue;
			}
			if (cue.channel !== null) {
				stopChannel(cue.channel, 0);
			}
			const audio = new Audio(url);
			LEVELS.set(audio, Math.min(1, EFFECT_VOLUME * cue.volume));
			apply(audio);
			audio.loop = cue.loop;
			audio.muted = mutedRef.current;
			const sound = { audio, channel: cue.channel };
			playing.current.push(sound);
			audio.addEventListener("ended", () => {
				playing.current = playing.current.filter((entry) => entry !== sound);
			});
			play(audio);
		}
	}, [effects, urlOf, play, stopChannel, apply]);

	// Leaving the story silences everything, including sounds still fading out, and stops their fade timers.
	useEffect(
		() => () => {
			for (const audio of allAudio()) {
				window.clearInterval(FADES.get(audio));
				audio.pause();
			}
		},
		[allAudio]
	);

	const resume = useCallback(() => {
		// The reader's click lets audio play from here on. Anything that is refused again sets `blocked` back.
		setBlocked(false);
		for (const audio of allAudio()) {
			if (audio.paused && (audio === track.current || audio.loop) && !fadingOut.current.has(audio)) {
				play(audio);
			}
		}
	}, [allAudio, play]);

	return { resume, blocked };
}
