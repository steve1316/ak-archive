import { useEffect, useState } from "react";

import { loadMusicTitles, musicTitle } from "../../lib/story.js";
import type { StageState } from "./engine.js";

/**
 * The title of the track playing, so a reader can find it later. The titles load the first time a player asks, and the store keeps them, so a
 * turned phone or the next story does not fetch them again. Until they arrive, and while the scene is silent, there is no title.
 *
 * @param music The track the stage plays, or null for silence.
 * @returns The title, such as `Mist`, or null.
 */
export function useNowPlaying(music: StageState["music"]): string | null {
	const [titles, setTitles] = useState<Record<string, string>>({});
	useEffect(() => {
		void loadMusicTitles().then(setTitles);
	}, []);
	return music ? musicTitle(titles, music.loop) : null;
}
