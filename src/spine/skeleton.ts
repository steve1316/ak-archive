// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Live skeleton

/**
 * A posable skeleton built from `SkeletonData`: bones with local and world transforms, slots with their current attachment and colors,
 * and the skeleton's own position and scale. `MATH.md` explains the bone world transform formulas and the user guide text behind them.
 */

import { createIkConstraint, setIkToSetupPose, solveIk } from "./constraints.js";
import type { IkConstraint } from "./constraints.js";
import type { Attachment, BoneData, Color, Skin, SkeletonData, SlotData } from "./types.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

/** Multiplies degrees into radians. */
export const DEG_TO_RAD = Math.PI / 180;

/** An axis shorter than this counts as zero length. Rounding (such as `cos(90)` giving about 6e-17) leaves squashed axes slightly above 0. */
const MIN_AXIS_LENGTH = 1e-6;

/** The name the binary reader gives the default skin. */
export const DEFAULT_SKIN_NAME = "default";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Types

/**
 * A bone in a live skeleton: its current local transform, the applied transform the world transform is built from, and that world
 * transform. `updateWorldTransform` copies the local values into the applied ones, then constraints change only the applied ones.
 */
export interface Bone {
	/** The bone's setup data. */
	data: BoneData;
	/** The parent bone, or null for the root bone. */
	parent: Bone | null;
	/** Local X position in the parent's axes. */
	x: number;
	/** Local Y position in the parent's axes. */
	y: number;
	/** Local rotation in degrees, counterclockwise from the parent's X axis. */
	rotation: number;
	/** Local scale along the bone's X axis. */
	scaleX: number;
	/** Local scale along the bone's Y axis. */
	scaleY: number;
	/** Local shear of the X axis in degrees. */
	shearX: number;
	/** Local shear of the Y axis in degrees. */
	shearY: number;
	/** Applied X position, the local one unless a constraint changed it. */
	appliedX: number;
	/** Applied Y position. The IK page sets a two-bone child's to 0 in some cases. */
	appliedY: number;
	/** Applied rotation in degrees, the one IK turns. */
	appliedRotation: number;
	/** Applied scale along the X axis, the one IK stretch and compress change. */
	appliedScaleX: number;
	/** Applied scale along the Y axis. */
	appliedScaleY: number;
	/** Applied shear of the X axis in degrees. */
	appliedShearX: number;
	/** Applied shear of the Y axis in degrees. */
	appliedShearY: number;
	/** World basis, X column's X component. The world X axis is `(a, c)`. */
	a: number;
	/** World basis, Y column's X component. The world Y axis is `(b, d)`. */
	b: number;
	/** World basis, X column's Y component. */
	c: number;
	/** World basis, Y column's Y component. */
	d: number;
	/** World X position of the bone's origin. */
	worldX: number;
	/** World Y position of the bone's origin. */
	worldY: number;
}

