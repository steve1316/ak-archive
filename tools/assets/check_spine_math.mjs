#!/usr/bin/env node
/**
 * The maths gate for the Spine runtime: builds tiny synthetic skeletons, poses them with `src/spine/skeleton.ts`, and checks the bone world
 * transforms, setup-pose attachments, live slot state, `src/spine/geometry.ts` triangles, `src/spine/animation.ts` curves, key search,
 * bone, slot and draw order timelines, IK constraints and IK timelines, transform constraints and their timelines, deform timelines,
 * `src/spine/clipping.ts` polygon clipping, and the `src/spine/renderer.ts` two-color tint and blend factors against hand-worked values.
 * `MATH.md` explains each formula the cases pin down.
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

/** The skeleton scales the round trip cases cycle through: plain, flipped, and two where `1 / s` differs from `s`. */
const SKELETON_SCALES = [
	[1, 1],
	[2, 0.5],
	[-1, 1],
	[-1.5, 0.7]
];

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
	// A skeleton flip mirrors every bone, whatever it inherits. The child's axes at rotation 30 come out mirrored across the Y axis.
	{
		name: "Q1 skeleton flip, onlyTranslation child",
		skeleton: { scaleX: -1 },
		bones: [{}, { x: 10, rotation: 30, transformMode: "onlyTranslation" }],
		origin: [-10, 0],
		unitX: [-10.86603, 0.5],
		unitY: [-9.5, 0.86603]
	},
	{
		name: "Q2 skeleton flip, noScaleOrReflection child",
		skeleton: { scaleX: -1 },
		bones: [{}, { x: 10, rotation: 30, transformMode: "noScaleOrReflection" }],
		origin: [-10, 0],
		unitX: [-10.86603, 0.5],
		unitY: [-9.5, 0.86603]
	},
	// The mode reads the parent without the skeleton's scale, so the skeleton's size counts once, not twice.
	{
		name: "Q3 skeleton scale -2, noRotationOrReflection child",
		skeleton: { scaleX: -2 },
		bones: [{}, { x: 10, transformMode: "noRotationOrReflection" }],
		origin: [-20, 0],
		unitX: [-22, 0],
		unitY: [-20, 1]
	},
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

/** The page every geometry case draws from, in pixels. */
const GEOMETRY_PAGE = { width: 256, height: 128 };

/** The unstripped atlas region the geometry cases draw from: a 20 x 10 image packed at (100, 50). */
const REGION_I = { name: "I", x: 100, y: 50, width: 20, height: 10, offsetX: 0, offsetY: 0, originalWidth: 20, originalHeight: 10, rotate: 0, index: -1 };

/** The same 20 x 10 image with its left 10 columns stripped as whitespace, leaving a 10 x 10 packed box at (100, 50). */
const REGION_J = { ...REGION_I, name: "J", width: 10, height: 10, offsetX: 10 };

/**
 * Region I packed turned 90 degrees counterclockwise, so its box on the page is 10 x 20 at (100, 50). The image's bottom-left corner lands on
 * the box's bottom-right, its bottom-right on the top-right, and so on round.
 */
const REGION_R = { ...REGION_I, name: "R", rotate: 90 };

/**
 * A 20 x 10 image stripped to a 12 x 6 packed box at (100, 50) and stored upside down. It has 3 columns stripped on the left, 5 on the right,
 * 1 row at the bottom and 3 at the top.
 */
const REGION_X = { ...REGION_I, name: "X", width: 12, height: 6, offsetX: 3, offsetY: 1, rotate: 180 };

/** Region X's image stored at 270 instead, so its box on the page is 6 x 12. */
const REGION_X270 = { ...REGION_X, name: "X270", rotate: 270 };

/** The region attachment cases I and J share: a 20 x 10 image centred 5 units right of the bone. */
const REGION_ATTACHMENT = { type: "region", path: null, rotation: 0, x: 5, y: 0, scaleX: 1, scaleY: 1, width: 20, height: 10, color: { r: 1, g: 1, b: 1, a: 1 } };

/** The one-page atlas every geometry case draws from, holding regions I, J, R, X and X270. */
const GEOMETRY_ATLAS = {
	pages: [{ name: "page.png", width: 0, height: 0, format: "RGBA8888", filter: ["Linear", "Linear"], repeat: "none", pma: false, regions: [REGION_I, REGION_J, REGION_R, REGION_X, REGION_X270] }]
};

/** Case L's mesh: three bone-local vertices on region I. */
const MESH_L = {
	type: "mesh",
	name: "I",
	path: null,
	color: { r: 1, g: 1, b: 1, a: 1 },
	uvs: new Float32Array([0, 1, 1, 1, 0, 0]),
	triangles: new Uint16Array([0, 1, 2]),
	vertices: { weighted: false, values: new Float32Array([0, 0, 10, 0, 0, 10]) },
	hullCount: 3,
	edges: null,
	width: null,
	height: null
};

/** Case L's expected world positions and page UVs. */
const MESH_L_EXPECTED = {
	positions: [0, 0, 10, 0, 0, 10],
	uvs: [0.390625, 0.46875, 0.46875, 0.46875, 0.390625, 0.390625]
};

/** The curve cases: a curve, the time fraction between two keys, and the eased value fraction expected there. */
const CURVE_CASES = [
	{ curve: { bezier: [0, 0, 1, 1] }, t: 0.3, expected: 0.3 },
	{ curve: { bezier: [0.25, 0.1, 0.25, 1] }, t: 0.5, expected: 0.8024 },
	{ curve: { bezier: [0.42, 0, 1, 1] }, t: 0.5, expected: 0.31536 },
	{ curve: { bezier: [0.42, 0, 0.58, 1] }, t: 0.25, expected: 0.12916 },
	{ curve: "stepped", t: 0.99, expected: 0 },
	{ curve: "linear", t: 0.25, expected: 0.25 },
	// Control x outside [0, 1] makes x turn back, so the search can land on a far crossing. The ends must still be exact.
	{ curve: { bezier: [-0.2, 0, 1.2, 1] }, t: 0, expected: 0 },
	{ curve: { bezier: [-0.2, 0, 1.2, 1] }, t: 1, expected: 1 },
	{ curve: { bezier: [-0.2, 0, 1.2, 1] }, t: 0.5, expected: 0.5 },
	{ curve: { bezier: [0, 0.68, -0.286, 0.92] }, t: 0, expected: 0 }
];

