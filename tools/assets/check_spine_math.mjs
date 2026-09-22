#!/usr/bin/env node
/**
 * The maths gate for the Spine runtime: builds tiny synthetic skeletons, poses them with `src/spine/skeleton.ts`, and checks the bone world
 * transforms and setup-pose attachments against hand-worked values. `MATH.md` explains each formula the cases pin down.
 *
 * Usage:
 *     node tools/assets/check_spine_math.mjs
 *
 * Prints one line per case and exits 1 when any case fails, naming the case with its expected and actual values.
 */

import { startVite } from "./spine_tools.mjs";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Largest difference allowed between an expected and an actual number. */
const TOLERANCE = 1e-4;

/** The parent bone every inherit case shares: a root at the origin with world basis `[0 -1; 2 0]`. */
const ROTATED_PARENT = { rotation: 90, scaleX: 2, scaleY: 1 };

/** A reflected parent: a root at the origin with world basis `[-1 0; 0 1]`. */
const REFLECTED_PARENT = { rotation: 0, scaleX: -1 };

/**
 * The bone world transform cases. Each names the bones to build (the last one is checked), any skeleton settings, and the expected world
 * position and the world points the checked bone's local `(1, 0)` and `(0, 1)` map to.
 */
const BONE_CASES = [
	{ name: "A normal", bones: [ROTATED_PARENT, { x: 10 }], origin: [0, 20], unitX: [0, 22], unitY: [-1, 20] },
	{ name: "B onlyTranslation", bones: [ROTATED_PARENT, { x: 10, transformMode: "onlyTranslation" }], origin: [0, 20], unitX: [1, 20], unitY: [0, 21] },
	{ name: "C noScale", bones: [ROTATED_PARENT, { x: 10, transformMode: "noScale" }], origin: [0, 20], unitX: [0, 21], unitY: [-1, 20] },
	{
		name: "D noRotationOrReflection",
		bones: [ROTATED_PARENT, { x: 10, transformMode: "noRotationOrReflection" }],
		origin: [0, 20],
		unitX: [2, 20],
		unitY: [0, 21]
	},
	{ name: "E shear", bones: [{ shearY: 45 }], origin: [0, 0], unitX: [1, 0], unitY: [-0.70711, 0.70711] },
	{ name: "F noScale, reflected parent", bones: [REFLECTED_PARENT, { x: 10, transformMode: "noScale" }], origin: [-10, 0], unitX: [-11, 0], unitY: [-10, 1] },
	{
		name: "G noScaleOrReflection, reflected parent",
		bones: [REFLECTED_PARENT, { x: 10, transformMode: "noScaleOrReflection" }],
		origin: [-10, 0],
		unitX: [-11, 0],
		unitY: [-10, -1]
	},
	{ name: "H skeleton scale", skeleton: { scaleY: -1 }, bones: [{}, { x: 10 }], origin: [10, 0], unitX: [11, 0], unitY: [10, -1] },
	// A nonuniform parent bends a rotated noScale child's axes without changing their length.
	{
		name: "N noScale, nonuniform parent",
		bones: [{ scaleX: 2 }, { rotation: 45, transformMode: "noScale" }],
		origin: [0, 0],
		unitX: [0.89443, 0.44721],
		unitY: [-0.89443, 0.44721]
	},
	{ name: "S shearX", bones: [{ shearX: 30 }], origin: [0, 0], unitX: [0.86603, 0.5], unitY: [0, 1] },
	// The parent's Y axis has zero length, so the child's Y axis falls back to the parent's X axis angle.
	{
		name: "Z noScale, zero-length fallback",
		bones: [
			{ rotation: 90, scaleY: 0 },
			{ x: 10, transformMode: "noScale" }
		],
		origin: [0, 10],
		unitX: [0, 11],
		unitY: [-1, 10]
	},
	{
		name: "X1 middle, noScale under a rotated nonuniform root",
		bones: [
			{ rotation: 30, scaleX: 2, scaleY: 0.5 },
			{ x: 5, rotation: 20, scaleX: 1.5, transformMode: "noScale" }
		],
		origin: [8.66025, 5],
		unitX: [9.88598, 5.86463],
		unitY: [7.66331, 5.07818]
	},
	{
		name: "X1 leaf, normal under the noScale middle",
		bones: [{ rotation: 30, scaleX: 2, scaleY: 0.5 }, { x: 5, rotation: 20, scaleX: 1.5, transformMode: "noScale" }, { x: 4 }],
		origin: [13.56317, 8.45852],
		unitX: [14.7889, 9.32315],
		unitY: [12.56623, 8.5367]
	},
	{
		name: "X2 onlyTranslation under a sheared root",
		bones: [
			{ rotation: 10, shearX: 30, shearY: -20 },
			{ x: 3, y: 2, rotation: 40, scaleX: 2, transformMode: "onlyTranslation" }
		],
		origin: [2.64543, 3.89798],
		unitX: [4.17752, 5.18355],
		unitY: [2.00264, 4.66402]
	},
	{
		name: "X3 noRotationOrReflection under a reflected root",
		bones: [
			{ rotation: 30, scaleX: -1, scaleY: 2 },
			{ x: 2, rotation: 15, transformMode: "noRotationOrReflection" }
		],
		origin: [-1.73205, -1],
		unitX: [-0.76613, -0.48236],
		unitY: [-1.99087, 0.93185]
	}
];

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Builds one bone's setup data, with an identity transform unless overridden. Each bone after the first is a child of the one before it.
 *
 * @param {object} overrides Fields to set on top of the identity transform.
 * @param {number} index The bone's index in the skeleton.
 * @returns {import("../../src/spine/types.ts").BoneData} The bone data.
 */
