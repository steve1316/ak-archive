// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Live skeleton

/**
 * A posable skeleton built from `SkeletonData`: bones with local and world transforms, slots with their current attachment, and the
 * skeleton's own position and scale. `MATH.md` explains the bone world transform formulas and the user guide text behind them.
 */

import type { Attachment, BoneData, Skin, SkeletonData, SlotData } from "./types.js";

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

/** A bone in a live skeleton: its current local transform and the world transform computed from it. */
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

/** A slot in a live skeleton: the bone it follows and the attachment it currently shows. */
export interface Slot {
	/** The slot's setup data. */
	data: SlotData;
	/** The bone this slot is attached to. */
	bone: Bone;
	/** The attachment currently shown, or null for none. */
	attachment: Attachment | null;
}

/** A 2x2 basis `[a b; c d]` plus a translation: a bone's parent frame. A `Bone` is one, and the skeleton's own frame is one for the root. */
interface Frame {
	/** X column's X component. */
	a: number;
	/** Y column's X component. */
	b: number;
	/** X column's Y component. */
	c: number;
	/** Y column's Y component. */
	d: number;
	/** Translation X. */
	worldX: number;
	/** Translation Y. */
	worldY: number;
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
 * Makes a bone with its local transform from the setup data and an identity world transform.
 *
 * @param data The bone's setup data.
 * @param parent The parent bone, or null for the root.
 * @returns The new bone.
 */
function createBone(data: BoneData, parent: Bone | null): Bone {
	const bone: Bone = { data, parent, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0 };
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
 * Computes one bone's world transform from its local transform and its parent frame. See `MATH.md` for each inherit mode.
 *
 * @param bone The bone to update.
 * @param parent The parent's world frame: the parent bone, or the skeleton's own frame for the root.
 * @param skeletonScaleX The skeleton's scale along world X.
 * @param skeletonScaleY The skeleton's scale along world Y.
 */
function updateBone(bone: Bone, parent: Frame, skeletonScaleX: number, skeletonScaleY: number): void {
	// Local axes at unit length: the X axis at rotation + shearX, the Y axis at rotation + 90 + shearY. Scale sets their lengths.
	const xAngle = (bone.rotation + bone.shearX) * DEG_TO_RAD;
	const yAngle = (bone.rotation + 90 + bone.shearY) * DEG_TO_RAD;
	const ra = Math.cos(xAngle);
	const rc = Math.sin(xAngle);
	const rb = Math.cos(yAngle);
	const rd = Math.sin(yAngle);
	const { scaleX, scaleY } = bone;

	// The position always goes through the full parent transform. Only the basis depends on the inherit mode.
	bone.worldX = parent.a * bone.x + parent.b * bone.y + parent.worldX;
	bone.worldY = parent.c * bone.x + parent.d * bone.y + parent.worldY;

	const mode = bone.data.transformMode;
	if (mode === "normal") {
		setBasis(bone, parent.a, parent.b, parent.c, parent.d, ra * scaleX, rb * scaleY, rc * scaleX, rd * scaleY);
		return;
	}

	// The other modes read the parent without the skeleton's scale, then put that scale back, so a skeleton flip mirrors every bone.
	const inverseX = skeletonScaleX === 0 ? 0 : 1 / skeletonScaleX;
	const inverseY = skeletonScaleY === 0 ? 0 : 1 / skeletonScaleY;
	const pa = parent.a * inverseX;
	const pb = parent.b * inverseX;
	const pc = parent.c * inverseY;
	const pd = parent.d * inverseY;
	switch (mode) {
		case "onlyTranslation":
			setBasis(bone, 1, 0, 0, 1, ra * scaleX, rb * scaleY, rc * scaleX, rd * scaleY);
			break;
		case "noRotationOrReflection":
			setBasis(bone, Math.hypot(pa, pc), 0, 0, Math.hypot(pb, pd), ra * scaleX, rb * scaleY, rc * scaleX, rd * scaleY);
			break;
		case "noScale":
		case "noScaleOrReflection": {
			// The parent turns and bends the unit axes. Each axis is then cut back to unit length and given the bone's own scale.
			const reflected = pa * pd - pb * pc < 0;
			const flipY = mode === "noScaleOrReflection" && reflected ? -1 : 1;
			const xa = pa * ra + pb * rc;
			const xc = pc * ra + pd * rc;
			const ya = pa * rb + pb * rd;
			const yc = pc * rb + pd * rd;
			const xLength = Math.hypot(xa, xc);
			const yLength = Math.hypot(ya, yc);
			// An axis squashed to zero length leaves no direction to follow, so that axis falls back to the parent's X axis angle.
			const theta = Math.atan2(pc, pa);
			const flip = mode === "noScale" && reflected ? -1 : 1;
			[bone.a, bone.c] = xLength >= MIN_AXIS_LENGTH ? [(xa / xLength) * scaleX, (xc / xLength) * scaleX] : rotatedAxis(theta, flip, ra * scaleX, rc * scaleX);
			[bone.b, bone.d] = yLength >= MIN_AXIS_LENGTH ? [(ya / yLength) * scaleY * flipY, (yc / yLength) * scaleY * flipY] : rotatedAxis(theta, flip, rb * scaleY, rd * scaleY);
			break;
		}
	}
	bone.a *= skeletonScaleX;
	bone.b *= skeletonScaleX;
	bone.c *= skeletonScaleY;
	bone.d *= skeletonScaleY;
}

/**
 * Maps a local axis through `R(theta) * diag(1, flip)`, the fallback basis for `noScale` and `noScaleOrReflection`.
 *
 * @param theta Rotation in radians.
 * @param flip 1, or -1 to mirror the Y component first.
 * @param x The axis's X component.
 * @param y The axis's Y component.
 * @returns The mapped axis as `[x, y]`.
 */
function rotatedAxis(theta: number, flip: number, x: number, y: number): [number, number] {
	const cos = Math.cos(theta);
	const sin = Math.sin(theta);
	return [cos * x - sin * flip * y, sin * x + cos * flip * y];
}

/**
 * Sets a bone's world basis to `M * L`.
 *
 * @param bone The bone to set.
 * @param ma `M`'s X column, X component.
 * @param mb `M`'s Y column, X component.
 * @param mc `M`'s X column, Y component.
 * @param md `M`'s Y column, Y component.
 * @param la `L`'s X column, X component.
 * @param lb `L`'s Y column, X component.
 * @param lc `L`'s X column, Y component.
 * @param ld `L`'s Y column, Y component.
 */
function setBasis(bone: Bone, ma: number, mb: number, mc: number, md: number, la: number, lb: number, lc: number, ld: number): void {
	bone.a = ma * la + mb * lc;
	bone.b = ma * lb + mb * ld;
	bone.c = mc * la + md * lc;
	bone.d = mc * lb + md * ld;
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
	/** The slots in the order they are drawn, back to front. */
	drawOrder: Slot[];
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
		this.slots = data.slots.map((slotData) => {
			const bone = this.bones[slotData.boneIndex];
			if (!bone) {
				throw new Error(`Slot ${slotData.name} names bone ${slotData.boneIndex}, which does not exist`);
			}
			return { data: slotData, bone, attachment: null };
		});
		this.drawOrder = [...this.slots];
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

	/** Resets every bone's local transform, the draw order and every slot's attachment to the setup pose. */
	setToSetupPose(): void {
		for (const bone of this.bones) {
			setBoneToSetupPose(bone);
		}
		this.drawOrder = [...this.slots];
		this.slots.forEach((slot, index) => {
			const name = slot.data.attachmentName;
			slot.attachment = name === null ? null : this.getAttachment(index, name);
		});
	}

	/** Computes every bone's world transform. Bones are in parent-first order, so one pass covers the tree. */
	updateWorldTransform(): void {
		const root: Frame = { a: this.scaleX, b: 0, c: 0, d: this.scaleY, worldX: this.x, worldY: this.y };
		for (const bone of this.bones) {
			updateBone(bone, bone.parent ?? root, this.scaleX, this.scaleY);
		}
	}
}
