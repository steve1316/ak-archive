/**
 * The title of each music track the stories play, so the player can say what is playing. Three sources, the first that has a track wins: the
 * game's own jukebox names, the hand-kept list in `music-titles.json` (seeded from the Arknights Wiki on wiki.gg), and the track's key tidied
 * up. Most story tracks have no official title anywhere, so the tidied key is what most of them show.
 */

import fs from "node:fs";

import { asArray, sortedObject } from "../data/lib/json.mjs";
import { musicKey } from "./keys.mjs";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Module constants

/** The hand-kept titles, next to this file. */
const CURATED_FILE = new URL("./music-titles.json", import.meta.url);

/** The first word of most keys, which only says where the track plays: dialogue, a story scene, a battle or a menu. */
const PLACE_WORDS = new Set(["avg", "dia", "bat", "sys", "sys2", "sys3"]);

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Titles

/**
 * Tidy whitespace in a title, including the no-break spaces some upstream names carry.
 *
 * @param {string} title The raw title.
 * @returns {string} The title with single ordinary spaces.
 */
function tidy(title) {
	return title.replace(/\s+/g, " ").trim();
}

/**
 * A track's key made readable, for a track no source titles: the `m_` and place prefixes dropped, numbers split off, each word capitalised.
 *
 * @param {string} key The track key, such as `m_avg_darkness_03` or `m_dia_mist`.
 * @returns {string} The title, such as `Darkness 03` or `Mist`.
 */
export function prettyTitle(key) {
	const words = key
		.replace(/^[md]_/, "")
		.split("_")
		.filter(Boolean);
	if (words.length > 1 && PLACE_WORDS.has(words[0])) {
		words.shift();
	}
	return words
		.flatMap((word) => word.split(/(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/))
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/**
 * The game's own jukebox names by track key. A jukebox entry names a sound bank, and the bank holds the intro and loop files it plays.
 *
 * @param {{musics?: Array<{name?: string, bank?: string}>, bgmBanks?: Array<{name: string, intro?: string, loop?: string}>}} audioData
 * `audio_data`.
 * @returns {Map<string, string>} The title of each track key the jukebox names.
 */
export function officialTitles(audioData) {
	const banks = new Map(asArray(audioData.bgmBanks).map((bank) => [bank.name, bank]));
	const titles = new Map();
	for (const entry of asArray(audioData.musics)) {
		const bank = banks.get(entry.bank);
		const name = tidy(entry.name ?? "");
		if (!bank || !name) {
			continue;
		}
		for (const file of [bank.loop, bank.intro]) {
			const key = file ? musicKey(file) : null;
			if (key && !titles.has(key)) {
				titles.set(key, name);
			}
		}
	}
	return titles;
}

/**
 * The title of every track the stories play, from the first source that has it. A sound a script plays on the music channel, such as a heart
 * monitor under `Dialog/`, is not a song and gets no title, so the player shows nothing for it.
 *
 * @param {string[]} refs Every music reference the stories play.
 * @param {Map<string, string>} official The game's own jukebox names.
 * @param {Record<string, string>} curated The hand-kept titles.
 * @returns {Record<string, string>} Each track key's title, sorted by key.
 */
export function buildMusicTitles(refs, official, curated) {
	const keys = new Set(refs.filter((ref) => !ref.includes("/Dialog/")).map(musicKey));
	// The hand-kept titles are tidied too, in case one is pasted with a no-break space.
	return sortedObject(Object.fromEntries([...keys].map((key) => [key, official.get(key) ?? (Object.hasOwn(curated, key) ? tidy(curated[key]) : prettyTitle(key))])));
}

/**
 * The title of every track the stories play, from the game's jukebox, the hand-kept list and the tidied key.
 *
 * @param {string[]} musicRefs Every music reference the stories play.
 * @param {object} audioData `audio_data`.
 * @returns {Record<string, string>} Each track key's title, sorted by key.
 */
export function musicTitles(musicRefs, audioData) {
	const curated = JSON.parse(fs.readFileSync(CURATED_FILE, "utf8")).titles;
	return buildMusicTitles(musicRefs, officialTitles(audioData), curated);
}