/** The key search cases: key times, a time, and the key index expected there, or -1 when no run of keys has started. */
const KEY_CASES = [
	{ times: [0, 1, 2], time: 1.5, expected: 1 },
	{ times: [0, 1, 2], time: -0.1, expected: -1 },
	{ times: [0.567, 0.733, 0, 0.567, 0.733], time: 0.6, expected: 3 },
	{ times: [0.567, 0.733, 0, 0.567, 0.733], time: 0.1, expected: 2 },
	{ times: [0.5, 1], time: 0.2, expected: -1 },
	{ times: [0, 1, 1, 2], time: 1, expected: 2 },
	{ times: [0, 1, 2], time: 5, expected: 2 },
	{ times: [], time: 0.5, expected: -1 }
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

/**
 * Checks `setSkin` swaps attachments the way the runtime skins page describes, without touching bone locals. From no skin, the new skin's
 * setup-pose attachments go on. From another skin, only a slot showing the old skin's attachment changes, to what the lookup gives for the
 * same name.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @returns {string[]} One failure message per mismatch.
 */
function checkSkinChange(skeletonModule) {
	const [defaultA, defaultB, altA, otherA, otherB] = ["defaultA", "defaultB", "altA", "otherA", "otherB"].map(point);
	const skinOf = (name, front, back) => ({ name, attachments: new Map([[0, new Map(front)], ...(back ? [[1, new Map(back)]] : [])]) });
	const skins = [skinOf("default", [["a", defaultA]], [["b", defaultB]]), skinOf("alt", [["a", altA]]), skinOf("other", [["a", otherA]], [["b", otherB]])];
	const skeleton = new skeletonModule.Skeleton(skeletonData([{ x: 3 }], [slotData("front", "a"), slotData("back", "b")], skins));
	const bone = skeleton.bones[0];
	const results = [];

	bone.x = 7;
	skeleton.setSkin("alt");
	results.push(["first skin puts on its setup attachment", altA, skeleton.slots[0].attachment]);
	results.push(["first skin leaves a slot it lacks", defaultB, skeleton.slots[1].attachment]);
	results.push(["bone locals untouched", 7, bone.x]);

	skeleton.setSkin("other");
	results.push(["switch swaps the old skin's attachment", otherA, skeleton.slots[0].attachment]);
	results.push(["switch leaves a default skin attachment", defaultB, skeleton.slots[1].attachment]);

	skeleton.setToSetupPose();
	skeleton.setSkin("alt");
	results.push(["switch to a skin without the name falls back to default", defaultB, skeleton.slots[1].attachment]);

	const failures = [];
	for (const [label, expected, actual] of results) {
		const ok = expected === actual;
		console.log(`${ok ? "ok  " : "FAIL"} skin change: ${label}`);
		if (!ok) {
			failures.push(`skin change: ${label} expected ${expected?.name ?? expected}, got ${actual?.name ?? actual}`);
		}
	}
	return failures;
}

/**
 * Builds a one-slot skeleton on a root bone at the origin, with the given attachments in the default skin and the first one shown.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object[]} bones Per-bone overrides, in parent-first order. The slot sits on the first bone.
 * @param {[string, object][]} attachments The slot's attachments as `[placeholder, attachment]` pairs.
 * @returns {object} The skeleton, posed and with world transforms computed.
 */
function geometrySkeleton(skeletonModule, bones, attachments) {
	const skins = [{ name: "default", attachments: new Map([[0, new Map(attachments)]]) }];
	const skeleton = new skeletonModule.Skeleton(skeletonData(bones, [slotData("slot", attachments[0][0])], skins));
	skeleton.updateWorldTransform();
	return skeleton;
}

/**
 * Runs every geometry case: plain, stripped, rotated and scaled regions, weighted vertices, a plain mesh and a linked mesh.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} geometryModule The loaded `geometry.ts` module.
 * @returns {string[]} One failure message per mismatch.
 */
function checkGeometry(skeletonModule, geometryModule) {
	const { slotTriangles } = geometryModule;
	const atlas = GEOMETRY_ATLAS;
	const pages = [GEOMETRY_PAGE];
	const linked = { type: "linkedmesh", name: "M", path: "I", color: { r: 1, g: 1, b: 1, a: 1 }, parentSkin: null, parentName: "L", deform: true, width: null, height: null };
	const weighted = {
		...MESH_L,
		uvs: new Float32Array([0, 0]),
		triangles: new Uint16Array([]),
		vertices: { weighted: true, bones: new Int32Array([2, 0, 1]), values: new Float32Array([1, 0, 0.5, 1, 0, 0.5]) },
		hullCount: 1
	};
	const centreMesh = (name) => ({
		...MESH_L,
		name,
		uvs: new Float32Array([0.5, 0.5]),
		triangles: new Uint16Array([]),
		vertices: { weighted: false, values: new Float32Array([1, 2]) },
		hullCount: 1
	});
	// Bone 0 carries the slot at x 100 but has no influence. Bones 1-3 are its chain: (100, 10), then (105, 10) turned 90, then scale X 2.
	const threeInfluences = {
		...weighted,
		vertices: { weighted: true, bones: new Int32Array([3, 1, 2, 3]), values: new Float32Array([1, 2, 0.2, 1, 0, 0.3, 1, 1, 0.5]) }
	};
	const cases = [
		{
			name: "I region",
			skeleton: geometrySkeleton(skeletonModule, [{}], [["I", { ...REGION_ATTACHMENT, name: "I" }]]),
			positions: [-5, -5, 15, -5, 15, 5, -5, 5],
			uvs: [0.390625, 0.46875, 0.46875, 0.46875, 0.46875, 0.390625, 0.390625, 0.390625]
		},
		{
			name: "J stripped region",
			skeleton: geometrySkeleton(skeletonModule, [{}], [["J", { ...REGION_ATTACHMENT, name: "J" }]]),
			positions: [5, -5, 15, -5, 15, 5, 5, 5],
			uvs: [0.390625, 0.46875, 0.4296875, 0.46875, 0.4296875, 0.390625, 0.390625, 0.390625]
		},
		{
			name: "R region packed at 90",
			skeleton: geometrySkeleton(skeletonModule, [{}], [["R", { ...REGION_ATTACHMENT, name: "R" }]]),
			positions: [-5, -5, 15, -5, 15, 5, -5, 5],
			uvs: [0.4296875, 0.546875, 0.4296875, 0.390625, 0.390625, 0.390625, 0.390625, 0.546875]
		},
		{
			name: "X stripped region packed at 180",
			skeleton: geometrySkeleton(skeletonModule, [{}], [["X", { ...REGION_ATTACHMENT, name: "X", x: 0 }]]),
			positions: [-7, -4, 5, -4, 5, 2, -7, 2],
			uvs: [0.4375, 0.390625, 0.390625, 0.390625, 0.390625, 0.4375, 0.4375, 0.4375]
		},
		{ name: "X mesh centre at 180", skeleton: geometrySkeleton(skeletonModule, [{}], [["X", centreMesh("X")]]), positions: [1, 2], uvs: [0.41015625, 0.421875] },
		{
			name: "X mesh centre at 270",
			skeleton: geometrySkeleton(skeletonModule, [{}], [["X270", centreMesh("X270")]]),
			positions: [1, 2],
			uvs: [0.40625, 0.4453125]
		},
		{
			name: "S scaled and rotated region",
			skeleton: geometrySkeleton(skeletonModule, [{}], [["I", { ...REGION_ATTACHMENT, name: "I", scaleX: 2, scaleY: 0.5, rotation: 90, x: 5, y: 3 }]]),
			positions: [7.5, -17, 7.5, 23, 2.5, 23, 2.5, -17]
		},
		{
			name: "W three influences, slot bone left out",
			skeleton: geometrySkeleton(skeletonModule, [{ x: 100 }, { y: 10 }, { x: 5, rotation: 90 }, { scaleX: 2 }], [["W", threeInfluences]]),
			positions: [103.7, 11.7]
		},
		{
			name: "K weighted vertex",
			skeleton: geometrySkeleton(skeletonModule, [{}, { x: 10, rotation: 90 }], [["K", weighted]]),
			positions: [5.5, 0.5]
		},
		{ name: "L plain mesh", skeleton: geometrySkeleton(skeletonModule, [{}], [["L", MESH_L]]), ...MESH_L_EXPECTED },
		{
			name: "M linked mesh",
			skeleton: geometrySkeleton(
				skeletonModule,
				[{}],
				[
					["M", linked],
					["L", MESH_L]
				]
			),
			...MESH_L_EXPECTED
		}
	];

	const failures = [];
	for (const testCase of cases) {
		const list = slotTriangles(testCase.skeleton, testCase.skeleton.slots[0], atlas, pages);
		const caseFailures = [];
		if (!list) {
			caseFailures.push(`${testCase.name}: no triangle list`);
		} else {
			for (const field of ["positions", "uvs"]) {
				const expected = testCase[field];
				if (expected && (list[field].length !== expected.length || !close(expected, [...list[field]]))) {
					caseFailures.push(`${testCase.name}: ${field} expected ${shown(expected)}, got ${shown([...list[field]])}`);
				}
			}
		}
		failures.push(...caseFailures);
		console.log(`${caseFailures.length === 0 ? "ok  " : "FAIL"} geometry: ${testCase.name}`);
	}
	return failures;
}

/**
 * Formats a slot state value for printing: a color as its channels, an attachment by name, anything else as it is.
 *
 * @param {unknown} value The value.
 * @returns {string} The printed value.
 */
function shownValue(value) {
	if (Array.isArray(value)) {
		return shown(value);
	}
	return String(value?.name ?? value);
}

/**
 * Reads a color as `[r, g, b, a]`, so it compares within `TOLERANCE`.
 *
 * @param {{ r: number, g: number, b: number, a: number } | null | undefined} color The color.
 * @returns {number[] | null | undefined} The channels, or the value itself when there is no color.
 */
function rgba(color) {
	return color ? [color.r, color.g, color.b, color.a] : color;
}

/**
 * Runs labelled cases and prints one line each. A case returns `[expected, actual]`. Arrays compare within `TOLERANCE` item by item, numbers
 * within `TOLERANCE`, and anything else by identity.
 *
 * @param {string} section The name printed before each label.
 * @param {[string, () => [unknown, unknown]][]} cases The cases, each a label and a function giving the expected and actual values.
 * @returns {string[]} One failure message per mismatch or throw.
 */
function runCases(section, cases) {
	const failures = [];
	for (const [label, run] of cases) {
		let problem = null;
		try {
			const [expected, actual] = run();
			let ok;
			if (Array.isArray(expected)) {
				ok = Array.isArray(actual) && actual.length === expected.length && close(expected, actual);
			} else if (typeof expected === "number") {
				ok = typeof actual === "number" && Math.abs(expected - actual) <= TOLERANCE;
			} else {
				ok = expected === actual;
			}
			if (!ok) {
				problem = `expected ${shownValue(expected)}, got ${shownValue(actual)}`;
			}
		} catch (error) {
			problem = `threw ${error.message}`;
		}
		console.log(`${problem === null ? "ok  " : "FAIL"} ${section}: ${label}`);
		if (problem !== null) {
			failures.push(`${section}: ${label} ${problem}`);
		}
	}
	return failures;
}

/**
 * Checks a slot's live state: its color and dark color reset from the data, `setAttachment` looks names up, and the triangle lists follow
 * the live colors rather than the setup ones.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} geometryModule The loaded `geometry.ts` module.
 * @returns {string[]} One failure message per mismatch.
 */
function checkSlotState(skeletonModule, geometryModule) {
	const [first, second] = ["first", "second"].map(point);
	const tinted = { ...slotData("slot", "a"), color: { r: 0.2, g: 0.4, b: 0.6, a: 0.8 }, darkColor: { r: 0.1, g: 0.2, b: 0.3, a: 1 } };
	const build = (slot, attachments) => new skeletonModule.Skeleton(skeletonData([{}], [slot], [{ name: "default", attachments: new Map([[0, new Map(attachments)]]) }]));
	const region = { ...REGION_ATTACHMENT, name: "I", color: { r: 0.5, g: 1, b: 1, a: 0.8 } };
	const trianglesOf = (skeleton) => {
		skeleton.updateWorldTransform();
		return geometryModule.skeletonTriangles(skeleton, GEOMETRY_ATLAS, [GEOMETRY_PAGE])[0];
	};
	const cases = [
		[
			"setToSetupPose resets a changed color",
			() => {
				const skeleton = build(tinted, [["a", first]]);
				Object.assign(skeleton.slots[0].color, { r: 1, g: 0, b: 0, a: 0.5 });
				skeleton.setToSetupPose();
				return [[0.2, 0.4, 0.6, 0.8], rgba(skeleton.slots[0].color)];
			}
		],
		[
			"a changed color leaves the slot data alone",
			() => {
				const skeleton = build(tinted, [["a", first]]);
				Object.assign(skeleton.slots[0].color, { r: 1, g: 0, b: 0, a: 0.5 });
				return [[0.2, 0.4, 0.6, 0.8], rgba(tinted.color)];
			}
		],
		[
			"setToSetupPose resets a changed dark color",
			() => {
				const skeleton = build(tinted, [["a", first]]);
				Object.assign(skeleton.slots[0].darkColor, { r: 0.9, g: 0.9, b: 0.9 });
				skeleton.setToSetupPose();
				return [[0.1, 0.2, 0.3, 1], rgba(skeleton.slots[0].darkColor)];
			}
		],
		[
			"setToSetupPose clears a dark color the data lacks",
			() => {
				const skeleton = build(slotData("slot", "a"), [["a", first]]);
				skeleton.slots[0].darkColor = { r: 0.5, g: 0.5, b: 0.5, a: 1 };
				skeleton.setToSetupPose();
				return [null, skeleton.slots[0].darkColor];
			}
		],
		[
			"setAttachment sets a named attachment",
			() => {
				const skeleton = build(slotData("slot", "a"), [
					["a", first],
					["b", second]
				]);
				skeleton.setAttachment(0, "b");
				return [second, skeleton.slots[0].attachment];
			}
		],
		[
			"setAttachment with null clears the slot",
			() => {
				const skeleton = build(slotData("slot", "a"), [["a", first]]);
				skeleton.setAttachment(0, null);
				return [null, skeleton.slots[0].attachment];
			}
		],
		[
			"setAttachment with an unknown name clears the slot",
			() => {
				const skeleton = build(slotData("slot", "a"), [["a", first]]);
				skeleton.setAttachment(0, "missing");
				return [null, skeleton.slots[0].attachment];
			}
		],
		[
			"triangle color follows the live slot color",
			() => {
				const skeleton = build(slotData("slot", "I"), [["I", region]]);
				Object.assign(skeleton.slots[0].color, { r: 1, g: 0, b: 0, a: 0.5 });
				return [[0.5, 0, 0, 0.4], rgba(trianglesOf(skeleton)?.color)];
			}
		],
		["triangle dark color is null when the slot has none", () => [null, trianglesOf(build(slotData("slot", "I"), [["I", region]]))?.darkColor]],
		[
			"triangle dark color follows the live slot dark color",
			() => {
				const skeleton = build({ ...tinted, attachmentName: "I" }, [["I", region]]);
				Object.assign(skeleton.slots[0].darkColor, { g: 0.7 });
				return [[0.1, 0.7, 0.3, 1], rgba(trianglesOf(skeleton)?.darkColor)];
			}
		]
	];

	return runCases("slot state", cases);
}

/**
 * Builds a bone timeline over two keys at times 0 and 1 with a linear curve, or a later start when `times` is given.
 *
 * @param {string} type The timeline type: `rotate`, `translate`, `scale` or `shear`.
 * @param {number[]} values The two key values. Rotate uses them as angles, the others as both X and Y.
 * @param {number[]} times The two key times.
 * @returns {import("../../src/spine/types.ts").Timeline} The timeline, driving bone 1.
 */
function boneTimeline(type, values, times = [0, 1]) {
	const keys = { boneIndex: 1, times, curves: ["linear"] };
	return type === "rotate" ? { type, ...keys, angles: values } : { type, ...keys, x: values, y: values };
}

/**
 * Poses a 2-bone rig (a root and a child 10 units along it) with one timeline, sampled at a time, and runs `updateWorldTransform`.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} animationModule The loaded `animation.ts` module.
 * @param {object} child Overrides for the child bone's setup data.
 * @param {object} timeline The one timeline, driving the child.
 * @param {number} time The time to sample, in seconds.
 * @returns {import("../../src/spine/skeleton.ts").Bone} The child bone.
 */
function posedChild(skeletonModule, animationModule, child, timeline, time) {
	const skeleton = new skeletonModule.Skeleton(skeletonData([{}, { x: 10, ...child }]));
	const animation = { name: "test", duration: Math.max(...timeline.times), timelines: [timeline] };
	skeleton.setToSetupPose();
	animationModule.applyAnimation(skeleton, animation, time);
	skeleton.updateWorldTransform();
	return skeleton.bones[1];
}

/**
 * Runs every animation case: curves, key search, loop times, and each bone timeline applied to a small rig.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} animationModule The loaded `animation.ts` module.
 * @returns {string[]} One failure message per mismatch.
 */
function checkAnimation(skeletonModule, animationModule) {
	const { curveValue, keyIndex, loopTime } = animationModule;
	const pose = (child, timeline, time) => posedChild(skeletonModule, animationModule, child, timeline, time);
	const worldAngle = (bone) => (Math.atan2(bone.c, bone.a) * 180) / Math.PI;
	const loop = { name: "loop", duration: 1, timelines: [] };
	const cases = [
		...CURVE_CASES.map(({ curve, t, expected }) => [`curve ${JSON.stringify(curve)} at ${t}`, () => [expected, curveValue(curve, t)]]),
		...KEY_CASES.map(({ times, time, expected }) => [`key search [${times}] at ${time}`, () => [expected, keyIndex(times, time)]]),
		["loopTime 2.5 over 1, looping", () => [0.5, loopTime(loop, 2.5, true)]],
		["loopTime 2.5 over 1, not looping", () => [1, loopTime(loop, 2.5, false)]],
		["loopTime over duration 0", () => [0, loopTime({ ...loop, duration: 0 }, 2.5, true)]],
		["loopTime clamps a negative time when not looping", () => [0, loopTime(loop, -0.5, false)]],
		["loopTime gives 0 for a NaN time when looping", () => [0, loopTime(loop, NaN, true)]],
		["loopTime gives 0 for an infinite time when looping", () => [0, loopTime(loop, Infinity, true)]],
		["rotate takes the short way round", () => [18.5, pose({ rotation: 10 }, boneTimeline("rotate", [0, -343]), 0.5).rotation]],
		["rotate adds to the setup rotation", () => [25, pose({ rotation: 10 }, boneTimeline("rotate", [10, 30]), 0.25).rotation]],
		["rotate turns the world x axis", () => [45, worldAngle(pose({}, boneTimeline("rotate", [0, 90]), 0.5))]],
		["translate adds to the setup x", () => [8, pose({ x: 5 }, boneTimeline("translate", [3, 3]), 0.5).x]],
		["shear adds to the setup shear", () => [8, pose({ shearX: 5 }, boneTimeline("shear", [3, 3]), 0.5).shearX]],
		["scale multiplies the setup scale", () => [1, pose({ scaleX: 0.5 }, boneTimeline("scale", [2, 2]), 0.5).scaleX]],
		["before the first key the setup value stays", () => [5, pose({ x: 5 }, boneTimeline("translate", [3, 7], [0.5, 1]), 0.2).x]],
		["after the last key its value holds", () => [12, pose({ x: 5 }, boneTimeline("translate", [3, 7]), 4).x]]
	];

	return runCases("animation", cases);
}

/**
 * Samples one animation on a 4-slot rig on a single bone. Every slot shows `a` in its setup pose and can also show `b`. Slot 0 has a setup
 * color of (0.2, 0.4, 0.6, 0.8) and slot 1 a setup dark color of (0.1, 0.2, 0.3, 0.5).
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} animationModule The loaded `animation.ts` module.
 * @param {object[]} timelines The animation's timelines.
 * @param {number[]} times The times to sample in turn. Only the first one starts from the setup pose.
 * @returns {import("../../src/spine/skeleton.ts").Skeleton} The skeleton after the last sample.
 */
function posedSlots(skeletonModule, animationModule, timelines, times) {
	const slots = [0, 1, 2, 3].map((index) => slotData(`slot${index}`, "a"));
	slots[0] = { ...slots[0], color: { r: 0.2, g: 0.4, b: 0.6, a: 0.8 } };
	slots[1] = { ...slots[1], darkColor: { r: 0.1, g: 0.2, b: 0.3, a: 0.5 } };
	const attachments = new Map(
		slots.map((slot, index) => [
			index,
			new Map([
				["a", point("a")],
				["b", point("b")]
			])
		])
	);
	const skeleton = new skeletonModule.Skeleton(skeletonData([{}], slots, [{ name: "default", attachments }]));
	const animation = { name: "test", duration: Math.max(...timelines.flatMap((timeline) => timeline.times)), timelines };
	skeleton.setToSetupPose();
	for (const time of times) {
		animationModule.applyAnimation(skeleton, animation, time);
	}
	return skeleton;
}

/**
 * Runs the slot and draw order timeline cases: attachment, color, two-color and draw order keys applied to a small rig.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} animationModule The loaded `animation.ts` module.
 * @returns {string[]} One failure message per mismatch.
 */
function checkSlotTimelines(skeletonModule, animationModule) {
	const pose = (timelines, ...times) => posedSlots(skeletonModule, animationModule, timelines, times);
	const order = (skeleton) => skeleton.drawOrder.map((slot) => slot.index);
	const shownName = (skeleton, index) => skeleton.slots[index].attachment?.name ?? null;
	const drawOrder = (changes, times = changes.map((_, index) => index)) => ({ type: "drawOrder", times, changes });
	const attachment = (times, names) => ({ type: "attachment", slotIndex: 0, times, names });
	const white = { r: 1, g: 1, b: 1, a: 1 };
	const black = { r: 0, g: 0, b: 0, a: 1 };
	const color = (colors, curve = "linear") => ({ type: "color", slotIndex: 0, times: [0, 1], colors, curves: [curve] });
	const twoColor = (slotIndex) => ({
		type: "twoColor",
		slotIndex,
		times: [0, 1],
		lights: [
			{ r: 1, g: 0.5, b: 0.5, a: 1 },
			{ r: 0.2, g: 0.5, b: 0.5, a: 0.6 }
		],
		darks: [
			{ r: 0, g: 0, b: 0, a: 0 },
			{ r: 0.4, g: 0.2, b: 0, a: 0.9 }
		],
		curves: ["linear"]
	});
	const cases = [
		["draw order moves slot 3 back 2", () => [[0, 3, 1, 2], order(pose([drawOrder([[{ slotIndex: 3, offset: -2 }]])], 0))]],
		["draw order moves slot 0 on 2", () => [[1, 2, 0, 3], order(pose([drawOrder([[{ slotIndex: 0, offset: 2 }]])], 0))]],
		["draw order with no changes is the setup order", () => [[0, 1, 2, 3], order(pose([drawOrder([[{ slotIndex: 3, offset: -2 }], []])], 1))]],
		["draw order with no changes restores a changed order", () => [[0, 1, 2, 3], order(pose([drawOrder([[{ slotIndex: 3, offset: -2 }], []])], 0, 1))]],
		["draw order keeps the setup order before the first key", () => [[0, 1, 2, 3], order(pose([drawOrder([[{ slotIndex: 0, offset: 2 }]], [0.5])], 0.2))]],
		["draw order holds its key until the next", () => [[1, 2, 0, 3], order(pose([drawOrder([[{ slotIndex: 0, offset: 2 }], []])], 0.99))]],
		[
			"draw order writes into the skeleton's own array",
			() => {
				const skeleton = pose([]);
				const own = skeleton.drawOrder;
				animationModule.applyAnimation(skeleton, { name: "test", duration: 0, timelines: [drawOrder([[{ slotIndex: 3, offset: -2 }]])] }, 0);
				return [[0, 3, 1, 2], skeleton.drawOrder === own ? order(skeleton) : "a new array"];
			}
		],
		["draw order puts back the same slot objects", () => [true, pose([drawOrder([[{ slotIndex: 3, offset: -2 }]])], 0).drawOrder.every((slot, index, all) => all.indexOf(slot) === index)]],
		["attachment sets its key's name at 0.25", () => ["b", shownName(pose([attachment([0, 0.5], ["b", null])], 0.25), 0)]],
		["attachment with a null name clears the slot", () => [null, shownName(pose([attachment([0, 0.5], ["b", null])], 0.75), 0)]],
		["attachment keeps the setup attachment before the first key", () => ["a", shownName(pose([attachment([0.5], ["b"])], 0.25), 0)]],
		["attachment is stepped", () => ["b", shownName(pose([attachment([0, 1], ["b", null])], 0.99), 0)]],
		["color replaces the setup color", () => [[0.75, 0.75, 0.75, 1], rgba(pose([color([white, black])], 0.25).slots[0].color)]],
		["color holds the last key", () => [[0, 0, 0, 1], rgba(pose([color([white, black])], 3).slots[0].color)]],
		// This bezier's value reaches 1.25 halfway, which would push the channels past 1.
		["color clamps a bezier overshoot to [0, 1]", () => [[1, 1, 1, 1], rgba(pose([color([{ r: 0, g: 0, b: 0, a: 0 }, white], { bezier: [0.25, 1.5, 0.75, 1.5] })], 0.5).slots[0].color)]],
		["color stepped holds the key", () => [[1, 1, 1, 1], rgba(pose([color([white, black], "stepped")], 0.9).slots[0].color)]],
		["color keeps the setup color before the first key", () => [[0.2, 0.4, 0.6, 0.8], rgba(pose([{ ...color([white, black]), times: [0.5, 1] }], 0.25).slots[0].color)]],
		// A quarter of the way along, so a blend run backwards (0.75 of the way) gives other numbers.
		["two-color blends the light color", () => [[0.8, 0.5, 0.5, 0.9], rgba(pose([twoColor(1)], 0.25).slots[1].color)]],
		["two-color blends the dark color and keeps its alpha", () => [[0.1, 0.05, 0, 0.5], rgba(pose([twoColor(1)], 0.25).slots[1].darkColor)]],
		["two-color on a slot without a dark color sets the light color", () => [[0.8, 0.5, 0.5, 0.9], rgba(pose([twoColor(2)], 0.25).slots[2].color)]],
		["two-color on a slot without a dark color leaves it null", () => [null, pose([twoColor(2)], 0.25).slots[2].darkColor]],
		["timelines apply in file order", () => [[0, 0, 0, 1], rgba(pose([color([white, white]), color([black, black])], 0.5).slots[0].color)]]
	];
	return runCases("slot timelines", cases);
}

/**
 * Builds a rig for the IK cases and poses it. Bone 0 is the root, the chain bones follow it (each a child of the one before), and the
 * target is a second root bone placed at a world point. The one IK constraint drives the chain toward the target.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object[]} chain Overrides for the one or two chain bones.
 * @param {number[]} target The target's world point.
 * @param {object} constraint Overrides for the IK constraint data.
 * @param {object} root Overrides for the root bone.
 * @returns {import("../../src/spine/skeleton.ts").Skeleton} The skeleton, with `updateWorldTransform` run.
 */
function ikRig(skeletonModule, chain, target, constraint = {}, root = {}) {
	const data = skeletonData([root, ...chain, { parentIndex: null, x: target[0], y: target[1] }]);
	const bones = chain.map((_, index) => index + 1);
	const ik = { name: "ik", order: 0, skinRequired: false, bones, target: chain.length + 1, mix: 1, softness: 0, bendDirection: 1, compress: false, stretch: false, uniform: false };
	data.ik = [{ ...ik, ...constraint }];
	const skeleton = new skeletonModule.Skeleton(data);
	skeleton.setToSetupPose();
	skeleton.updateWorldTransform();
	return skeleton;
}

/**
 * Runs the IK cases: one-bone aim, mix, compress, stretch and uniform, two-bone bend, reach, stretch and softness, the page's child Y
 * rule, an IK timeline on mix, and a second `updateWorldTransform` on the same pose.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} animationModule The loaded `animation.ts` module.
 * @returns {string[]} One failure message per mismatch.
 */
function checkIk(skeletonModule, animationModule) {
	const rig = (chain, target, constraint, root) => ikRig(skeletonModule, chain, target, constraint, root);
	const one = (target, constraint, root) => rig([{ length: 10 }], target, constraint, root).bones[1];
	const two = (target, constraint, parent = {}, child = {}) =>
		rig(
			[
				{ length: 10, ...parent },
				{ x: 10, length: 10, ...child }
			],
			target,
			constraint
		);
	const rotations = (skeleton) => [skeleton.bones[1].appliedRotation, skeleton.bones[2].appliedRotation];
	const axisLength = (bone) => Math.hypot(bone.a, bone.c);
	const tip = (skeleton) => localToWorldOf(skeleton.bones[2], 10, 0);
	const localToWorldOf = (bone, x, y) => skeletonModule.localToWorld(bone, x, y);
	const world = (skeleton) => skeleton.bones.flatMap((bone) => [bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY]);
	const mixTimeline = {
		type: "ik",
		constraintIndex: 0,
		times: [0, 1],
		mixes: [1, 0],
		softness: [0, 0],
		bendDirections: [1, 1],
		compress: [false, false],
		stretch: [false, false],
		curves: ["linear"]
	};
	const cases = [
		["one bone aims at the target", () => [90, one([0, 5]).appliedRotation]],
		["one bone at mix 0.5 turns half way", () => [45, one([0, 5], { mix: 0.5 }).appliedRotation]],
		["one bone under a parent turned 90 solves in the parent's space", () => [90, one([-5, 0], {}, { rotation: 90 }).appliedRotation]],
		["one bone keeps its local rotation", () => [0, one([0, 5]).rotation]],
		["compress scales a bone down to reach a near target", () => [0.4, one([4, 0], { compress: true }).appliedScaleX]],
		["without compress the scale stays", () => [1, one([4, 0]).appliedScaleX]],
		[
			"stretch scales a bone up to reach a far target",
			() => [
				[2, 1],
				[one([20, 0], { stretch: true }).appliedScaleX, one([20, 0], { stretch: true }).appliedScaleY]
			]
		],
		["uniform stretch scales both axes", () => [2, one([20, 0], { stretch: true, uniform: true }).appliedScaleY]],
		["two bones, positive bend turns the child counterclockwise", () => [[0, 90], rotations(two([10, 10]))]],
		["two bones, negative bend is the mirror solution", () => [[90, -90], rotations(two([10, 10], { bendDirection: -1 }))]],
		["two bones, positive bend puts the tip on the target", () => [[10, 10], tip(two([10, 10]))]],
		["two bones out of reach lie straight toward the target", () => [[0, 0], rotations(two([30, 0]))]],
		["two bones out of reach keep their scales", () => [[1, 1, 1, 1], [1, 2].flatMap((index) => [two([30, 0]).bones[index].appliedScaleX, two([30, 0]).bones[index].appliedScaleY])]],
		["two bones out of reach stop at full length", () => [[20, 0], tip(two([30, 0]))]],
		["two bone stretch makes both bones 1.5 long in the world", () => [[1.5, 1.5], [1, 2].map((index) => axisLength(two([30, 0], { stretch: true }).bones[index]))]],
		["two bone stretch puts the tip on the target", () => [[30, 0], tip(two([30, 0], { stretch: true }))]],
		[
			"two bone stretch scales only the parent's local X",
			() => [
				[1.5, 1],
				[two([30, 0], { stretch: true }).bones[1].appliedScaleX, two([30, 0], { stretch: true }).bones[2].appliedScaleX]
			]
		],
		["softness eases the reach near full length", () => [[18.875, 0], tip(two([19, 0], { softness: 2 }))]],
		["softness is fully straight a softness past full length", () => [[20, 0], tip(two([23, 0], { softness: 2 }))]],
		["mix 0 changes nothing", () => [[0, 0], rotations(two([10, 10], { mix: 0 }))]],
		// The full solves are (90, -90) and (-150, 120), from rotations (0, 0): 30% of each turn.
		["two bones at mix 0.3, negative bend, blend both rotations", () => [[27, -27], rotations(two([10, 10], { bendDirection: -1, mix: 0.3 }))]],
		["two bones at mix 0.3, target below, blend both rotations", () => [[-45, 36], rotations(two([0, -10], { mix: 0.3 }))]],
		// Reach 20 with softness 30 would ease a target at 0.5 to about -0.42. It stops at 0, so the chain folds back to its origin.
		["softness larger than the reach never folds past the origin", () => [[0, 0], tip(two([0.5, 0], { softness: 30 }))]],
		["the child keeps its Y under a uniform parent", () => [3, two([10, 10], {}, {}, { y: 3 }).bones[2].appliedY]],
		["the child's Y is 0 under a nonuniform parent", () => [0, two([10, 10], {}, { scaleY: 2 }, { y: 3 }).bones[2].appliedY]],
		["the child's Y is 0 with stretch on", () => [0, two([10, 10], { stretch: true }, {}, { y: 3 }).bones[2].appliedY]],
		["the child keeps its local Y", () => [3, two([10, 10], {}, { scaleY: 2 }, { y: 3 }).bones[2].y]],
		[
			"an IK timeline blends the live mix",
			() => {
				const skeleton = two([10, 10]);
				animationModule.applyAnimation(skeleton, { name: "ik", duration: 1, timelines: [mixTimeline] }, 0.5);
				return [0.5, skeleton.ikConstraints[0].mix];
			}
		],
		[
			"setToSetupPose restores the data mix",
			() => {
				const skeleton = two([10, 10]);
				animationModule.applyAnimation(skeleton, { name: "ik", duration: 1, timelines: [mixTimeline] }, 0.5);
				skeleton.setToSetupPose();
				return [1, skeleton.ikConstraints[0].mix];
			}
		],
		[
			"updateWorldTransform twice at mix 0.5 gives the same world values",
			() => {
				const skeleton = two([10, 10], { mix: 0.5 });
				const first = world(skeleton);
				skeleton.updateWorldTransform();
				const second = world(skeleton);
				return [true, first.every((value, index) => value === second[index])];
			}
		]
	];
	return runCases("ik", cases);
}

/**
 * Builds a rig for the transform constraint cases and poses it. Bone 0 is an identity root. Bone 1 is the target and bone 2 the
 * constrained bone, both children of the root unless `parent` is given, which puts a parent bone (index 2) above the constrained bone
 * (index 3). A child of the constrained bone at local `(5, 0)` comes last.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} rig The rig: `target` and `bone` overrides, an optional `parent`, `constraint` overrides, `skeleton` settings and
 *   `ik` constraints to add.
 * @returns {import("../../src/spine/skeleton.ts").Skeleton} The skeleton, with `updateWorldTransform` run.
 */
function transformRig(skeletonModule, rig) {
	const bones = [{}, { parentIndex: 0, ...rig.target }];
	if (rig.parent) {
		bones.push({ parentIndex: 0, ...rig.parent });
	}
	const boneIndex = bones.length;
	bones.push({ parentIndex: rig.parent ? 2 : 0, length: 10, ...rig.bone }, { parentIndex: boneIndex, x: 5 });
	const data = skeletonData(bones);
	const constraint = {
		name: "tc",
		order: 0,
		skinRequired: false,
		bones: [boneIndex],
		target: 1,
		local: false,
		relative: false,
		offsetRotation: 0,
		offsetX: 0,
		offsetY: 0,
		offsetScaleX: 0,
		offsetScaleY: 0,
		offsetShearY: 0,
		rotateMix: 0,
		translateMix: 0,
		scaleMix: 0,
		shearMix: 0
	};
	data.transform = [{ ...constraint, ...rig.constraint }];
	data.ik = rig.ik ?? [];
	const skeleton = new skeletonModule.Skeleton(data);
	Object.assign(skeleton, rig.skeleton ?? {});
	skeleton.setToSetupPose();
	skeleton.updateWorldTransform();
	return skeleton;
}

/**
 * A small seeded random number generator, so the round trip cases are the same on every run.
 *
 * @param {number} seed The starting state.
 * @returns {() => number} A function giving the next number in [0, 1).
 */
function seededRandom(seed) {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

/**
 * Checks `setAppliedFromWorld` inverts `updateBone` for one transform mode: 50 seeded random bones under random parents, and 50 random
 * root bones, each posed, then given applied values from its world transform and recomputed. The skeleton's scale cycles through
 * `SKELETON_SCALES`, so the skeleton frame's inverse is not the frame itself. Every world value must come back within 1e-9, relative to
 * its size.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} constraintsModule The loaded `constraints.ts` module.
 * @param {string} mode The transform mode to test.
 * @returns {number} How many of the 100 bones round trip.
 */
function roundTrips(skeletonModule, constraintsModule, mode) {
	const random = seededRandom(mode.length * 7919 + 17);
	const scale = () => {
		const value = 0.05 + random() * 1.95;
		return random() < 0.5 ? -value : value;
	};
	const pose = () => ({ x: random() * 40 - 20, y: random() * 40 - 20, rotation: random() * 360 - 180, scaleX: scale(), scaleY: scale(), shearX: random() * 80 - 40, shearY: random() * 80 - 40 });
	let passed = 0;
	for (let i = 0; i < 100; i++) {
		// The first 50 are the third bone of a chain, the rest a lone root, whose parent frame is the skeleton's own.
		const bones = i < 50 ? [pose(), pose(), { ...pose(), transformMode: mode }] : [{ ...pose(), transformMode: mode }];
		const skeleton = new skeletonModule.Skeleton(skeletonData(bones));
		[skeleton.scaleX, skeleton.scaleY] = SKELETON_SCALES[i % SKELETON_SCALES.length];
		skeleton.x = random() * 20 - 10;
		skeleton.y = random() * 20 - 10;
		skeleton.setToSetupPose();
		skeleton.updateWorldTransform();
		const bone = skeleton.bones[bones.length - 1];
		const before = [bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY];
		constraintsModule.setAppliedFromWorld(bone, skeleton);
		skeletonModule.updateBone(bone, skeleton);
		const after = [bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY];
		passed += before.every((value, index) => Math.abs(value - after[index]) <= 1e-9 * Math.max(1, Math.abs(value))) ? 1 : 0;
	}
	return passed;
}

/**
 * Runs the transform constraint cases: each channel at mix 1 and 0.5, the offsets, a constrained bone under a turned parent and its child,
 * local mode, the round trip for each transform mode, the order against IK, a skeleton flip and a timeline on the rotate mix.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} animationModule The loaded `animation.ts` module.
 * @param {object} constraintsModule The loaded `constraints.ts` module.
 * @returns {string[]} One failure message per mismatch.
 */
function checkTransform(skeletonModule, animationModule, constraintsModule) {
	const TARGET = { x: 10, y: 5, rotation: 30 };
	const rig = (options) => transformRig(skeletonModule, { target: TARGET, ...options });
	const constrained = (skeleton) => skeleton.bones[skeleton.bones.length - 2];
	const origin = (bone) => [bone.worldX, bone.worldY];
	const angle = (bone) => (Math.atan2(bone.c, bone.a) * 180) / Math.PI;
	const shearAngle = (bone) => (Math.atan2(bone.d, bone.b) * 180) / Math.PI - angle(bone);
	const axisLength = (bone) => Math.hypot(bone.a, bone.c);
	// The IK and the transform constraint both turn the bone: IK toward a target straight above, the transform constraint to 30.
	const ordered = (ikOrder, transformOrder) => {
		const ik = { name: "ik", order: ikOrder, skinRequired: false, bones: [2], target: 4, mix: 1, softness: 0, bendDirection: 1, compress: false, stretch: false, uniform: false };
		const data = skeletonData([{}, { parentIndex: 0, ...TARGET }, { parentIndex: 0, length: 10 }, { parentIndex: 2, x: 5 }, { parentIndex: 0, y: 10 }]);
		data.transform = [{ ...transformRig(skeletonModule, { constraint: {} }).data.transform[0], order: transformOrder, bones: [2], rotateMix: 1 }];
		data.ik = [ik];
		const skeleton = new skeletonModule.Skeleton(data);
		skeleton.setToSetupPose();
		skeleton.updateWorldTransform();
		return angle(skeleton.bones[2]);
	};
	const mixTimeline = { type: "transform", constraintIndex: 0, times: [0, 1], rotateMixes: [1, 0], translateMixes: [0, 0], scaleMixes: [0, 0], shearMixes: [0, 0], curves: ["linear"] };
	const cases = [
		["translate mix 1 moves the origin onto the target", () => [[10, 5], origin(constrained(rig({ constraint: { translateMix: 1 } })))]],
		["translate mix 1 leaves the rotation", () => [0, angle(constrained(rig({ constraint: { translateMix: 1 } })))]],
		["translate mix 0.5 moves half way", () => [[5, 2.5], origin(constrained(rig({ constraint: { translateMix: 0.5 } })))]],
		["rotate mix 1 turns to the target's angle", () => [30, angle(constrained(rig({ constraint: { rotateMix: 1 } })))]],
		["rotate mix 0.5 turns half way", () => [15, angle(constrained(rig({ constraint: { rotateMix: 0.5 } })))]],
		["rotate offset 10 adds to the target's angle", () => [40, angle(constrained(rig({ constraint: { rotateMix: 1, offsetRotation: 10 } })))]],
		["the translate offset is in the target's axes", () => [[10, 7], origin(constrained(rig({ target: { x: 10, y: 5, rotation: 90 }, constraint: { translateMix: 1, offsetX: 2 } })))]],
		["scale mix 1 takes the target's axis length", () => [2, axisLength(constrained(rig({ target: { ...TARGET, scaleX: 2 }, constraint: { scaleMix: 1 } })))]],
		["the scale offset adds to the target's length", () => [2.5, axisLength(constrained(rig({ target: { ...TARGET, scaleX: 2 }, constraint: { scaleMix: 1, offsetScaleX: 0.5 } })))]],
		["shear mix 1 puts the Y axis 110 from the X axis", () => [110, shearAngle(constrained(rig({ target: { ...TARGET, shearY: 20 }, constraint: { shearMix: 1 } })))]],
		[
			"shear mix 1 leaves the X axis",
			() => {
				const bone = constrained(rig({ target: { ...TARGET, shearY: 20 }, constraint: { shearMix: 1 } }));
				return [
					[0, 1],
					[angle(bone), axisLength(bone)]
				];
			}
		],
		["under a parent turned 90 the world angle is the target's", () => [30, angle(constrained(rig({ parent: { rotation: 90 }, constraint: { rotateMix: 1 } })))]],
		["under a parent turned 90 the applied rotation is -60", () => [-60, constrained(rig({ parent: { rotation: 90 }, constraint: { rotateMix: 1 } })).appliedRotation]],
		[
			"a child follows the constrained bone",
			() => {
				const skeleton = rig({ parent: { rotation: 90 }, constraint: { rotateMix: 1 } });
				const bone = constrained(skeleton);
				const child = skeleton.bones[skeleton.bones.length - 1];
				const radians = Math.PI / 6;
				return [
					[bone.worldX + 5 * Math.cos(radians), bone.worldY + 5 * Math.sin(radians)],
					[child.worldX, child.worldY]
				];
			}
		],
		["the constrained bone keeps its local rotation", () => [0, constrained(rig({ parent: { rotation: 90 }, constraint: { rotateMix: 1 } })).rotation]],
		["local mode, rotate mix 1 copies the target's rotation", () => [30, constrained(rig({ target: { x: 4, rotation: 30 }, constraint: { local: true, rotateMix: 1 } })).appliedRotation]],
		["local mode, translate mix 0.5 moves x half way", () => [2, constrained(rig({ target: { x: 4, rotation: 30 }, constraint: { local: true, translateMix: 0.5 } })).appliedX]],
		["a skeleton flip mirrors the offset rotation", () => [140, angle(constrained(rig({ constraint: { rotateMix: 1, offsetRotation: 10 }, skeleton: { scaleX: -1 } })))]],
		...["normal", "onlyTranslation", "noRotationOrReflection", "noScale", "noScaleOrReflection"].map((mode) => [
			`setAppliedFromWorld round trips 50 random ${mode} bones and 50 roots under varied skeleton scales`,
			() => [100, roundTrips(skeletonModule, constraintsModule, mode)]
		]),
		["a transform constraint after IK decides the rotation", () => [30, ordered(0, 1)]],
		["IK after a transform constraint decides the rotation", () => [90, ordered(1, 0)]],
		[
			"a transform timeline blends the live rotate mix",
			() => {
				const skeleton = rig({ constraint: { rotateMix: 1 } });
				animationModule.applyAnimation(skeleton, { name: "tc", duration: 1, timelines: [mixTimeline] }, 0.5);
				return [0.5, skeleton.transformConstraints[0].rotateMix];
			}
		],
		[
			"setToSetupPose restores the data rotate mix",
			() => {
				const skeleton = rig({ constraint: { rotateMix: 1 } });
				animationModule.applyAnimation(skeleton, { name: "tc", duration: 1, timelines: [mixTimeline] }, 0.5);
				skeleton.setToSetupPose();
				return [1, skeleton.transformConstraints[0].rotateMix];
			}
		]
	];
	return runCases("transform", cases);
}

/**
 * Builds a one-slot rig for the deform cases, plays one animation at a time and gives the slot's world vertex positions.
 *
 * @param {object} modules The loaded `skeleton.ts`, `geometry.ts` and `animation.ts` modules, as `skeleton`, `geometry` and `animation`.
 * @param {object} rig The rig: `bones` overrides, `skins` as `[name, [attachmentName, attachment][]][]` for slot 0, the slot's setup
 *   attachment `shown`, and the animation's `timelines`.
 * @param {number} time The time to sample.
 * @returns {{ skeleton: object, positions: number[] | null }} The posed skeleton and the slot's positions, or null when it draws nothing.
 */
function posedDeform(modules, rig, time) {
	const skins = rig.skins.map(([name, attachments]) => ({ name, attachments: new Map([[0, new Map(attachments)]]) }));
	const data = skeletonData(rig.bones ?? [{}], [slotData("slot", rig.shown)], skins);
	const animation = { name: "deform", duration: Math.max(...rig.timelines.flatMap((timeline) => timeline.times)), timelines: rig.timelines };
	data.animations = [animation];
	const skeleton = new modules.skeleton.Skeleton(data);
	skeleton.setToSetupPose();
	modules.animation.applyAnimation(skeleton, animation, time);
	skeleton.updateWorldTransform();
	const list = modules.geometry.slotTriangles(skeleton, skeleton.slots[0], GEOMETRY_ATLAS, [GEOMETRY_PAGE]);
	return { skeleton, positions: list ? [...list.positions] : null };
}

/**
 * Runs the deform cases: offsets on a plain triangle and a weighted vertex, curves and the first key, linked meshes with and without their
 * deform flag, a timeline naming another attachment or another skin's, the resets, and an attachment swap in the same frame.
 *
 * @param {object} modules The loaded `skeleton.ts`, `geometry.ts` and `animation.ts` modules, as `skeleton`, `geometry` and `animation`.
 * @returns {string[]} One failure message per mismatch.
 */
function checkDeform(modules) {
	const mesh = (name) => ({ ...MESH_L, name, path: "I" });
	// Vertex 1 of the triangle moves 5 along X at the first key and back at the second, whose key stores nothing.
	const deform = (attachmentName, times = [0, 1], skinIndex = 0) => ({
		type: "deform",
		skinIndex,
		slotIndex: 0,
		attachmentName,
		times,
		starts: [2, 0],
		values: [[5, 0], []],
		curves: ["linear"]
	});
	const plain = (time, timeline = deform("L")) => posedDeform(modules, { skins: [["default", [["L", mesh("L")]]]], shown: "L", timelines: [timeline] }, time).positions;
	const linked = (flag) => ({ type: "linkedmesh", name: "M", path: "I", color: { r: 1, g: 1, b: 1, a: 1 }, parentSkin: null, parentName: "L", deform: flag, width: null, height: null });
	const linkedRig = (flag) => ({
		skins: [
			[
				"default",
				[
					["M", linked(flag)],
					["L", mesh("L")]
				]
			]
		],
		shown: "M",
		timelines: [deform("L")]
	});
	const twoMeshes = (shown, timelines) => ({
		skins: [
			[
				"default",
				[
					["X", mesh("X")],
					["Y", mesh("Y")]
				]
			]
		],
		shown,
		timelines
	});
	const weighted = {
		...MESH_L,
		uvs: new Float32Array([0, 0]),
		triangles: new Uint16Array([]),
		vertices: { weighted: true, bones: new Int32Array([2, 0, 1]), values: new Float32Array([0, 0, 0.5, 0, 0, 0.5]) },
		hullCount: 1
	};
	const weightedRig = (values) => ({
		bones: [{}, { x: 10 }],
		skins: [["default", [["W", weighted]]]],
		shown: "W",
		timelines: [{ type: "deform", skinIndex: 0, slotIndex: 0, attachmentName: "W", times: [0], starts: [0], values: [values], curves: [] }]
	});
	const deformed = [0, 0, 15, 0, 0, 10];
	const undeformed = [0, 0, 10, 0, 0, 10];
	const cases = [
		["plain triangle at the first key", () => [deformed, plain(0)]],
		["plain triangle halfway", () => [[0, 0, 12.5, 0, 0, 10], plain(0.5)]],
		["plain triangle at the last key, which stores nothing", () => [undeformed, plain(1)]],
		["plain triangle before the first key", () => [undeformed, plain(0.25, deform("L", [0.5, 1]))]],
		["weighted vertex undeformed", () => [[5, 0], posedDeform(modules, weightedRig([0, 0, 0, 0]), 0).positions]],
		["weighted vertex offsets each bind position", () => [[6, 2], posedDeform(modules, weightedRig([2, 0, 0, 4]), 0).positions]],
		["linked mesh with deform set follows its parent's timeline", () => [deformed, posedDeform(modules, linkedRig(true), 0).positions]],
		["linked mesh without deform ignores its parent's timeline", () => [undeformed, posedDeform(modules, linkedRig(false), 0).positions]],
		["a timeline naming another attachment leaves the shown one alone", () => [undeformed, posedDeform(modules, twoMeshes("Y", [deform("X")]), 0).positions]],
		[
			"a timeline naming another skin's attachment of the same name is not applied",
			() => {
				const rig = {
					skins: [
						["default", [["L", mesh("L")]]],
						["other", [["L", mesh("L")]]]
					],
					shown: "L",
					timelines: [deform("L", [0, 1], 1)]
				};
				return [undeformed, posedDeform(modules, rig, 0).positions];
			}
		],
		["deformLength is the target's full length", () => [6, posedDeform(modules, twoMeshes("X", [deform("X")]), 0).skeleton.slots[0].deformLength]],
		[
			"setToSetupPose clears deformLength",
			() => {
				const { skeleton } = posedDeform(modules, twoMeshes("X", [deform("X")]), 0);
				skeleton.setToSetupPose();
				return [0, skeleton.slots[0].deformLength];
			}
		],
		[
			"setAttachment to another attachment clears deformLength",
			() => {
				const { skeleton } = posedDeform(modules, twoMeshes("X", [deform("X")]), 0);
				skeleton.setAttachment(0, "Y");
				return [0, skeleton.slots[0].deformLength];
			}
		],
		[
			"setAttachment to the same attachment keeps deformLength",
			() => {
				const { skeleton } = posedDeform(modules, twoMeshes("X", [deform("X")]), 0);
				skeleton.setAttachment(0, "X");
				return [6, skeleton.slots[0].deformLength];
			}
		],
		["a slot's deform is sized to its largest target", () => [6, posedDeform(modules, twoMeshes("X", [deform("X")]), 0).skeleton.slots[0].deform.length]],
		[
			"an attachment key and a deform key in the same frame both apply",
			() => {
				const swap = { type: "attachment", slotIndex: 0, times: [0], names: ["X"] };
				return [deformed, posedDeform(modules, twoMeshes("Y", [swap, deform("X")]), 0).positions];
			}
		]
	];
	return runCases("deform", cases);
}

/**
 * Sums the absolute areas of a list of triangles.
 *
 * @param {ArrayLike<number>} positions The vertex positions, flattened as x0, y0, x1, y1, ...
 * @param {ArrayLike<number>} indices The triangle indices, 3 per triangle.
 * @returns {number} The total area.
 */
function trianglesArea(positions, indices) {
	let area = 0;
	for (let i = 0; i < indices.length; i += 3) {
		const [a, b, c] = [indices[i] * 2, indices[i + 1] * 2, indices[i + 2] * 2];
		area += Math.abs((positions[b] - positions[a]) * (positions[c + 1] - positions[a + 1]) - (positions[c] - positions[a]) * (positions[b + 1] - positions[a + 1])) / 2;
	}
	return area;
}

/**
 * Checks a point lies inside a polygon or within `TOLERANCE` of its boundary.
 *
 * @param {number[]} polygon The polygon's vertices, flattened as x0, y0, x1, y1, ...
 * @param {number} x The point's X.
 * @param {number} y The point's Y.
 * @returns {boolean} True when the point is inside or on the boundary.
 */
function insidePolygon(polygon, x, y) {
	const count = polygon.length / 2;
	let inside = false;
	for (let i = 0, j = count - 1; i < count; j = i++) {
		const [xi, yi, xj, yj] = [polygon[i * 2], polygon[i * 2 + 1], polygon[j * 2], polygon[j * 2 + 1]];
		const length = Math.hypot(xj - xi, yj - yi);
		const along = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - xi) * (xj - xi) + (y - yi) * (yj - yi)) / (length * length)));
		if (Math.hypot(x - (xi + along * (xj - xi)), y - (yi + along * (yj - yi))) <= TOLERANCE) {
			return true;
		}
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

