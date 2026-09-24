import { test } from "node:test";
import assert from "node:assert/strict";

import { addAssetRefs, emptyAssetRefs, musicKey, serializeAssetRefs, spriteKey } from "../../story/keys.mjs";

test("spriteKey lowercases a sprite name and turns # and $ into dashes, in all three upstream forms", () => {
	assert.equal(spriteKey("char_002_amiya_1#7"), "char_002_amiya_1-7");
	assert.equal(spriteKey("avg_npc_484_1#5$1"), "avg_npc_484_1-5-1");
	assert.equal(spriteKey("Avg_NPC_061"), "avg_npc_061");
});

test("musicKey gives an intro and its loop one key, and drops a bank name's $", () => {
	assert.equal(musicKey("Sound_Beta_2/Music/beta1_180603/m_dia_mist_loop"), "m_dia_mist");
	assert.equal(musicKey("Sound_Beta_2/Music/beta1_180603/m_dia_mist_intro"), "m_dia_mist");
	assert.equal(musicKey("Sound_Beta_2/Music/AVG/M_AVG_Darkness_03_loop"), "m_avg_darkness_03");
	assert.equal(musicKey("$sys_friend_loop"), "sys_friend");
});

test("addAssetRefs collects every asset a story names, by kind, once each", () => {
	const steps = [
		{ t: "cmd", c: "background", a: { image: "bg_cher_1" } },
		{ t: "cmd", c: "interlude", a: { name: "bg_lungmen_n" } },
		{ t: "cmd", c: "avgdisplay", a: { style: "bg", name: "bg_black" } },
		{ t: "cmd", c: "avgdisplay", a: { style: "bgeffect", name: "$eb_stage_02" } },
		{ t: "cmd", c: "image", a: { image: "avg_2_2" } },
		{ t: "cmd", c: "cgitem", a: { image: "cgitem_53_i05_1" } },
		{ t: "cmd", c: "largebg", a: { imagegroup: "60_i11_2L/60_i11_2R" } },
		{ t: "cmd", c: "showitem", a: { image: "item_act1_1" } },
		{ t: "cmd", c: "character", a: { name: "char_002_amiya_1#7", name2: "char_130_doberm_ex", focus: 1 } },
		{ t: "cmd", c: "charslot", a: { slot: "l", name: "avg_npc_484_1#5$1" } },
		{ t: "cmd", c: "character", a: {} },
		{ t: "cmd", c: "playmusic", a: { intro: "Sound_Beta_2/Music/m_intro", key: "Sound_Beta_2/Music/m_loop" } },
		{ t: "cmd", c: "playsound", a: { key: "Sound_Beta_2/AVG/d_gen_walk_n" } },
		{ t: "cmd", c: "playsound", a: { key: "Sound_Beta_2/AVG/d_gen_walk_n" } },
		{ t: "line", name: "Amiya", text: "Hi." }
	];
	const refs = emptyAssetRefs();
	addAssetRefs(steps, refs);
	assert.deepEqual(serializeAssetRefs(refs), {
		backgrounds: ["bg_black", "bg_cher_1", "bg_lungmen_n"],
		images: ["60_i11_2L", "60_i11_2R", "avg_2_2", "cgitem_53_i05_1"],
		items: ["item_act1_1"],
		sprites: ["avg_npc_484_1#5$1", "char_002_amiya_1#7", "char_130_doberm_ex"],
		music: ["Sound_Beta_2/Music/m_intro", "Sound_Beta_2/Music/m_loop"],
		sounds: ["Sound_Beta_2/AVG/d_gen_walk_n"]
	});
});

test("addAssetRefs also collects grid, vertical and cg-group backgrounds and the single images tweens, cg hides and blockers name", () => {
	const refs = emptyAssetRefs();
	addAssetRefs(
		[
			{ t: "cmd", c: "gridbg", a: { imagegroup: "g1/g2" } },
			{ t: "cmd", c: "verticalbg", a: { imagegroup: "v1" } },
			{ t: "cmd", c: "largebg", a: { cggroup: "c1/c2" } },
			{ t: "cmd", c: "imagetween", a: { image: "lungmen" } },
			{ t: "cmd", c: "hidecgitem", a: { image: "cgitem_x" } },
			{ t: "cmd", c: "blocker", a: { image: "blocker_movi" } }
		],
		refs
	);
	assert.deepEqual(serializeAssetRefs(refs).images, ["blocker_movi", "c1", "c2", "cgitem_x", "g1", "g2", "lungmen", "v1"]);
});
