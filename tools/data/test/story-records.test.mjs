import { test } from "node:test";
import assert from "node:assert/strict";

import { filterOperators, letterOf, pickSkinKey, recordOperators } from "../../../src/pages/stories/records.ts";

const SEARCH = [
	{ id: "char_jk", name: "'Justice Knight'", rarity: 1, profession: "Sniper" },
	{ id: "char_12f", name: "12F", rarity: 2, profession: "Caster" },
	{ id: "char_amiya", name: "Amiya", rarity: 5, profession: "Caster" },
	{ id: "char_eyja", name: "Ëyjafjalla", rarity: 6, profession: "Caster" },
	{ id: "char_aak", name: "Aak", rarity: 6, profession: "Specialist" }
];

const RECORDS = [
	{ operator: "char_amiya", sets: [{ group: "story_amiya_set_1", name: "Tides" }] },
	{ operator: "char_jk", sets: [{ group: "story_jk_set_1", name: "Justice" }] },
	{
		operator: "char_eyja",
		sets: [
			{ group: "story_eyja_set_1", name: "Volcano" },
			{ group: "story_eyja_set_2", name: "Ash" }
		]
	},
	{ operator: "char_12f", sets: [{ group: "story_12f_set_1", name: "Choices" }] },
	{ operator: "char_aak", sets: [{ group: "story_aak_set_1", name: "Night" }] },
	{ operator: "char_nobody", sets: [] }
];

test("letterOf files a name under its first letter or digit, skipping quotes and accents", () => {
	assert.equal(letterOf("'Justice Knight'"), "J");
	assert.equal(letterOf("12F"), "1");
	assert.equal(letterOf("Ëyjafjalla"), "E");
	assert.equal(letterOf("amiya"), "A");
	assert.equal(letterOf("---"), "#");
});

test("recordOperators lists operators with record sets by letter then name, with their class and rarity", () => {
	const operators = recordOperators(RECORDS, SEARCH);
	assert.deepEqual(
		operators.map((operator) => [operator.name, operator.letter]),
		[
			["12F", "1"],
			["Aak", "A"],
			["Amiya", "A"],
			["Ëyjafjalla", "E"],
			["'Justice Knight'", "J"]
		]
	);
	const eyja = operators.find((operator) => operator.id === "char_eyja");
	assert.deepEqual([eyja.rarity, eyja.profession, eyja.sets.map((set) => set.group)], [6, "Caster", ["story_eyja_set_1", "story_eyja_set_2"]]);
});

test("filterOperators matches the name ignoring case and accents, and narrows by class and rarity", () => {
	const operators = recordOperators(RECORDS, SEARCH);
	const names = (filter) => filterOperators(operators, filter).map((operator) => operator.name);
	assert.deepEqual(names({ query: "", classes: new Set(), rarities: new Set() }).length, 5);
	assert.deepEqual(names({ query: "eyja", classes: new Set(), rarities: new Set() }), ["Ëyjafjalla"]);
	assert.deepEqual(names({ query: "  JUSTICE ", classes: new Set(), rarities: new Set() }), ["'Justice Knight'"]);
	assert.deepEqual(names({ query: "", classes: new Set(["Caster"]), rarities: new Set([6]) }), ["Ëyjafjalla"]);
	assert.deepEqual(names({ query: "", classes: new Set(["Caster", "Specialist"]), rarities: new Set() }), ["12F", "Aak", "Amiya", "Ëyjafjalla"]);
});

test("pickSkinKey prefers an outfit, falls back to the elite art, and returns null for the base art", () => {
	assert.equal(
		pickSkinKey(["2", "epoque_4", "winter_1"], () => 0),
		"epoque_4"
	);
	assert.equal(
		pickSkinKey(["2", "epoque_4", "winter_1"], () => 0.99),
		"winter_1"
	);
	assert.equal(
		pickSkinKey(["2"], () => 0.5),
		"2"
	);
	assert.equal(
		pickSkinKey(["1plus", "2"], () => 0),
		"1plus"
	);
	assert.equal(
		pickSkinKey([], () => 0.5),
		null
	);
});
