import { test } from "node:test";
import assert from "node:assert/strict";

import { buildMusicTitles, officialTitles, prettyTitle } from "../../story/music_titles.mjs";

test("prettyTitle drops the prefixes, splits off numbers and capitalises each word", () => {
	assert.equal(prettyTitle("m_dia_mist"), "Mist");
	assert.equal(prettyTitle("m_avg_darkness_03"), "Darkness 03");
	assert.equal(prettyTitle("m_avg_exciting02"), "Exciting 02");
	assert.equal(prettyTitle("m_sys_act23side"), "Act 23 Side");
	assert.equal(prettyTitle("sys_friend"), "Friend");
	// A key that is only a place word keeps it, rather than showing nothing.
	assert.equal(prettyTitle("m_sys"), "Sys");
});

test("officialTitles names both halves of a jukebox track through its bank, skipping blank names", () => {
	const audioData = {
		musics: [
			{ id: "a", name: "City", bank: "sys.street" },
			{ id: "b", name: "", bank: "sys.blank" },
			{ id: "c", name: "Our Life", bank: "sys.siesta" }
		],
		bgmBanks: [
			{ name: "sys.street", intro: "Audio/Sound_Beta_2/Music/x/m_dia_street_intro", loop: "Audio/Sound_Beta_2/Music/x/m_dia_street_loop" },
			{ name: "sys.blank", loop: "Audio/Sound_Beta_2/Music/x/m_avg_blank_loop" },
			{ name: "sys.siesta", loop: "Audio/Sound_Beta_2/Music/x/m_avg_siestacity_loop" }
		]
	};
	const titles = officialTitles(audioData);
	assert.equal(titles.get("m_dia_street"), "City");
	assert.equal(titles.has("m_avg_blank"), false);
	assert.equal(titles.get("m_avg_siestacity"), "Our Life");
});

test("buildMusicTitles prefers the jukebox, then the hand-kept list, then the tidied key, and skips sound effects", () => {
	const refs = ["x/m_dia_street_loop", "x/m_dia_street_intro", "x/m_avg_tremont_loop", "x/m_dia_mist_loop", "Sound_Beta_2/Dialog/d_avg_ekg_loop"];
	const official = new Map([["m_dia_street", "City"]]);
	const curated = { m_dia_street: "Not This", m_avg_tremont: "Tremont's Sky" };
	assert.deepEqual(buildMusicTitles(refs, official, curated), { m_avg_tremont: "Tremont's Sky", m_dia_mist: "Mist", m_dia_street: "City" });
});