/**
 * Builds a clipping rig: one slot per entry, each on the root bone at the origin, in draw order by slot index. It then poses the rig and
 * builds its triangles. An entry is `{ clip: vertices, end }` for a clipping attachment, `{ mesh: vertices }` for a one-triangle mesh on
 * region I, or null for an empty slot.
 *
 * @param {object} modules The loaded `skeleton.ts`, `geometry.ts` and `animation.ts` modules, as `skeleton`, `geometry` and `animation`.
 * @param {(object | null)[]} entries The slots, in slot index order.
 * @param {object[]} timelines An animation's timelines to apply at time 0, or none.
 * @returns {Map<number, { positions: number[], indices: number[] }>} Each drawn slot's triangles, copied, keyed by slot index. A slot
 *   missing from it drew nothing.
 */
function clipRig(modules, entries, timelines = []) {
	const attachments = new Map();
	entries.forEach((entry, index) => {
		if (entry?.clip) {
			attachments.set(index, new Map([["C", { type: "clipping", name: "C", endSlotIndex: entry.end, vertices: { weighted: false, values: new Float32Array(entry.clip) }, color: null }]]));
		} else if (entry?.mesh) {
			attachments.set(index, new Map([["M", { ...MESH_L, name: "M", path: "I", vertices: { weighted: false, values: new Float32Array(entry.mesh) } }]]));
		}
	});
	const slots = entries.map((entry, index) => slotData(`slot${index}`, entry?.clip ? "C" : entry?.mesh ? "M" : null));
	const data = skeletonData([{}], slots, [{ name: "default", attachments }]);
	const animation = { name: "clip", duration: 1, timelines };
	data.animations = [animation];
	const skeleton = new modules.skeleton.Skeleton(data);
	skeleton.setToSetupPose();
	modules.animation.applyAnimation(skeleton, animation, 0);
	skeleton.updateWorldTransform();
	const drawn = new Map();
	for (const list of modules.geometry.skeletonTriangles(skeleton, GEOMETRY_ATLAS, [GEOMETRY_PAGE])) {
		drawn.set(list.slotIndex, { positions: [...list.positions], indices: [...list.indices] });
	}
	return drawn;
}

