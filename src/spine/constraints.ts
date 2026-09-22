// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constraints

/**
 * IK constraints: turning one bone to point at a target, or two bones so the child's tip reaches it. The solve writes the chain's applied
 * rotation and scale, never the local values animation writes. `MATH.md` ("IK constraints") derives each step and names the corpus
 * evidence behind the bend direction and the space the solve works in.
 */

import type { Bone, Skeleton } from "./skeleton.js";
import type { IkConstraintData } from "./types.js";

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Types

/** A live IK constraint: its setup data, the bones it drives and the values timelines can key, reset from the data by `setToSetupPose`. */
export interface IkConstraint {
	/** The constraint's setup data. */
	data: IkConstraintData;
	/** The constrained bones: one, or a parent and its direct child. */
	bones: Bone[];
	/** The bone the chain reaches for. */
	target: Bone;
	/** The skeleton the bones belong to, whose position and scale frame a root bone. */
	skeleton: Skeleton;
	/** Current influence, from 0 (only the animated pose) to 1 (only the solve). */
	mix: number;
	/** Current two-bone softness: how far short of full reach the chain starts to ease. */
	softness: number;
	/** Current bend direction for two bones: 1 turns the child counterclockwise from the parent, -1 clockwise. */
	bendDirection: number;
	/** Current compress flag: a single bone scales down to reach a near target. */
	compress: boolean;
	/** Current stretch flag: the chain scales up to reach a far target. */
	stretch: boolean;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constants

// `Math.hypot` is not used here. It allocates on every call in V8, while `Math.sqrt` of a sum of squares does not.

/** Multiplies radians into degrees. */
const RAD_TO_DEG = 180 / Math.PI;

/** Multiplies degrees into radians. */
const DEG_TO_RAD = Math.PI / 180;

/** A distance or length below this counts as zero, so no direction can be taken from it. */
const EPSILON = 1e-9;

/** Two local scales whose sizes differ by more than this make a nonuniform parent, which the IK page's two-bone limits name. */
const UNIFORM_TOLERANCE = 1e-4;

/**
 * Scratch for the solve. Slots 0 to 3 hold the basis `[a b; c d]` a bone's local axes are mapped through, and slots 4 and 5 the target
 * in that basis, measured from the bone's origin. A typed array keeps the doubles unboxed, so solving allocates nothing.
 */
const scratch = new Float64Array(6);

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers

/**
 * Writes into `scratch` the basis a bone's local axes are mapped through, which depends on its transform mode, and the target's offset
 * from the bone's world origin mapped back through it. A normal or `noScale` bone uses its parent's world basis (the skeleton frame for
 * the root). `onlyTranslation` uses the skeleton's scale alone, and `noRotationOrReflection` that scale times the parent's axis lengths.
 *
 * @param bone The bone whose axes the target is measured in.
 * @param target The target bone, with its world transform up to date.
 * @param skeleton The skeleton the bone belongs to.
 * @returns False when the basis has no inverse, so nothing can be solved.
 */
function targetInBoneSpace(bone: Bone, target: Bone, skeleton: Skeleton): boolean {
	const parent = bone.parent;
	const skeletonScaleX = skeleton.scaleX;
	const skeletonScaleY = skeleton.scaleY;
	let a = parent ? parent.a : skeletonScaleX;
	let b = parent ? parent.b : 0;
	let c = parent ? parent.c : 0;
	let d = parent ? parent.d : skeletonScaleY;
	const mode = bone.data.transformMode;
	if (mode === "onlyTranslation") {
		a = skeletonScaleX;
		b = 0;
		c = 0;
		d = skeletonScaleY;
	} else if (mode === "noRotationOrReflection") {
		const inverseX = skeletonScaleX === 0 ? 0 : 1 / skeletonScaleX;
		const inverseY = skeletonScaleY === 0 ? 0 : 1 / skeletonScaleY;
		const xa = a * inverseX;
		const xc = c * inverseY;
		const yb = b * inverseX;
		const yd = d * inverseY;
		const lengthX = Math.sqrt(xa * xa + xc * xc);
		const lengthY = Math.sqrt(yb * yb + yd * yd);
		a = skeletonScaleX * lengthX;
		b = 0;
		c = 0;
		d = skeletonScaleY * lengthY;
	}
	const determinant = a * d - b * c;
	if (Math.abs(determinant) < EPSILON) {
		return false;
	}
	const dx = target.worldX - bone.worldX;
	const dy = target.worldY - bone.worldY;
	scratch[0] = a;
	scratch[1] = b;
	scratch[2] = c;
	scratch[3] = d;
	scratch[4] = (d * dx - b * dy) / determinant;
	scratch[5] = (a * dy - c * dx) / determinant;
	return true;
}

/**
 * Turns one bone so its X axis points at the target, then scales it to reach when compress or stretch applies. Both blend by the mix.
 *
 * @param constraint The constraint, with one bone.
 * @param bone The constrained bone.
 */
function solveOneBone(constraint: IkConstraint, bone: Bone): void {
	if (!targetInBoneSpace(bone, constraint.target, constraint.skeleton)) {
		return;
	}
	const tx = scratch[4]!;
	const ty = scratch[5]!;
	const mix = constraint.mix;
	// Shear tilts the X axis away from the rotation, and a negative scale X points it backward. Both are taken off the target's angle.
	const scaleX = bone.appliedScaleX;
	const shearX = bone.appliedShearX * DEG_TO_RAD;
	const axisAngle = Math.atan2(Math.sin(shearX) * scaleX, Math.cos(shearX) * scaleX);
	// Blend the short way round: the turn is wrapped into [-180, 180) first. It is written out here, since a helper returning a number
	// would box it when not inlined.
	const turn = (Math.atan2(ty, tx) - axisAngle) * RAD_TO_DEG - bone.appliedRotation;
	bone.appliedRotation += (turn - 360 * Math.floor((turn + 180) / 360)) * mix;

	const length = bone.data.length * Math.abs(scaleX);
	if (length <= EPSILON) {
		return;
	}
	const distance = Math.sqrt(tx * tx + ty * ty);
	if ((constraint.compress && distance < length) || (constraint.stretch && distance > length)) {
		const scale = 1 + (distance / length - 1) * mix;
		bone.appliedScaleX *= scale;
		if (constraint.data.uniform) {
			bone.appliedScaleY *= scale;
		}
	}
}

/**
 * Turns a parent and its child so the child's tip reaches the target, by the law of cosines in the parent's space. `bendDirection` picks
 * which of the two mirror solutions is used. Softness eases the reach near full length, and stretch scales the parent's local X (and Y
 * when uniform) so the straight chain reaches a far target. The child inherits that scale. The IK page's limits apply: the parent's shear
 * is set to 0, and the child's Y is set to 0 with stretch on or under a parent with nonuniform scale.
 *
 * @param constraint The constraint, with two bones.
 * @param parent The first constrained bone.
 * @param child The second, a direct child of `parent`.
 */
function solveTwoBones(constraint: IkConstraint, parent: Bone, child: Bone): void {
	if (!targetInBoneSpace(parent, constraint.target, constraint.skeleton)) {
		return;
	}
	const tx = scratch[4]!;
	const ty = scratch[5]!;
	const distance = Math.sqrt(tx * tx + ty * ty);
	if (distance <= EPSILON) {
		return;
	}
	const mix = constraint.mix;
	const softness = constraint.softness;
	parent.appliedShearX = 0;
	parent.appliedShearY = 0;
	let scaleX = parent.appliedScaleX;
	let scaleY = parent.appliedScaleY;
	const nonuniform = Math.abs(Math.abs(scaleX) - Math.abs(scaleY)) > UNIFORM_TOLERANCE;
	if (nonuniform || constraint.stretch) {
		child.appliedY = 0;
	}

	// With no shear the parent's local basis is R(rotation) * diag(scaleX, scaleY). The child's origin and tip offsets go through the diagonal.
	const originX = scaleX * child.appliedX;
	const originY = scaleY * child.appliedY;
	let a = Math.sqrt(originX * originX + originY * originY);
	if (a <= EPSILON) {
		return;
	}
	const originAngle = Math.atan2(originY, originX);
	const childLength = child.data.length * child.appliedScaleX;
	const childShear = child.appliedShearX * DEG_TO_RAD;
	const tipX = Math.cos(childShear) * childLength;
	const tipY = Math.sin(childShear) * childLength;
	const childRotation = child.appliedRotation * DEG_TO_RAD;
	const turnedX = Math.cos(childRotation) * tipX - Math.sin(childRotation) * tipY;
	const turnedY = Math.sin(childRotation) * tipX + Math.cos(childRotation) * tipY;
	const tipOffsetX = scaleX * turnedX;
	const tipOffsetY = scaleY * turnedY;
	let b = Math.sqrt(tipOffsetX * tipOffsetX + tipOffsetY * tipOffsetY);

	// Softness eases the reach from `reach - softness` so the chain is only fully straight once the target is `softness` past full reach.
	const reach = a + b;
	let aim = distance;
	if (softness > 0 && distance > reach - softness) {
		const past = distance - (reach - softness);
		aim = past >= 2 * softness ? reach : reach - softness + past - (past * past) / (4 * softness);
		// A softness larger than the reach would ease a near target to a negative distance and fold the chain backward, so it stops at 0.
		aim = Math.max(0, aim);
	}
	// Stretch scales the parent, which the child inherits, so both offsets grow by the same factor and the straight chain ends on the target.
	let stretch = 1;
	if (constraint.stretch && softness === 0 && !nonuniform && distance > reach && reach > EPSILON) {
		stretch = distance / reach;
		scaleX *= stretch;
		if (constraint.data.uniform) {
			scaleY *= stretch;
		}
		a *= stretch;
		b *= stretch;
	}

	// At an aim of 0 the parent points at the target and the child folds back toward the parent's origin.
	let cosine = aim <= EPSILON ? 1 : (a * a + aim * aim - b * b) / (2 * a * aim);
	cosine = Math.max(-1, Math.min(1, cosine));
	const targetAngle = Math.atan2(ty, tx);
	const parentAngle = targetAngle - constraint.bendDirection * Math.acos(cosine);
	const parentRotation = parentAngle - originAngle;

	// Aim the child from its new origin at the eased target point, measured in the parent's axes.
	const aimX = Math.cos(targetAngle) * aim - Math.cos(parentAngle) * a;
	const aimY = Math.sin(targetAngle) * aim - Math.sin(parentAngle) * a;
	const cos = Math.cos(parentRotation);
	const sin = Math.sin(parentRotation);
	const localX = (cos * aimX + sin * aimY) / scaleX;
	const localY = (cos * aimY - sin * aimX) / scaleY;

	// Each turn is wrapped into [-180, 180) so the blend takes the short way round.
	const parentTurn = parentRotation * RAD_TO_DEG - parent.appliedRotation;
	parent.appliedRotation += (parentTurn - 360 * Math.floor((parentTurn + 180) / 360)) * mix;
	if (Math.sqrt(localX * localX + localY * localY) > EPSILON && Math.abs(childLength) > EPSILON) {
		const childTurn = (Math.atan2(localY, localX) - Math.atan2(tipY, tipX)) * RAD_TO_DEG - child.appliedRotation;
		child.appliedRotation += (childTurn - 360 * Math.floor((childTurn + 180) / 360)) * mix;
	}
	if (stretch !== 1) {
		const scale = 1 + (stretch - 1) * mix;
		parent.appliedScaleX *= scale;
		if (constraint.data.uniform) {
			parent.appliedScaleY *= scale;
		}
	}
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Solving

/**
 * Makes a live IK constraint for a skeleton, with its keyable values from the data.
 *
 * @param data The constraint's setup data.
 * @param skeleton The skeleton whose bones it names.
 * @returns The constraint.
 */
export function createIkConstraint(data: IkConstraintData, skeleton: Skeleton): IkConstraint {
	const bones = data.bones.map((index) => {
		const bone = skeleton.bones[index];
		if (!bone) {
			throw new Error(`IK constraint ${data.name} names bone ${index}, which does not exist`);
		}
		return bone;
	});
	const target = skeleton.bones[data.target];
	if (!target) {
		throw new Error(`IK constraint ${data.name} names target ${data.target}, which does not exist`);
	}
	if (bones.length === 2 && bones[1]!.parent !== bones[0]) {
		throw new Error(`IK constraint ${data.name}: the second bone is not a direct child of the first`);
	}
	const constraint: IkConstraint = { data, bones, target, skeleton, mix: 0, softness: 0, bendDirection: 1, compress: false, stretch: false };
	setIkToSetupPose(constraint);
	return constraint;
}

/**
 * Resets a constraint's keyable values from its data.
 *
 * @param constraint The constraint to reset.
 */
export function setIkToSetupPose(constraint: IkConstraint): void {
	const data = constraint.data;
	constraint.mix = data.mix;
	constraint.softness = data.softness;
	constraint.bendDirection = data.bendDirection;
	constraint.compress = data.compress;
	constraint.stretch = data.stretch;
}

/**
 * Solves one IK constraint and writes the chain's applied rotation, and scale when compress or stretch applies, blended by the mix. The
 * chain's parent and the target must have up-to-date world transforms. The caller then recomputes the chain's world transforms.
 *
 * @param constraint The constraint to solve.
 */
export function solveIk(constraint: IkConstraint): void {
	if (constraint.mix === 0) {
		return;
	}
	const bones = constraint.bones;
	if (bones.length === 1) {
		solveOneBone(constraint, bones[0]!);
	} else {
		solveTwoBones(constraint, bones[0]!, bones[1]!);
	}
}
