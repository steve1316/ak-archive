// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Constraints

/**
 * IK constraints: turning one bone to point at a target, or two bones so the child's tip reaches it. Transform constraints: moving bones
 * toward a target bone's rotation, position, scale and shear. Every solve writes the bones' applied values, never the local values
 * animation writes. `MATH.md` ("IK constraints" and "Transform constraints") derives each step and names the corpus evidence behind it.
 */

import type { Bone, Skeleton } from "./skeleton.js";
import type { IkConstraintData, TransformConstraintData } from "./types.js";

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

/** A live transform constraint: its setup data, the bones it drives and the mixes timelines can key, reset from the data by `setToSetupPose`. */
export interface TransformConstraint {
	/** The constraint's setup data. */
	data: TransformConstraintData;
	/** The constrained bones, in skeleton order so a parent is solved before its child. */
	bones: Bone[];
	/** The bone whose transform the constrained bones move toward. */
	target: Bone;
	/** Current rotation influence, from 0 (no effect) to 1 (only the constraint). */
	rotateMix: number;
	/** Current translation influence. */
	translateMix: number;
	/** Current scale influence. */
	scaleMix: number;
	/** Current shear influence. */
	shearMix: number;
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

/** A full turn in radians. */
const TURN = 2 * Math.PI;

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

/**
 * Makes a live transform constraint for a skeleton, with its mixes from the data. The bones are kept in skeleton order, so a constrained
 * parent is solved before a constrained child and the child's applied values are taken against its parent's new world transform.
 *
 * @param data The constraint's setup data.
 * @param skeleton The skeleton whose bones it names.
 * @returns The constraint.
 */
export function createTransformConstraint(data: TransformConstraintData, skeleton: Skeleton): TransformConstraint {
	const bones = [...data.bones]
		.sort((first, second) => first - second)
		.map((index) => {
			const bone = skeleton.bones[index];
			if (!bone) {
				throw new Error(`Transform constraint ${data.name} names bone ${index}, which does not exist`);
			}
			return bone;
		});
	const target = skeleton.bones[data.target];
	if (!target) {
		throw new Error(`Transform constraint ${data.name} names target ${data.target}, which does not exist`);
	}
	const constraint: TransformConstraint = { data, bones, target, rotateMix: 0, translateMix: 0, scaleMix: 0, shearMix: 0 };
	setTransformToSetupPose(constraint);
	return constraint;
}

/**
 * Resets a transform constraint's mixes from its data.
 *
 * @param constraint The constraint to reset.
 */
export function setTransformToSetupPose(constraint: TransformConstraint): void {
	const data = constraint.data;
	constraint.rotateMix = data.rotateMix;
	constraint.translateMix = data.translateMix;
	constraint.scaleMix = data.scaleMix;
	constraint.shearMix = data.shearMix;
}

/**
 * Solves one transform constraint. The target's world transform, and each constrained bone's parent, must be up to date. The caller then
 * recomputes the constrained bones and their descendants from their applied values. Relative constraints are left unsolved: the corpus
 * has none, so no reading of them could be checked.
 *
 * @param constraint The constraint to solve.
 * @param skeleton The skeleton the bones belong to.
 */
export function solveTransform(constraint: TransformConstraint, skeleton: Skeleton): void {
	const data = constraint.data;
	if (data.relative) {
		return;
	}
	if (data.local) {
		solveLocal(constraint);
	} else {
		solveWorld(constraint, skeleton);
	}
}

/**
 * Moves each constrained bone's world transform toward the target's, channel by channel, then writes applied values that reproduce it.
 * Rotation turns both world axes by the gap between the X axis angles plus the offset. Translation moves the origin toward the target's
 * local point `(offsetX, offsetY)`. Scale moves each axis length toward the target's plus the offset. Shear turns the Y axis so its angle
 * from the X axis moves toward the target's plus the offset. A reflected target flips the sign of the rotate and shear offsets, so a
 * skeleton flip mirrors the result. Angle gaps are wrapped into (-180, 180], so each blend takes the short way round.
 *
 * @param constraint The constraint, not local and not relative.
 * @param skeleton The skeleton the bones belong to.
 */
function solveWorld(constraint: TransformConstraint, skeleton: Skeleton): void {
	const data = constraint.data;
	const target = constraint.target;
	const rotateMix = constraint.rotateMix;
	const translateMix = constraint.translateMix;
	const scaleMix = constraint.scaleMix;
	const shearMix = constraint.shearMix;
	const ta = target.a;
	const tb = target.b;
	const tc = target.c;
	const td = target.d;
	const offsetSign = ta * td - tb * tc < 0 ? -1 : 1;
	const offsetRotation = data.offsetRotation * DEG_TO_RAD * offsetSign;
	const offsetShearY = data.offsetShearY * DEG_TO_RAD * offsetSign;
	const targetAngle = Math.atan2(tc, ta);
	const bones = constraint.bones;
	for (let i = 0; i < bones.length; i++) {
		const bone = bones[i]!;
		let changed = false;
		if (rotateMix !== 0) {
			let turn = targetAngle - Math.atan2(bone.c, bone.a) + offsetRotation;
			turn = (turn - TURN * Math.ceil((turn - Math.PI) / TURN)) * rotateMix;
			const cos = Math.cos(turn);
			const sin = Math.sin(turn);
			const a = bone.a;
			const b = bone.b;
			const c = bone.c;
			const d = bone.d;
			bone.a = cos * a - sin * c;
			bone.b = cos * b - sin * d;
			bone.c = sin * a + cos * c;
			bone.d = sin * b + cos * d;
			changed = true;
		}
		if (translateMix !== 0) {
			const pointX = ta * data.offsetX + tb * data.offsetY + target.worldX;
			const pointY = tc * data.offsetX + td * data.offsetY + target.worldY;
			bone.worldX += (pointX - bone.worldX) * translateMix;
			bone.worldY += (pointY - bone.worldY) * translateMix;
			changed = true;
		}
		if (scaleMix !== 0) {
			// A zero-length axis has no direction to scale along, so it stays as it is.
			const lengthX = Math.sqrt(bone.a * bone.a + bone.c * bone.c);
			if (lengthX > EPSILON) {
				const factor = (lengthX + (Math.sqrt(ta * ta + tc * tc) + data.offsetScaleX - lengthX) * scaleMix) / lengthX;
				bone.a *= factor;
				bone.c *= factor;
			}
			const lengthY = Math.sqrt(bone.b * bone.b + bone.d * bone.d);
			if (lengthY > EPSILON) {
				const factor = (lengthY + (Math.sqrt(tb * tb + td * td) + data.offsetScaleY - lengthY) * scaleMix) / lengthY;
				bone.b *= factor;
				bone.d *= factor;
			}
			changed = true;
		}
		if (shearMix !== 0) {
			const yAngle = Math.atan2(bone.d, bone.b);
			let turn = Math.atan2(td, tb) - targetAngle - (yAngle - Math.atan2(bone.c, bone.a)) + offsetShearY;
			turn = (turn - TURN * Math.ceil((turn - Math.PI) / TURN)) * shearMix;
			const lengthY = Math.sqrt(bone.b * bone.b + bone.d * bone.d);
			bone.b = Math.cos(yAngle + turn) * lengthY;
			bone.d = Math.sin(yAngle + turn) * lengthY;
			changed = true;
		}
		if (changed) {
			setAppliedFromWorld(bone, skeleton);
		}
	}
}

/**
 * Moves each constrained bone's applied local values toward the target's applied values plus the offsets: rotation the short way round,
 * x and y, scale X and Y, and shear Y. Offsets never flip here, since local values do not see a skeleton flip.
 *
 * @param constraint The constraint, local and not relative.
 */
function solveLocal(constraint: TransformConstraint): void {
	const data = constraint.data;
	const target = constraint.target;
	const rotateMix = constraint.rotateMix;
	const translateMix = constraint.translateMix;
	const scaleMix = constraint.scaleMix;
	const shearMix = constraint.shearMix;
	const bones = constraint.bones;
	for (let i = 0; i < bones.length; i++) {
		const bone = bones[i]!;
		if (rotateMix !== 0) {
			const turn = target.appliedRotation + data.offsetRotation - bone.appliedRotation;
			bone.appliedRotation += (turn - 360 * Math.ceil((turn - 180) / 360)) * rotateMix;
		}
		if (translateMix !== 0) {
			bone.appliedX += (target.appliedX + data.offsetX - bone.appliedX) * translateMix;
			bone.appliedY += (target.appliedY + data.offsetY - bone.appliedY) * translateMix;
		}
		if (scaleMix !== 0) {
			bone.appliedScaleX += (target.appliedScaleX + data.offsetScaleX - bone.appliedScaleX) * scaleMix;
			bone.appliedScaleY += (target.appliedScaleY + data.offsetScaleY - bone.appliedScaleY) * scaleMix;
		}
		if (shearMix !== 0) {
			const turn = target.appliedShearY + data.offsetShearY - bone.appliedShearY;
			bone.appliedShearY += (turn - 360 * Math.ceil((turn - 180) / 360)) * shearMix;
		}
	}
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Applied values from a world transform

/**
 * Writes a bone's applied values so that `updateBone` reproduces its current world transform: `a`, `b`, `c`, `d`, `worldX` and `worldY`.
 * It inverts `updateBone` for each transform mode, dividing the skeleton's scale out where `updateBone` multiplies it back in. The
 * position is the parent's inverse world basis applied to the offset from the parent's origin. The local basis `L` is then:
 * `normal` `P^-1 W`, `onlyTranslation` `W`, `noRotationOrReflection` `diag(lengthX, lengthY)^-1 W`, and for the `noScale` modes each
 * world column mapped back through `P^-1`, cut to the column's own length. `L` is split into rotation, scale X, a signed scale Y and shear
 * Y, with shear X 0. A parent basis with no inverse, a zero skeleton scale or a zero-length parent axis leaves the applied values as they are.
 *
 * @param bone The bone, with its world transform set and its parent's up to date.
 * @param skeleton The skeleton the bone belongs to.
 */
export function setAppliedFromWorld(bone: Bone, skeleton: Skeleton): void {
	const parent = bone.parent;
	const skeletonScaleX = skeleton.scaleX;
	const skeletonScaleY = skeleton.scaleY;
	const parentA = parent ? parent.a : skeletonScaleX;
	const parentB = parent ? parent.b : 0;
	const parentC = parent ? parent.c : 0;
	const parentD = parent ? parent.d : skeletonScaleY;
	const determinant = parentA * parentD - parentB * parentC;
	if (Math.abs(determinant) < EPSILON) {
		return;
	}
	const mode = bone.data.transformMode;
	if (mode !== "normal" && (skeletonScaleX === 0 || skeletonScaleY === 0)) {
		return;
	}
	// The other modes work on the world and parent bases with the skeleton's scale taken off, as `updateBone` does.
	const inverseX = mode === "normal" ? 1 : 1 / skeletonScaleX;
	const inverseY = mode === "normal" ? 1 : 1 / skeletonScaleY;
	const wa = bone.a * inverseX;
	const wb = bone.b * inverseX;
	const wc = bone.c * inverseY;
	const wd = bone.d * inverseY;
	const pa = parentA * inverseX;
	const pb = parentB * inverseX;
	const pc = parentC * inverseY;
	const pd = parentD * inverseY;
	let la = wa;
	let lb = wb;
	let lc = wc;
	let ld = wd;
	if (mode === "normal" || mode === "noScale" || mode === "noScaleOrReflection") {
		const inner = pa * pd - pb * pc;
		if (Math.abs(inner) < EPSILON) {
			return;
		}
		la = (pd * wa - pb * wc) / inner;
		lc = (pa * wc - pc * wa) / inner;
		lb = (pd * wb - pb * wd) / inner;
		ld = (pa * wd - pc * wb) / inner;
		if (mode !== "normal") {
			// `updateBone` keeps only each column's direction through the parent, so the local axis is that direction at the world length.
			// `noScaleOrReflection` negates the Y column under a reflected parent, so the local Y axis is negated to match.
			const worldX = Math.sqrt(wa * wa + wc * wc);
			const mappedX = Math.sqrt(la * la + lc * lc);
			const scaleX = mappedX > EPSILON ? worldX / mappedX : 0;
			la *= scaleX;
			lc *= scaleX;
			const worldY = Math.sqrt(wb * wb + wd * wd);
			const mappedY = Math.sqrt(lb * lb + ld * ld);
			const scaleY = (mappedY > EPSILON ? worldY / mappedY : 0) * (mode === "noScaleOrReflection" && inner < 0 ? -1 : 1);
			lb *= scaleY;
			ld *= scaleY;
		}
	} else if (mode === "noRotationOrReflection") {
		const lengthX = Math.sqrt(pa * pa + pc * pc);
		const lengthY = Math.sqrt(pb * pb + pd * pd);
		if (lengthX < EPSILON || lengthY < EPSILON) {
			return;
		}
		la = wa / lengthX;
		lb = wb / lengthX;
		lc = wc / lengthY;
		ld = wd / lengthY;
	}

	const dx = bone.worldX - (parent ? parent.worldX : skeleton.x);
	const dy = bone.worldY - (parent ? parent.worldY : skeleton.y);
	bone.appliedX = (parentD * dx - parentB * dy) / determinant;
	bone.appliedY = (parentA * dy - parentC * dx) / determinant;
	// Split `L`: the X axis gives rotation and scale X. The Y axis gives a scale Y signed by the basis's reflection, and its angle beyond
	// rotation + 90 is the shear Y.
	const rotation = Math.atan2(lc, la);
	const flip = la * ld - lb * lc < 0 ? -1 : 1;
	const shear = Math.atan2(ld * flip, lb * flip) - rotation - Math.PI / 2;
	bone.appliedRotation = rotation * RAD_TO_DEG;
	bone.appliedScaleX = Math.sqrt(la * la + lc * lc);
	bone.appliedScaleY = Math.sqrt(lb * lb + ld * ld) * flip;
	bone.appliedShearX = 0;
	bone.appliedShearY = (shear - TURN * Math.ceil((shear - Math.PI) / TURN)) * RAD_TO_DEG;
}