/**
 * Runs the clipping cases: the polygon helpers, one triangle against a square, a clockwise square, triangles inside and outside, a
 * concave clip, where clipping starts and ends in the draw order, and a deformed clip.
 *
 * @param {object} modules The loaded `skeleton.ts`, `geometry.ts`, `animation.ts` and `clipping.ts` modules, as `skeleton`, `geometry`,
 *   `animation` and `clipping`.
 * @returns {string[]} One failure message per mismatch.
 */
function checkClipping(modules) {
	const { signedArea, isConvex, triangulate, clipTriangle, dropRepeats } = modules.clipping;
	const square = [0, 0, 10, 0, 10, 10, 0, 10];
	const clockwise = [0, 0, 0, 10, 10, 10, 10, 0];
	const shape = [0, 0, 20, 0, 20, 10, 10, 10, 10, 20, 0, 20];
	const corner = [5, 5, 15, 5, 5, 15];
	const clip = (tri, polygon) => {
		const out = new Float64Array(4 * (3 + polygon.length / 2));
		const count = clipTriangle(Float64Array.from(tri), Float32Array.from(polygon), polygon.length / 2, out);
		return [...out.subarray(0, count * 4)];
	};
	const uvAt = (vertices, x, y) => {
		for (let i = 0; i < vertices.length; i += 4) {
			if (Math.abs(vertices[i] - x) <= TOLERANCE && Math.abs(vertices[i + 1] - y) <= TOLERANCE) {
				return [vertices[i + 2], vertices[i + 3]];
			}
		}
		return null;
	};
	const fanArea = (vertices) => {
		const positions = vertices.filter((_, index) => index % 4 < 2);
		const indices = [];
		for (let i = 1; i + 1 < positions.length / 2; i++) {
			indices.push(0, i, i + 1);
		}
		return trianglesArea(positions, indices);
	};
	const basic = () => clip([5, 5, 0, 0, 15, 5, 1, 0, 5, 15, 0, 1], square);
	const triangulated = (polygon) => {
		const out = new Uint16Array(3 * (polygon.length / 2 - 2));
		const count = triangulate(Float32Array.from(polygon), polygon.length / 2, out);
		return [count, trianglesArea(polygon, out.subarray(0, count * 3))];
	};
	const areas = (drawn, indices) => indices.map((index) => (drawn.has(index) ? trianglesArea(drawn.get(index).positions, drawn.get(index).indices) : 0));
	const corners = (count) => Array.from({ length: count }, () => ({ mesh: corner }));
	const cut = (polygon) => {
		const list = clipRig(modules, [{ clip: polygon, end: 1 }, { mesh: corner }]).get(1);
		return [trianglesArea(list.positions, list.indices), list.indices.length];
	};
	const concave = () => clipRig(modules, [{ clip: shape, end: 1 }, { mesh: [-100, -100, 100, -100, 0, 100] }]).get(1);
	// The clip's vertices 1 and 2, its right edge, move 5 to the left at time 0.
	const narrowing = { type: "deform", skinIndex: 0, slotIndex: 0, attachmentName: "C", times: [0], starts: [2], values: [[-5, 0, -5, 0]], curves: [] };
	const cases = [
		["signedArea of a counterclockwise square", () => [100, signedArea(Float32Array.from(square), 4)]],
		["signedArea of a clockwise square", () => [-100, signedArea(Float32Array.from(clockwise), 4)]],
		["dropRepeats removes a repeated vertex and a last vertex repeating the first", () => [4, dropRepeats(Float32Array.from([0, 0, 10, 0, 10, 0, 10, 10, 0, 10, 0, 0]), 6)]],
		["isConvex of a square", () => [true, isConvex(Float32Array.from(square), 4)]],
		["isConvex of the L shape", () => [false, isConvex(Float32Array.from(shape), 6)]],
		["triangulate the L shape into 4 triangles covering its area", () => [[4, 300], triangulated(shape)]],
		["a triangle over a square corner keeps 4 vertices", () => [4, basic().length / 4]],
		["a triangle over a square corner keeps area 25", () => [25, fanArea(basic())]],
		["a new vertex at (10, 5) gets UV (0.5, 0)", () => [[0.5, 0], uvAt(basic(), 10, 5)]],
		["a new vertex at (10, 10) gets UV (0.5, 0.5)", () => [[0.5, 0.5], uvAt(basic(), 10, 10)]],
		["a new vertex at (5, 10) gets UV (0, 0.5)", () => [[0, 0.5], uvAt(basic(), 5, 10)]],
		["a triangle inside the square comes back unchanged", () => [[1, 1, 0, 0, 3, 1, 1, 0, 1, 3, 0, 1], clip([1, 1, 0, 0, 3, 1, 1, 0, 1, 3, 0, 1], square)]],
		["a triangle outside the square gives nothing", () => [0, clip([20, 20, 0, 0, 30, 20, 1, 0, 20, 30, 0, 1], square).length]],
		["a counterclockwise clip slot cuts the mesh to area 25 in 2 triangles", () => [[25, 6], cut(square)]],
		["a clockwise clip slot cuts the mesh to area 25 in 2 triangles", () => [[25, 6], cut(clockwise)]],
		["a concave clip keeps area 300 of a covering triangle", () => [300, trianglesArea(concave().positions, concave().indices)]],
		[
			"every vertex a concave clip keeps is inside it",
			() => {
				const { positions } = concave();
				const outside = [];
				for (let i = 0; i < positions.length; i += 2) {
					if (!insidePolygon(shape, positions[i], positions[i + 1])) {
						outside.push(positions[i], positions[i + 1]);
					}
				}
				return [[], outside];
			}
		],
		[
			"a concave clip with its concave corner repeated keeps area 300",
			() => [300, areas(clipRig(modules, [{ clip: [0, 0, 20, 0, 20, 10, 10, 10, 10, 10, 10, 20, 0, 20], end: 1 }, { mesh: [-100, -100, 100, -100, 0, 100] }]), [1])[0]]
		],
		["a mesh wholly outside the clip is left out", () => [false, clipRig(modules, [{ clip: square, end: 1 }, { mesh: [20, 20, 30, 20, 20, 30] }]).has(1)]],
		["clipping runs through the end slot and stops after it", () => [[25, 25, 50], areas(clipRig(modules, [{ clip: square, end: 2 }, ...corners(3)]), [1, 2, 3])]],
		["an end slot equal to the clip slot clips to the end of the draw order", () => [[25, 25, 25], areas(clipRig(modules, [{ clip: square, end: 0 }, ...corners(3)]), [1, 2, 3])]],
		["an end slot earlier in the draw order clips to the end", () => [[50, 25, 25], areas(clipRig(modules, [{ mesh: corner }, { clip: square, end: 0 }, ...corners(2)]), [0, 2, 3])]],
		["an empty clip slot clips nothing", () => [[50, 50], areas(clipRig(modules, [null, ...corners(2)]), [1, 2])]],
		[
			"a clip slot inside an active clip is ignored",
			() => [[25, 25, 50], areas(clipRig(modules, [{ clip: square, end: 3 }, { mesh: corner }, { clip: [0, 0, 1, 0, 1, 1, 0, 1], end: 4 }, { mesh: corner }, { mesh: corner }]), [1, 3, 4])]
		],
		["an undeformed clip keeps area 100 of a larger triangle", () => [100, areas(clipRig(modules, [{ clip: square, end: 1 }, { mesh: [0, 0, 20, 0, 0, 20] }]), [1])[0]]],
		["a deform key narrows the clip to area 50", () => [50, areas(clipRig(modules, [{ clip: square, end: 1 }, { mesh: [0, 0, 20, 0, 0, 20] }], [narrowing]), [1])[0]]]
	];
	return runCases("clipping", cases);
}

