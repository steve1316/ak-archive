import { test } from "node:test";
import assert from "node:assert/strict";

import { EMPTY_PRESENCE, slimManifest } from "../lib/presence.mjs";

test("slimManifest keeps only what the site reads, with near-complete flag maps turned into missing lists", () => {
	const manifest = {
		portraits: { char_a: true, char_b: false },
		illustrations: { char_a: true },
		skins: { char_a: ["summer_1"] },
		variants: { portraits: { char_a: ["2"] }, illustrations: {} },
		skillIcons: ["skcom_a"],
		enemies: { enemy_2: false, enemy_1: false, enemy_3: true },
		moduleArt: ["uniequip_002_a"],
		moduleTypes: ["swo-x"]
	};
	assert.deepEqual(slimManifest(manifest), {
		available: true,
		missing: { portraits: ["char_b"], illustrations: [], enemies: ["enemy_1", "enemy_2"] },
		variants: { portraits: { char_a: ["2"] }, illustrations: {} },
		moduleArt: ["uniequip_002_a"],
		moduleTypes: ["swo-x"]
	});
});

test("EMPTY_PRESENCE marks the manifest unavailable, so every presence check fails closed", () => {
	assert.equal(EMPTY_PRESENCE.available, false);
});
