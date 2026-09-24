import { useEffect, useState } from "react";

import { loadMusicTitles } from "../../lib/story.js";

/**
 * The title of each music track by track key, for the Now Playing note and the Log. They load the first time a player asks, and the store
 * keeps them, so a turned phone or the next story does not fetch them again. Until they arrive there are none.
 *
 * @returns The titles, such as `{ m_dia_street: "City" }`.
 */
export function useMusicTitles(): Record<string, string> {
	const [titles, setTitles] = useState<Record<string, string>>({});
	useEffect(() => {
		void loadMusicTitles().then(setTitles);
	}, []);
	return titles;
}