/**
 * Runs the drawing cases: the two-color tint of one premultiplied texel, and the blend factors each blend mode draws with.
 *
 * @param {object} rendererModule The loaded `renderer.ts` module.
 * @returns {string[]} One failure message per mismatch.
 */
function checkDrawing(rendererModule) {
	const { tintTexel, BLEND_FACTORS } = rendererModule;
	const white = { r: 1, g: 1, b: 1, a: 1 };
	const darkRed = { r: 0.2, g: 0, b: 0, a: 1 };
	const grey = [0.5, 0.5, 0.5, 1];
	const cases = [
		["two-color maps black to the dark color and white to the light color", () => [[0.6, 0.5, 0.5, 1], tintTexel(white, darkRed, grey)]],
		["no dark color is the plain premultiplied tint", () => [[0.25, 0.125, 0.0625, 0.5], tintTexel({ r: 1, g: 0.5, b: 0.25, a: 0.5 }, null, grey)]],
		[
			"a black dark color matches the plain tint",
			() => [tintTexel({ r: 0.8, g: 0.6, b: 0.4, a: 0.7 }, null, [0.3, 0.3, 0.3, 0.6]), tintTexel({ r: 0.8, g: 0.6, b: 0.4, a: 0.7 }, { r: 0, g: 0, b: 0, a: 1 }, [0.3, 0.3, 0.3, 0.6])]
		],
		["two-color light alpha fades the whole output", () => [[0.3, 0.25, 0.25, 0.5], tintTexel({ ...white, a: 0.5 }, darkRed, grey)]],
		["two-color on a half transparent texel stays premultiplied", () => [[0.3, 0.25, 0.25, 0.5], tintTexel(white, darkRed, [0.25, 0.25, 0.25, 0.5])]],
		["two-color leaves a transparent texel transparent", () => [[0, 0, 0, 0], tintTexel(white, darkRed, [0, 0, 0, 0])]],
		["normal blends ONE, ONE_MINUS_SRC_ALPHA", () => ["ONE,ONE_MINUS_SRC_ALPHA", BLEND_FACTORS.normal.join()]],
		["additive blends ONE, ONE", () => ["ONE,ONE", BLEND_FACTORS.additive.join()]],
		["multiply blends DST_COLOR, ONE_MINUS_SRC_ALPHA", () => ["DST_COLOR,ONE_MINUS_SRC_ALPHA", BLEND_FACTORS.multiply.join()]],
		["screen blends ONE, ONE_MINUS_SRC_COLOR", () => ["ONE,ONE_MINUS_SRC_COLOR", BLEND_FACTORS.screen.join()]]
	];
	return runCases("drawing", cases);
}