function boneData(overrides, index) {
	return {
		name: `bone${index}`,
		parentIndex: index === 0 ? null : index - 1,
		rotation: 0,
		x: 0,
		y: 0,
		scaleX: 1,
		scaleY: 1,
		shearX: 0,
		shearY: 0,
		length: 0,
		transformMode: "normal",
		skinRequired: false,
		color: null,
		...overrides
	};
}

/**
 * Builds a synthetic skeleton holding only what `skeleton.ts` reads. Every other array is empty.
 *
 * @param {object[]} bones Per-bone overrides, in parent-first order.
 * @param {object[]} slots The slot data.
 * @param {object[]} skins The skins, with the default skin first.
 * @returns {import("../../src/spine/types.ts").SkeletonData} The skeleton data.
 */
function skeletonData(bones, slots = [], skins = [{ name: "default", attachments: new Map() }]) {
	return {
		version: "3.8.99",
		x: 0,
		y: 0,
		width: 0,
		height: 0,
		fps: null,
		bones: bones.map(boneData),
		slots,
		ik: [],
		transform: [],
		path: [],
		skins,
		events: [],
		animations: []
	};
}

/**
 * Builds one slot's setup data on the root bone.
 *
 * @param {string} name The slot's name.
 * @param {string | null} attachmentName The setup attachment's name, or null for none.
 * @returns {import("../../src/spine/types.ts").SlotData} The slot data.
 */
function slotData(name, attachmentName) {
	const white = { r: 1, g: 1, b: 1, a: 1 };
	return { name, boneIndex: 0, color: white, darkColor: null, attachmentName, blendMode: "normal" };
}

/**
 * Builds a point attachment, the smallest attachment type, to stand in for any attachment.
 *
 * @param {string} name The attachment's name.
 * @returns {import("../../src/spine/types.ts").PointAttachment} The attachment.
 */
function point(name) {
	return { type: "point", name, rotation: 0, x: 0, y: 0, color: null };
}

/**
 * Checks two points are equal within `TOLERANCE`.
 *
 * @param {number[]} expected The expected point.
 * @param {number[]} actual The actual point.
 * @returns {boolean} True when every coordinate is close enough.
 */
function close(expected, actual) {
	return expected.every((value, index) => Math.abs(value - actual[index]) <= TOLERANCE);
}

/**
 * Formats a point for printing.
 *
 * @param {number[]} values The point.
 * @returns {string} The point as `(x, y)`, rounded to 5 places.
 */
function shown(values) {
	return `(${values.map((value) => Number(value.toFixed(5))).join(", ")})`;
}

/**
 * Runs every bone world transform case.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @returns {string[]} One failure message per mismatch.
 */
