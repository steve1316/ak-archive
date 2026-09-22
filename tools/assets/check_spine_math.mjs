#!/usr/bin/env node
/**
 * The maths gate for the Spine runtime: builds tiny synthetic skeletons, poses them with `src/spine/skeleton.ts`, and checks the bone world
 * transforms, setup-pose attachments, live slot state and `src/spine/geometry.ts` triangles against hand-worked values. `MATH.md` explains
 * each formula the cases pin down.
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

	const failures = [];
	for (const [label, run] of cases) {
		let problem = null;
		try {
			const [expected, actual] = run();
			const ok = Array.isArray(expected) ? Array.isArray(actual) && actual.length === expected.length && close(expected, actual) : expected === actual;
			if (!ok) {
				problem = `expected ${shownValue(expected)}, got ${shownValue(actual)}`;
			}
		} catch (error) {
			problem = `threw ${error.message}`;
		}
		console.log(`${problem === null ? "ok  " : "FAIL"} slot state: ${label}`);
		if (problem !== null) {
			failures.push(`slot state: ${label} ${problem}`);
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
	failures = [...checkBones(skeletonModule), ...checkReset(skeletonModule), ...checkAttachments(skeletonModule), ...checkSkinChange(skeletonModule)];
	try {
		const geometryModule = await server.ssrLoadModule("/src/spine/geometry.ts");
		failures.push(...checkGeometry(skeletonModule, geometryModule), ...checkSlotState(skeletonModule, geometryModule));
	} catch (error) {
		failures.push(`geometry: could not run: ${error.message}`);
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