/**
 * Builds a path attachment with plain vertices.
 *
 * @param {number[]} points The vertex coordinates, flattened as x0, y0, x1, y1, ... in `[handle in, knot, handle out]` triplets.
 * @param {boolean} closed Whether the last knot joins back to the first.
 * @returns {import("../../src/spine/types.ts").PathAttachment} The attachment.
 */
function pathAttachment(points, closed) {
	return {
		type: "path",
		name: "path",
		closed,
		constantSpeed: true,
		vertices: { weighted: false, values: Float32Array.from(points) },
		lengths: new Float32Array(points.length / 6),
		color: null
	};
}

/**
 * Builds a one-slot skeleton on an identity root showing a path, posed, with a sampler for the path filled in.
 *
 * @param {object} modules The loaded `skeleton` and `paths` modules.
 * @param {number[]} points The path's vertex coordinates, as `pathAttachment` takes them.
 * @param {boolean} closed Whether the path is closed.
 * @returns {object} The sampler after `samplePath`.
 */
function sampledPath(modules, points, closed) {
	const attachment = pathAttachment(points, closed);
	const skins = [{ name: "default", attachments: new Map([[0, new Map([["path", attachment]])]]) }];
	const skeleton = new modules.skeleton.Skeleton(skeletonData([{}], [slotData("path", "path")], skins));
	skeleton.updateWorldTransform();
	const sampler = modules.paths.createPathSampler(attachment);
	modules.paths.samplePath(sampler, skeleton, skeleton.slots[0], attachment);
	return sampler;
}