function checkBones(skeletonModule) {
	const { Skeleton, localToWorld } = skeletonModule;
	const failures = [];
	for (const testCase of BONE_CASES) {
		const skeleton = new Skeleton(skeletonData(testCase.bones));
		Object.assign(skeleton, testCase.skeleton ?? {});
		skeleton.setToSetupPose();
		skeleton.updateWorldTransform();
		const bone = skeleton.bones[skeleton.bones.length - 1];
		const checks = [
			["world position", testCase.origin, [bone.worldX, bone.worldY]],
			["local (1, 0)", testCase.unitX, localToWorld(bone, 1, 0)],
			["local (0, 1)", testCase.unitY, localToWorld(bone, 0, 1)]
		];
		const caseFailures = checks.filter(([, expected, actual]) => !close(expected, actual));
		for (const [label, expected, actual] of caseFailures) {
			failures.push(`${testCase.name}: ${label} expected ${shown(expected)}, got ${shown(actual)}`);
		}
		console.log(`${caseFailures.length === 0 ? "ok  " : "FAIL"} ${testCase.name}`);
	}
	return failures;
}

/**
 * Checks `setToSetupPose` puts a changed bone, slot attachment and draw order back to the data values.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @returns {string[]} One failure message per mismatch.
 */
function checkReset(skeletonModule) {
	const setupA = point("a");
	const skins = [{ name: "default", attachments: new Map([[0, new Map([["a", setupA]])]]) }];
	const skeleton = new skeletonModule.Skeleton(skeletonData([{ x: 3, rotation: 15 }], [slotData("front", "a"), slotData("back", null)], skins));
	const bone = skeleton.bones[0];
	bone.rotation = 99;
	bone.x = -7;
	skeleton.slots[0].attachment = null;
	skeleton.drawOrder.reverse();
	skeleton.setToSetupPose();

	const results = [
		["bone rotation", 15, bone.rotation],
		["bone x", 3, bone.x],
		["slot attachment", setupA, skeleton.slots[0].attachment],
		["draw order", skeleton.slots[0], skeleton.drawOrder[0]]
	];
	const failures = [];
	for (const [label, expected, actual] of results) {
		const ok = expected === actual;
		console.log(`${ok ? "ok  " : "FAIL"} reset: ${label}`);
		if (!ok) {
			failures.push(`reset: ${label} expected ${expected?.name ?? expected?.data?.name ?? expected}, got ${actual?.name ?? actual?.data?.name ?? actual}`);
		}
	}
	return failures;
}

/**
 * Checks the setup pose picks each slot's attachment from the current skin first, then the default skin, and leaves a null name empty.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @returns {string[]} One failure message per mismatch.
 */
function checkAttachments(skeletonModule) {
	const defaultA = point("a");
	const defaultB = point("b");
	const altA = point("a");
	const skins = [
		{
			name: "default",
			attachments: new Map([
				[
					0,
					new Map([
						["a", defaultA],
						["b", defaultB]
					])
				]
			])
		},
		{ name: "alt", attachments: new Map([[0, new Map([["a", altA]])]]) }
	];
	const skeleton = new skeletonModule.Skeleton(skeletonData([{}], [slotData("front", "a"), slotData("empty", null)], skins));
	const results = [];

	skeleton.setSkin("alt");
	skeleton.setToSetupPose();
	results.push(["skin attachment wins over default", altA, skeleton.slots[0].attachment]);
	results.push(["null name gives no attachment", null, skeleton.slots[1].attachment]);
	results.push(["lookup falls back to the default skin", defaultB, skeleton.getAttachment(0, "b")]);
	results.push(["draw order is slot order", skeleton.slots[1], skeleton.drawOrder[1]]);

	skeleton.setSkin(null);
	skeleton.setToSetupPose();
	results.push(["default skin alone", defaultA, skeleton.slots[0].attachment]);

	const failures = [];
	for (const [label, expected, actual] of results) {
		const ok = expected === actual;
		console.log(`${ok ? "ok  " : "FAIL"} setup pose: ${label}`);
		if (!ok) {
			failures.push(`setup pose: ${label} expected ${expected?.name ?? expected?.data?.name ?? expected}, got ${actual?.name ?? actual?.data?.name ?? actual}`);
		}
	}
	return failures;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Main

const server = await startVite();
let failures = [];
try {
	const skeletonModule = await server.ssrLoadModule("/src/spine/skeleton.ts");
	failures = [...checkBones(skeletonModule), ...checkReset(skeletonModule), ...checkAttachments(skeletonModule)];
} catch (error) {
	failures = [`could not run: ${error.message}`];
} finally {
	await server.close();
}

if (failures.length > 0) {
	console.error(`\n${failures.length} failure(s):`);
	for (const failure of failures) {
		console.error(`  ${failure}`);
	}
	process.exit(1);
}
console.log("\nAll maths cases pass.");