/** A slot in a live skeleton: the bone it follows, the attachment it currently shows and its current colors. */
export interface Slot {
	/** The slot's setup data. */
	data: SlotData;
	/** The bone this slot is attached to. */
	bone: Bone;
	/** Index of this slot in `Skeleton.slots`, which is also its index in the data. */
	index: number;
	/** The attachment currently shown, or null for none. */
	attachment: Attachment | null;
	/** The current tint, the slot's own copy. `setToSetupPose` resets it from the data's color. */
	color: Color;
	/** The current dark tint for two-color tinting, or null when the slot has none. `setToSetupPose` resets it from the data's dark color. */
	darkColor: Color | null;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Maps a point in a bone's local space to world space.
 *
 * @param bone The bone, with its world transform up to date.
 * @param x Local X.
 * @param y Local Y.
 * @returns The world point as `[x, y]`.
 */
export function localToWorld(bone: Bone, x: number, y: number): [number, number] {
	return [bone.a * x + bone.b * y + bone.worldX, bone.c * x + bone.d * y + bone.worldY];
}

/**
 * Picks the skin to show when none is chosen. Several staged rigs keep their setup attachments only in a named skin, so a rig with more
 * than one skin shows its first non-default skin in file order. A rig with only the default skin keeps it.
 *
 * @param data The skeleton data.
 * @returns The skin name, or null when the rig has no skins.
 */
export function defaultSkinName(data: SkeletonData): string | null {
	const named = data.skins.length > 1 ? data.skins.find((skin) => skin.name !== DEFAULT_SKIN_NAME) : undefined;
	return (named ?? data.skins.find((skin) => skin.name === DEFAULT_SKIN_NAME))?.name ?? null;
}

/**
 * Copies one color's channels into another.
 *
 * @param target The color to write.
 * @param source The color to read.
 */
function copyColor(target: Color, source: Color): void {
	target.r = source.r;
	target.g = source.g;
	target.b = source.b;
	target.a = source.a;
}

/**
 * Makes a bone with its local transform from the setup data and an identity world transform.
 *
 * @param data The bone's setup data.
 * @param parent The parent bone, or null for the root.
 * @returns The new bone.
 */
function createBone(data: BoneData, parent: Bone | null): Bone {
	const bone: Bone = {
		data,
		parent,
		x: 0,
		y: 0,
		rotation: 0,
		scaleX: 1,
		scaleY: 1,
		shearX: 0,
		shearY: 0,
		appliedX: 0,
		appliedY: 0,
		appliedRotation: 0,
		appliedScaleX: 1,
		appliedScaleY: 1,
		appliedShearX: 0,
		appliedShearY: 0,
		a: 1,
		b: 0,
		c: 0,
		d: 1,
		worldX: 0,
		worldY: 0
	};
	setBoneToSetupPose(bone);
	return bone;
}

/**
 * Copies a bone's setup-pose local transform from its data.
 *
 * @param bone The bone to reset.
 */
function setBoneToSetupPose(bone: Bone): void {
	const data = bone.data;
	bone.x = data.x;
	bone.y = data.y;
	bone.rotation = data.rotation;
	bone.scaleX = data.scaleX;
	bone.scaleY = data.scaleY;
	bone.shearX = data.shearX;
	bone.shearY = data.shearY;
}

/**
 * Copies a bone's local transform into its applied transform.
 *
 * @param bone The bone.
 */
function applyLocal(bone: Bone): void {
	bone.appliedX = bone.x;
	bone.appliedY = bone.y;
	bone.appliedRotation = bone.rotation;
	bone.appliedScaleX = bone.scaleX;
	bone.appliedScaleY = bone.scaleY;
	bone.appliedShearX = bone.shearX;
	bone.appliedShearY = bone.shearY;
}

/**
 * Computes one bone's world transform from its applied transform and its parent frame: the parent bone's world transform, or the skeleton's
 * own position and scale for the root. See `MATH.md` for each inherit mode. It takes only objects, so no number is boxed to pass it.
 *
 * @param bone The bone to update.
 * @param skeleton The skeleton the bone belongs to.
 */
function updateBone(bone: Bone, skeleton: Skeleton): void {
	const parent = bone.parent;
	const skeletonScaleX = skeleton.scaleX;
	const skeletonScaleY = skeleton.scaleY;
	const parentA = parent ? parent.a : skeletonScaleX;
	const parentB = parent ? parent.b : 0;
	const parentC = parent ? parent.c : 0;
	const parentD = parent ? parent.d : skeletonScaleY;
	const parentX = parent ? parent.worldX : skeleton.x;
	const parentY = parent ? parent.worldY : skeleton.y;

	// Local axes at unit length: the X axis at rotation + shearX, the Y axis at rotation + 90 + shearY. Scale sets their lengths.
	const xAngle = (bone.appliedRotation + bone.appliedShearX) * DEG_TO_RAD;
	const yAngle = (bone.appliedRotation + 90 + bone.appliedShearY) * DEG_TO_RAD;
	const ra = Math.cos(xAngle);
	const rc = Math.sin(xAngle);
	const rb = Math.cos(yAngle);
	const rd = Math.sin(yAngle);
	const scaleX = bone.appliedScaleX;
	const scaleY = bone.appliedScaleY;
	// The local basis `L`, with the scales on.
	const la = ra * scaleX;
	const lb = rb * scaleY;
	const lc = rc * scaleX;
	const ld = rd * scaleY;

	// The position always goes through the full parent transform. Only the basis depends on the inherit mode.
	bone.worldX = parentA * bone.appliedX + parentB * bone.appliedY + parentX;
	bone.worldY = parentC * bone.appliedX + parentD * bone.appliedY + parentY;

	// Each basis is written out in place. A helper taking the numbers as arguments boxes them when V8 does not inline it.
	const mode = bone.data.transformMode;
	if (mode === "normal") {
		bone.a = parentA * la + parentB * lc;
		bone.b = parentA * lb + parentB * ld;
		bone.c = parentC * la + parentD * lc;
		bone.d = parentC * lb + parentD * ld;
		return;
	}

	// The other modes read the parent without the skeleton's scale, then put that scale back, so a skeleton flip mirrors every bone.
	const inverseX = skeletonScaleX === 0 ? 0 : 1 / skeletonScaleX;
	const inverseY = skeletonScaleY === 0 ? 0 : 1 / skeletonScaleY;
	const pa = parentA * inverseX;
	const pb = parentB * inverseX;
	const pc = parentC * inverseY;
	const pd = parentD * inverseY;
	switch (mode) {
		case "onlyTranslation":
			bone.a = la;
			bone.b = lb;
			bone.c = lc;
			bone.d = ld;
			break;
		case "noRotationOrReflection": {
			const lengthX = Math.sqrt(pa * pa + pc * pc);
			const lengthY = Math.sqrt(pb * pb + pd * pd);
			bone.a = lengthX * la;
			bone.b = lengthX * lb;
			bone.c = lengthY * lc;
			bone.d = lengthY * ld;
			break;
		}
		case "noScale":
		case "noScaleOrReflection": {
			// The parent turns and bends the unit axes. Each axis is then cut back to unit length and given the bone's own scale.
			const reflected = pa * pd - pb * pc < 0;
			const flipY = mode === "noScaleOrReflection" && reflected ? -1 : 1;
			const xa = pa * ra + pb * rc;
			const xc = pc * ra + pd * rc;
			const ya = pa * rb + pb * rd;
			const yc = pc * rb + pd * rd;
			const xLength = Math.sqrt(xa * xa + xc * xc);
			const yLength = Math.sqrt(ya * ya + yc * yc);
			// An axis squashed to zero length leaves no direction to follow, so that axis falls back to the parent's X axis angle.
			const theta = Math.atan2(pc, pa);
			const flip = mode === "noScale" && reflected ? -1 : 1;
			if (xLength >= MIN_AXIS_LENGTH) {
				bone.a = (xa / xLength) * scaleX;
				bone.c = (xc / xLength) * scaleX;
			} else {
				bone.a = rotatedAxisX(theta, flip, la, lc);
				bone.c = rotatedAxisY(theta, flip, la, lc);
			}
			if (yLength >= MIN_AXIS_LENGTH) {
				bone.b = (ya / yLength) * scaleY * flipY;
				bone.d = (yc / yLength) * scaleY * flipY;
			} else {
				bone.b = rotatedAxisX(theta, flip, lb, ld);
				bone.d = rotatedAxisY(theta, flip, lb, ld);
			}
			break;
		}
	}
	bone.a *= skeletonScaleX;
	bone.b *= skeletonScaleX;
	bone.c *= skeletonScaleY;
	bone.d *= skeletonScaleY;
}

/**
 * Maps a local axis through `R(theta) * diag(1, flip)`, the fallback basis for `noScale` and `noScaleOrReflection`, and gives the X component.
 *
 * @param theta Rotation in radians.
 * @param flip 1, or -1 to mirror the Y component first.
 * @param x The axis's X component.
 * @param y The axis's Y component.
 * @returns The mapped axis's X component.
 */
function rotatedAxisX(theta: number, flip: number, x: number, y: number): number {
	return Math.cos(theta) * x - Math.sin(theta) * flip * y;
}

/**
 * Maps a local axis through `R(theta) * diag(1, flip)`, as `rotatedAxisX` does, and gives the Y component.
 *
 * @param theta Rotation in radians.
 * @param flip 1, or -1 to mirror the Y component first.
 * @param x The axis's X component.
 * @param y The axis's Y component.
 * @returns The mapped axis's Y component.
 */
function rotatedAxisY(theta: number, flip: number, x: number, y: number): number {
	return Math.sin(theta) * x + Math.cos(theta) * flip * y;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Skeleton

/** A live skeleton: the bones, slots, draw order and skin for one `SkeletonData`, posed and placed in the world. */
export class Skeleton {
	/** The data this skeleton was built from. */
	readonly data: SkeletonData;
	/** Every bone, in data order, so each parent comes before its children. */
	readonly bones: Bone[];
	/** Every slot, in data order. */
	readonly slots: Slot[];
	/** The slots in the order they are drawn, back to front. The skeleton owns this array, so change it in place. */
	readonly drawOrder: Slot[];
	/** Every IK constraint, in data order. */
	readonly ikConstraints: IkConstraint[];
	/** The active skin, or null to use only the default skin. */
	skin: Skin | null = null;
	/** World X of the skeleton's origin. */
	x = 0;
	/** World Y of the skeleton's origin. */
	y = 0;
	/** Scale applied to the whole skeleton along world X. */
	scaleX = 1;
	/** Scale applied to the whole skeleton along world Y. */
	scaleY = 1;

	/** The default skin, or null when the data has none. */
	private readonly defaultSkin: Skin | null;
	/**
	 * The constraints in the order they run, ascending `order`, each with the bones to recompute after it: its first bone and every
	 * descendant, parents first. Transform and path constraints can join this list later.
	 */
	private readonly constraintSteps: { constraint: IkConstraint; bones: Bone[] }[];

	/**
	 * Builds the bones and slots for the data and puts them in the setup pose. Call `updateWorldTransform` before reading world values.
	 *
	 * @param data The skeleton data, as `readSkeleton` returns it.
	 */
	constructor(data: SkeletonData) {
		this.data = data;
		this.bones = [];
		for (const boneData of data.bones) {
			// Parents come before their children, so a real parent is already built.
			const parent = boneData.parentIndex === null ? null : this.bones[boneData.parentIndex];
			if (parent === undefined) {
				throw new Error(`Bone ${boneData.name} names parent ${boneData.parentIndex}, which does not come before it`);
			}
			this.bones.push(createBone(boneData, parent));
		}
		this.slots = data.slots.map((slotData, index) => {
			const bone = this.bones[slotData.boneIndex];
			if (!bone) {
				throw new Error(`Slot ${slotData.name} names bone ${slotData.boneIndex}, which does not exist`);
			}
			return { data: slotData, bone, index, attachment: null, color: { ...slotData.color }, darkColor: slotData.darkColor ? { ...slotData.darkColor } : null };
		});
		this.drawOrder = [];
		this.ikConstraints = data.ik.map((ikData) => createIkConstraint(ikData, this));
		this.constraintSteps = [...this.ikConstraints].sort((first, second) => first.data.order - second.data.order).map((constraint) => ({ constraint, bones: this.subtree(constraint.bones[0]!) }));
		this.defaultSkin = data.skins.find((skin) => skin.name === DEFAULT_SKIN_NAME) ?? null;
		this.setToSetupPose();
	}

	/**
	 * Sets the active skin by name and swaps in its attachments. Bone locals and the draw order stay as they are. From no skin, each slot
	 * whose setup attachment the new skin has takes it. From another skin, a slot showing the old skin's attachment takes what `getAttachment`
	 * gives for the same name, and every other slot keeps its attachment. Call `setToSetupPose` after for a full reset.
	 *
	 * @param name The skin's name, or null to use only the default skin.
	 */
	setSkin(name: string | null): void {
		const skin = name === null ? null : this.data.skins.find((candidate) => candidate.name === name);
		if (skin === undefined) {
			throw new Error(`Skin not found: ${name}`);
		}
		const oldSkin = this.skin;
		this.skin = skin;
		this.slots.forEach((slot, index) => {
			if (oldSkin === null) {
				const setupName = slot.data.attachmentName;
				const fromSkin = setupName === null ? undefined : skin?.attachments.get(index)?.get(setupName);
				if (fromSkin) {
					slot.attachment = fromSkin;
				}
				return;
			}
			for (const [key, attachment] of oldSkin.attachments.get(index) ?? []) {
				if (attachment === slot.attachment) {
					slot.attachment = this.getAttachment(index, key);
					return;
				}
			}
		});
	}

	/**
	 * Looks up an attachment for a slot in the active skin, then in the default skin.
	 *
	 * @param slotIndex Index of the slot.
	 * @param name The attachment's name within the skin.
	 * @returns The attachment, or null when neither skin has it.
	 */
	getAttachment(slotIndex: number, name: string): Attachment | null {
		const fromSkin = this.skin?.attachments.get(slotIndex)?.get(name);
		if (fromSkin) {
			return fromSkin;
		}
		return this.defaultSkin?.attachments.get(slotIndex)?.get(name) ?? null;
	}

	/**
	 * Shows an attachment in a slot, looked up by name as `getAttachment` does.
	 *
	 * @param slotIndex Index of the slot.
	 * @param name The attachment's name, or null to clear the slot. A name neither skin has also clears it.
	 */
	setAttachment(slotIndex: number, name: string | null): void {
		const slot = this.slots[slotIndex];
		if (!slot) {
			throw new Error(`Slot ${slotIndex} does not exist`);
		}
		slot.attachment = name === null ? null : this.getAttachment(slotIndex, name);
	}

	/**
	 * Resets every bone's local transform, every constraint's keyable values, the draw order, and every slot's attachment and colors. The
	 * bones' applied values are left alone. `updateWorldTransform` refreshes them from the locals before it reads them.
	 */
	setToSetupPose(): void {
		const bones = this.bones;
		for (let i = 0; i < bones.length; i++) {
			setBoneToSetupPose(bones[i]!);
		}
		const ikConstraints = this.ikConstraints;
		for (let i = 0; i < ikConstraints.length; i++) {
			setIkToSetupPose(ikConstraints[i]!);
		}
		const slots = this.slots;
		this.drawOrder.length = slots.length;
		for (let index = 0; index < slots.length; index++) {
			const slot = slots[index]!;
			this.drawOrder[index] = slot;
			const name = slot.data.attachmentName;
			slot.attachment = name === null ? null : this.getAttachment(index, name);
			copyColor(slot.color, slot.data.color);
			const darkColor = slot.data.darkColor;
			if (darkColor === null) {
				slot.darkColor = null;
			} else if (slot.darkColor === null) {
				slot.darkColor = { ...darkColor };
			} else {
				copyColor(slot.darkColor, darkColor);
			}
		}
	}

	/**
	 * Computes every bone's world transform, then applies the constraints. Each bone's applied transform starts as its local one, and one
	 * pass in parent-first order covers the tree. Each constraint then runs in `order`, and its bones and their descendants are recomputed
	 * after it. Only applied values change, so running it twice on the same pose gives the same result. Creates no objects.
	 */
	updateWorldTransform(): void {
		const bones = this.bones;
		for (let i = 0; i < bones.length; i++) {
			const bone = bones[i]!;
			applyLocal(bone);
			updateBone(bone, this);
		}
		const steps = this.constraintSteps;
		for (let i = 0; i < steps.length; i++) {
			const step = steps[i]!;
			solveIk(step.constraint);
			const recompute = step.bones;
			for (let j = 0; j < recompute.length; j++) {
				updateBone(recompute[j]!, this);
			}
		}
	}

	/**
	 * Lists a bone and every bone below it, in parent-first order.
	 *
	 * @param root The bone at the top of the subtree.
	 * @returns The bones, `root` first.
	 */
	private subtree(root: Bone): Bone[] {
		const inside = new Set<Bone>([root]);
		for (const bone of this.bones) {
			if (bone.parent && inside.has(bone.parent)) {
				inside.add(bone);
			}
		}
		return [...inside];
	}
}