/**
 * Reads the point and direction at a distance along a sampled path. The angle is returned as its cosine and sine, so a half turn compares
 * equal whether it comes out as PI or -PI.
 *
 * @param {object} pathsModule The loaded `paths.ts` module.
 * @param {object} sampler The sampled path.
 * @param {number} distance The distance along the path.
 * @returns {number[]} `[x, y, cos(angle), sin(angle)]`.
 */
function pathPoint(pathsModule, sampler, distance) {
	const out = new Float64Array(3);
	pathsModule.pointAt(sampler, distance, out, 0);
	return [out[0], out[1], Math.cos(out[2]), Math.sin(out[2])];
}

/**
 * Checks path geometry: total lengths, points and directions along open and closed paths, the straight-line extension past an open path's
 * ends, wrapping on a closed path, a quarter circle's length, and a path with no length.
 *
 * @param {object} modules The loaded `skeleton` and `paths` modules.
 * @returns {string[]} One failure message per mismatch.
 */
function checkPaths(modules) {
	const paths = modules.paths;
	const straight = [-10, 0, 0, 0, 10, 0, 20, 0, 30, 0, 40, 0];
	const loop = [10, 0, 0, 0, 10, 0, 20, 0, 30, 0, 20, 0];
	const k = 55.2285;
	const quarter = [100, -k, 100, 0, 100, k, k, 100, 0, 100, -k, 100];
	const cases = [
		["straight open path is 30 long", () => [30, sampledPath(modules, straight, false).total]],
		["straight open midpoint", () => [[15, 0, 1, 0], pathPoint(paths, sampledPath(modules, straight, false), 15)]],
		["before the start extends back along the start", () => [[-5, 0, 1, 0], pathPoint(paths, sampledPath(modules, straight, false), -5)]],
		["past the end extends on along the end", () => [[35, 0, 1, 0], pathPoint(paths, sampledPath(modules, straight, false), 35)]],
		["closed path wraps forward", () => [[5, 0, 1, 0], pathPoint(paths, sampledPath(modules, loop, true), 65)]],
		["closed return leg points back", () => [[15, 0, -1, 0], pathPoint(paths, sampledPath(modules, loop, true), 45)]],
		["closed path wraps backward", () => [[5, 0, -1, 0], pathPoint(paths, sampledPath(modules, loop, true), -5)]],
		["quarter circle is within 0.05 of its arc length", () => [1, Number(Math.abs(sampledPath(modules, quarter, false).total - 157.0796) < 0.05)]],
		[
			"quarter circle halfway sits on the circle, pointing back up it",
			() => {
				const sampler = sampledPath(modules, quarter, false);
				const [x, y, cos, sin] = pathPoint(paths, sampler, sampler.total / 2);
				const ok = Math.abs(x - 70.7107) < 0.05 && Math.abs(y - 70.7107) < 0.05 && Math.abs(Math.atan2(sin, cos) - (3 * Math.PI) / 4) < 0.01;
				return [1, Number(ok)];
			}
		],
		["a path with every vertex on one point has no length", () => [0, sampledPath(modules, [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], false).total]]
	];
	return runCases("paths", cases);
}

/**
 * Builds and poses the path constraint toy rig: an identity root, three children of it with length 10 set up at the origin, and a slot on
 * the root showing a straight open path from `(0, 0)` to `(0, 30)`. One path constraint drives the bones named in `bones`.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} constraint Fields to set on top of the default constraint: tangent, percent position 0, length spacing 0, both mixes 1.
 * @param {object} [options] `bones` (constrained bone indices, default `[1, 2, 3]`), `setup` (per-bone overrides keyed by index),
 *     `timelines` and `time` (an animation to apply first), and `before` (called with the skeleton before posing).
 * @returns {object} The posed skeleton.
 */
