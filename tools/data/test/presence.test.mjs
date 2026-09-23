import { test } from "node:test";
import assert from "node:assert/strict";

import { EMPTY_PRESENCE, slimManifest } from "../lib/presence.mjs";

const MANIFEST = {
	portraits: { char_a: true, char_b: false },
	illustrations: { char_a: true },
	skins: { char_a: ["summer_1"] },
	variants: { portraits: { char_a: ["2"] }, illustrations: {} },
	skillIcons: ["skcom_a"],
	enemies: { enemy_2: false, enemy_3: true },
	moduleArt: ["uniequip_002_a"],
	moduleTypes: ["swo-x"]
};

test("slimManifest keeps only what the site reads, with presence turned into lists of what is missing", () => {
	assert.deepEqual(slimManifest(MANIFEST, { operators: ["char_a", "char_b"], enemies: ["enemy_2", "enemy_3"] }), {
		available: true,
		missing: { portraits: ["char_b"], illustrations: ["char_b"], enemies: ["enemy_2"] },
		variants: { portraits: { char_a: ["2"] }, illustrations: {} },
		moduleArt: ["uniequip_002_a"],
		moduleTypes: ["swo-x"]
	});
});

test("an id the data names but the manifest never mentions counts as missing, so a page fails closed to a placeholder", () => {
	const slim = slimManifest(MANIFEST, { operators: ["char_a", "char_new"], enemies: ["enemy_3", "enemy_new"] });
	assert.deepEqual(slim.missing, { portraits: ["char_new"], illustrations: ["char_new"], enemies: ["enemy_new"] });
});

test("EMPTY_PRESENCE has the same shape as a real one, marked unavailable", () => {
	assert.equal(EMPTY_PRESENCE.available, false);
	assert.deepEqual(Object.keys(EMPTY_PRESENCE).sort(), Object.keys(slimManifest(MANIFEST, { operators: [], enemies: [] })).sort());
});
