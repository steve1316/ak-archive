#!/usr/bin/env node
/**
 * The maths gate for the Spine runtime: builds tiny synthetic skeletons, poses them with `src/spine/skeleton.ts`, and checks the bone world
 * transforms, setup-pose attachments, live slot state, `src/spine/geometry.ts` triangles, `src/spine/animation.ts` curves, key search,
 * bone, slot and draw order timelines, IK constraints and IK timelines, and the `src/spine/renderer.ts` two-color tint and blend factors
 * against hand-worked values.
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