function pathRig(skeletonModule, constraint, options = {}) {
	const bones = [{}, { parentIndex: 0, length: 10 }, { parentIndex: 0, length: 10 }, { parentIndex: 0, length: 10 }].map((bone, index) => ({ ...bone, ...options.setup?.[index] }));
	const attachment = pathAttachment([0, -10, 0, 0, 0, 10, 0, 20, 0, 30, 0, 40], false);
	const skins = [{ name: "default", attachments: new Map([[0, new Map([["path", attachment]])]]) }];
	const data = skeletonData(bones, [slotData("path", "path")], skins);
	data.path = [
		{
			name: "p",
			order: 0,
			skinRequired: false,
			bones: options.bones ?? [1, 2, 3],
			target: 0,
			positionMode: "percent",
			spacingMode: "length",
			rotateMode: "tangent",
			offsetRotation: 0,
			position: 0,
			spacing: 0,
			rotateMix: 1,
			translateMix: 1,
			...constraint
		}
	];
	if (options.timelines) {
		data.animations = [{ name: "a", duration: 1, timelines: options.timelines }];
	}
	const skeleton = new skeletonModule.Skeleton(data);
	options.before?.(skeleton);
	return skeleton;
}

/**
 * Reads a bone's world position and the angle of its world X axis.
 *
 * @param {object} bone The posed bone.
 * @returns {number[]} `[worldX, worldY, angle in degrees]`.
 */
function placed(bone) {
	return [bone.worldX, bone.worldY, (Math.atan2(bone.c, bone.a) * 180) / Math.PI];
}

/**
 * Poses the toy rig and reads the constrained bones.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @param {object} constraint Constraint overrides, as `pathRig` takes them.
 * @param {object} [options] Options, as `pathRig` takes them, plus `read` (the bone indices to read, default `[1, 2, 3]`).
 * @returns {number[]} Each read bone's `placed` values, flattened.
 */
function posedPath(skeletonModule, constraint, options = {}) {
	const skeleton = pathRig(skeletonModule, constraint, options);
	skeleton.updateWorldTransform();
	return (options.read ?? [1, 2, 3]).flatMap((index) => placed(skeleton.bones[index]));
}

/**
 * Checks path constraints on the toy rig: every position, spacing and rotate mode, the offset, both mixes, a target slot with no path,
 * bones given out of skeleton order, and a second update on the same pose.
 *
 * @param {object} skeletonModule The loaded `skeleton.ts` module.
 * @returns {string[]} One failure message per mismatch.
 */
function checkPathConstraints(skeletonModule) {
	const one = { bones: [1], read: [1] };
	const cases = [
		["tangent lays bones along the path by their lengths", () => [[0, 0, 90, 0, 10, 90, 0, 20, 90], posedPath(skeletonModule, {})]],
		["fixed spacing", () => [[0, 0, 90, 0, 5, 90, 0, 10, 90], posedPath(skeletonModule, { spacingMode: "fixed", spacing: 5 })]],
		["percent spacing is a fraction of the length", () => [[0, 0, 90, 0, 7.5, 90, 0, 15, 90], posedPath(skeletonModule, { spacingMode: "percent", spacing: 0.25 })]],
		["fixed position", () => [[0, 3, 90], posedPath(skeletonModule, { positionMode: "fixed", position: 3 }, one)]],
		["percent position is a fraction of the length", () => [[0, 15, 90], posedPath(skeletonModule, { position: 0.5 }, one)]],
		["a position before the start follows the start's line", () => [[0, -5, 90], posedPath(skeletonModule, { positionMode: "fixed", position: -5 }, one)]],
		["the rotation offset adds to the path direction", () => [[0, 0, 180], posedPath(skeletonModule, { offsetRotation: 90 }, one)]],
		["half translate mix moves halfway", () => [[5, 0], posedPath(skeletonModule, { translateMix: 0.5 }, { ...one, setup: { 1: { x: 10 } } }).slice(0, 2)]],
		["zero rotate mix keeps the rotation", () => [[0, 0, 0], posedPath(skeletonModule, { rotateMix: 0 }, one)]],
		[
			"chainScale stretches each bone to the next position",
			() => {
				const skeleton = pathRig(skeletonModule, { rotateMode: "chainScale", spacingMode: "fixed", spacing: 15 });
				skeleton.updateWorldTransform();
				return [
					[1.5, 90, 1.5, 90, 1.5, 90],
					[1, 2, 3].flatMap((index) => {
						const bone = skeleton.bones[index];
						return [Math.sqrt(bone.a * bone.a + bone.c * bone.c), (Math.atan2(bone.c, bone.a) * 180) / Math.PI];
					})
				];
			}
		],
		["chain lays bones end to end", () => [[0, 0, 90, 0, 10, 90, 0, 20, 90], posedPath(skeletonModule, { rotateMode: "chain" })]],
		[
			"a zero-length bone with nothing to aim at follows the path's direction",
			() => [[0, 0, 90], posedPath(skeletonModule, { rotateMode: "chainScale", spacingMode: "fixed", spacing: 0 }, { ...one, setup: { 1: { length: 0 } } })]
		],
		["a target slot showing no path leaves the bones alone", () => [[0, 0, 0], posedPath(skeletonModule, {}, { ...one, before: (skeleton) => skeleton.setAttachment(0, null) })]],
		["bones in path order out of skeleton order", () => [[0, 0, 90, 0, 10, 90, 0, 20, 90], posedPath(skeletonModule, {}, { bones: [3, 1, 2], read: [3, 1, 2] })]],
		[
			"a second update on the same pose gives the same world",
			() => {
				const skeleton = pathRig(skeletonModule, { rotateMode: "chainScale", spacingMode: "fixed", spacing: 15 }, { bones: [3, 1, 2] });
				skeleton.updateWorldTransform();
				const first = [1, 2, 3].flatMap((index) => [...placed(skeleton.bones[index]), skeleton.bones[index].a]);
				skeleton.updateWorldTransform();
				return [first, [1, 2, 3].flatMap((index) => [...placed(skeleton.bones[index]), skeleton.bones[index].a])];
			}
		]
	];
	return runCases("path constraints", cases);
}

/**
 * Poses the path constraint toy rig at a time in an animation made of the given timelines, and reads the constrained bones.
 *
 * @param {object} modules The loaded `skeleton` and `animation` modules.
 * @param {object} constraint Constraint overrides, as `pathRig` takes them.
 * @param {object[]} timelines The animation's timelines.
 * @param {number} time The time to pose at.
 * @param {object} [options] Options, as `posedPath` takes them.
 * @returns {number[]} Each read bone's `placed` values, flattened.
 */
function animatedPath(modules, constraint, timelines, time, options = {}) {
	const skeleton = pathRig(modules.skeleton, constraint, { ...options, timelines });
	modules.animation.applyAnimation(skeleton, skeleton.data.animations[0], time);
	skeleton.updateWorldTransform();
	return (options.read ?? [1, 2, 3]).flatMap((index) => placed(skeleton.bones[index]));
}

/**
 * Checks the path position, spacing and mix timelines on the toy rig, and that a key after the time leaves the setup value alone.
 *
 * @param {object} modules The loaded `skeleton` and `animation` modules.
 * @returns {string[]} One failure message per mismatch.
 */
function checkPathTimelines(modules) {
	const one = { bones: [1], read: [1] };
	const position = { type: "pathPosition", constraintIndex: 0, times: [0, 1], values: [0, 1], curves: ["linear"] };
	const spacing = { type: "pathSpacing", constraintIndex: 0, times: [0], values: [5], curves: [] };
	const mix = { type: "pathMix", constraintIndex: 0, times: [0], rotateMixes: [0], translateMixes: [0.5], curves: [] };
	const late = { type: "pathPosition", constraintIndex: 0, times: [0.5, 1], values: [1, 1], curves: ["linear"] };
	const cases = [
		["position blends between keys", () => [[0, 15, 90], animatedPath(modules, {}, [position], 0.5, one)]],
		["spacing sets the spacing", () => [[0, 0, 90, 0, 5, 90, 0, 10, 90], animatedPath(modules, { spacingMode: "fixed" }, [spacing], 0)]],
		["mix sets both mixes", () => [[5, 0, 0], animatedPath(modules, {}, [mix], 0, { ...one, setup: { 1: { x: 10 } } })]],
		["a key after the time leaves the setup position", () => [[0, 0, 90], animatedPath(modules, {}, [late], 0.25, one)]]
	];
	return runCases("path timelines", cases);
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Main

const server = await startVite();
let failures = [];
try {
	const skeletonModule = await server.ssrLoadModule("/src/spine/skeleton.ts");
	failures = [...checkBones(skeletonModule), ...checkReset(skeletonModule), ...checkAttachments(skeletonModule), ...checkSkinChange(skeletonModule)];
	try {
		const geometryModule = await server.ssrLoadModule("/src/spine/geometry.ts");
		failures.push(...checkGeometry(skeletonModule, geometryModule), ...checkSlotState(skeletonModule, geometryModule));
	} catch (error) {
		failures.push(`geometry: could not run: ${error.message}`);
	}
	try {
		const animationModule = await server.ssrLoadModule("/src/spine/animation.ts");
		failures.push(...checkAnimation(skeletonModule, animationModule), ...checkSlotTimelines(skeletonModule, animationModule), ...checkIk(skeletonModule, animationModule));
	} catch (error) {
		failures.push(`animation: could not run: ${error.message}`);
	}
	try {
		const animationModule = await server.ssrLoadModule("/src/spine/animation.ts");
		const constraintsModule = await server.ssrLoadModule("/src/spine/constraints.ts");
		failures.push(...checkTransform(skeletonModule, animationModule, constraintsModule));
	} catch (error) {
		failures.push(`transform: could not run: ${error.message}`);
	}
	try {
		const geometryModule = await server.ssrLoadModule("/src/spine/geometry.ts");
		const animationModule = await server.ssrLoadModule("/src/spine/animation.ts");
		failures.push(...checkDeform({ skeleton: skeletonModule, geometry: geometryModule, animation: animationModule }));
	} catch (error) {
		failures.push(`deform: could not run: ${error.message}`);
	}
	try {
		const modules = {
			skeleton: skeletonModule,
			geometry: await server.ssrLoadModule("/src/spine/geometry.ts"),
			animation: await server.ssrLoadModule("/src/spine/animation.ts"),
			clipping: await server.ssrLoadModule("/src/spine/clipping.ts")
		};
		failures.push(...checkClipping(modules));
	} catch (error) {
		failures.push(`clipping: could not run: ${error.message}`);
	}
	try {
		failures.push(...checkPaths({ skeleton: skeletonModule, paths: await server.ssrLoadModule("/src/spine/paths.ts") }));
		failures.push(...checkPathConstraints(skeletonModule));
		failures.push(...checkPathTimelines({ skeleton: skeletonModule, animation: await server.ssrLoadModule("/src/spine/animation.ts") }));
	} catch (error) {
		failures.push(`paths: could not run: ${error.message}`);
	}
	try {
		const rendererModule = await server.ssrLoadModule("/src/spine/renderer.ts");
		failures.push(...checkDrawing(rendererModule));
	} catch (error) {
		failures.push(`drawing: could not run: ${error.message}`);
	}
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
