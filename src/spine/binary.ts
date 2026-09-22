// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Skeleton reader

/**
 * Reads a Spine 3.8 `.skel` file: header, shared strings, bones, slots, constraints, skins, events and animations.
 *
 * Implements the "Format" section of Esoteric Software's public binary format page, adjusted where a staged 3.8 file disagrees with it.
 * See `SOURCES.md` for the page and `FORMAT-3.8.md` for the differences found in the staged corpus.
 */

import { ByteReader, SpineFormatError } from "./reader.js";
import type {
	Animation,
	Attachment,
	AttachmentType,
	BlendMode,
	BoneData,
	BoundingBoxAttachment,
	ClippingAttachment,
	Color,
	Curve,
	DrawOrderChange,
	EventData,
	EventKey,
	IkConstraintData,
	LinkedMeshAttachment,
	MeshAttachment,
	MeshVertices,
	PathAttachment,
	PathConstraintData,
	PathPositionMode,
	PathRotateMode,
	PathSpacingMode,
	PointAttachment,
	RegionAttachment,
	SkeletonData,
	Skin,
	SlotData,
	Timeline,
	TransformConstraintData,
	TransformMode
} from "./types.js";

/** `TransformMode` values in the byte order the format uses (`TRANSFORM_NORMAL` = 0, and so on). */
const TRANSFORM_MODES: TransformMode[] = ["normal", "onlyTranslation", "noRotationOrReflection", "noScale", "noScaleOrReflection"];

/** `BlendMode` values in the byte order the format uses (`BLEND_MODE_NORMAL` = 0, and so on). */
const BLEND_MODES: BlendMode[] = ["normal", "additive", "multiply", "screen"];

/** `PathPositionMode` values in the byte order the format uses (`PATH_POSITION_FIXED` = 0, and so on). */
const PATH_POSITION_MODES: PathPositionMode[] = ["fixed", "percent"];

/** `PathSpacingMode` values in the byte order the format uses (`PATH_SPACING_LENGTH` = 0, and so on). */
const PATH_SPACING_MODES: PathSpacingMode[] = ["length", "fixed", "percent"];

/** `PathRotateMode` values in the byte order the format uses (`PATH_ROTATE_TANGENT` = 0, and so on). */
const PATH_ROTATE_MODES: PathRotateMode[] = ["tangent", "chain", "chainScale"];

/** `AttachmentType` values in the byte order the format uses (`ATTACHMENT_REGION` = 0, and so on). */
const ATTACHMENT_TYPES: AttachmentType[] = ["region", "boundingbox", "mesh", "linkedmesh", "path", "point", "clipping"];

/** Curve kinds in the byte order the format uses (`CURVE_LINEAR` = 0, and so on). */
const CURVE_TYPES = ["linear", "stepped", "bezier"] as const;

/** Slot timeline kinds in the byte order the format uses (`SLOT_ATTACHMENT` = 0, and so on). */
const SLOT_TIMELINE_TYPES = ["attachment", "color", "twoColor"] as const;

/** Bone timeline kinds in the byte order the format uses (`BONE_ROTATE` = 0, and so on). */
const BONE_TIMELINE_TYPES = ["rotate", "translate", "scale", "shear"] as const;

/** Path constraint timeline kinds in the byte order the format uses (`PATH_POSITION` = 0, and so on). */
const PATH_TIMELINE_TYPES = ["pathPosition", "pathSpacing", "pathMix"] as const;

/**
 * Reads a whole Spine 3.8 skeleton binary. Throws `SpineFormatError` when the version is not 3.8, or when any byte is left over after the
 * last animation, since that means some field was misread.
 *
 * @param bytes The whole `.skel` file.
 * @returns The skeleton data.
 */
export function readSkeleton(bytes: Uint8Array): SkeletonData {
	const reader = new ByteReader(bytes);

	reader.string(); // hash, not kept
	const versionStart = reader.offset;
	const version = reader.string() ?? "";
	if (!version.startsWith("3.8.")) {
		throw new SpineFormatError(`Unsupported Spine version "${version}": only 3.8 is read`, versionStart);
	}
	const x = reader.float();
	const y = reader.float();
	const width = reader.float();
	const height = reader.float();
	const nonessential = reader.boolean();

	let fps: number | null = null;
	if (nonessential) {
		fps = reader.float();
		reader.string(); // images path, not kept
		reader.string(); // audio path, not kept
	}

	const stringCount = reader.varint(true);
	const strings: string[] = [];
	for (let i = 0; i < stringCount; i++) {
		strings.push(reader.string() ?? "");
	}
	reader.setStrings(strings);

	const bones = readBones(reader, nonessential);
	const slots = readSlots(reader);
	const ik = readIkConstraints(reader);
	const transform = readTransformConstraints(reader);
	const path = readPathConstraints(reader);
	const skins = readSkins(reader, nonessential);
	const events = readEvents(reader);
	const animations = readAnimations(reader);
	if (reader.offset !== reader.length) {
		throw new SpineFormatError(`${reader.length - reader.offset} byte(s) left after the last animation`, reader.offset);
	}

	return { version, x, y, width, height, fps, bones, slots, ik, transform, path, skins, events, animations };
}

/**
 * Looks up a byte-encoded constant in a values table ordered by the constant's byte value.
 *
 * @param reader The reader positioned to consume the constant byte.
 * @param values The values for this constant, indexed by its byte value.
 * @param label What this constant is, used in the error message when the byte is out of range.
 * @returns The matching value.
 */
function readConstant<T>(reader: ByteReader, values: readonly T[], label: string): T {
	const start = reader.offset;
	const index = reader.byte();
	const value = values[index];
	if (value === undefined) {
		throw new SpineFormatError(`Unknown ${label} constant ${index}`, start);
	}
	return value;
}

/**
 * Reads a color that is not gated by the nonessential flag: a plain int, where -1 (all bits set) means the color is absent.
 *
 * @param reader The reader positioned to consume the 4-byte int.
 * @returns The decoded color, or null when the int was -1.
 */
function readOptionalColor(reader: ByteReader): Color | null {
	const rgba = reader.int();
	if (rgba === -1) {
		return null;
	}
	return {
		r: ((rgba >>> 24) & 0xff) / 255,
		g: ((rgba >>> 16) & 0xff) / 255,
		b: ((rgba >>> 8) & 0xff) / 255,
		a: (rgba & 0xff) / 255
	};
}

/**
 * Reads the skeleton's bones. Each bone's parent index is below its own index, since the format guarantees parents come first.
 *
 * @param reader The reader positioned at the bone count.
 * @param nonessential Whether nonessential data was exported, gating each bone's color field.
 * @returns The bones, in file order.
 */
function readBones(reader: ByteReader, nonessential: boolean): BoneData[] {
	const count = reader.varint(true);
	const bones: BoneData[] = [];
	for (let i = 0; i < count; i++) {
		const name = reader.string() ?? "";
		const parentIndex = i === 0 ? null : reader.varint(true) - 1;
		const rotation = reader.float();
		const boneX = reader.float();
		const boneY = reader.float();
		const scaleX = reader.float();
		const scaleY = reader.float();
		const shearX = reader.float();
		const shearY = reader.float();
		const length = reader.float();
		const transformMode = readConstant(reader, TRANSFORM_MODES, "bone transform mode");
		const skinRequired = reader.boolean();
		const color = nonessential ? reader.color() : null;
		bones.push({ name, parentIndex, rotation, x: boneX, y: boneY, scaleX, scaleY, shearX, shearY, length, transformMode, skinRequired, color });
	}
	return bones;
}

/**
 * Reads the skeleton's slots.
 *
 * @param reader The reader positioned at the slot count.
 * @returns The slots, in draw order.
 */
function readSlots(reader: ByteReader): SlotData[] {
	const count = reader.varint(true);
	const slots: SlotData[] = [];
	for (let i = 0; i < count; i++) {
		const name = reader.string() ?? "";
		const boneIndex = reader.varint(true);
		const color = reader.color();
		const darkColor = readOptionalColor(reader);
		const attachmentName = reader.stringRef();
		const blendMode = readConstant(reader, BLEND_MODES, "slot blend mode");
		slots.push({ name, boneIndex, color, darkColor, attachmentName, blendMode });
	}
	return slots;
}

/**
 * Reads the skeleton's IK constraints.
 *
 * @param reader The reader positioned at the IK constraint count.
 * @returns The IK constraints, in file order.
 */
function readIkConstraints(reader: ByteReader): IkConstraintData[] {
	const count = reader.varint(true);
	const constraints: IkConstraintData[] = [];
	for (let i = 0; i < count; i++) {
		const name = reader.string() ?? "";
		const order = reader.varint(true);
		const skinRequired = reader.boolean();
		const boneCount = reader.varint(true);
		const bones: number[] = [];
		for (let b = 0; b < boneCount; b++) {
			bones.push(reader.varint(true));
		}
		const target = reader.varint(true);
		const mix = reader.float();
		const softness = reader.float();
		const bendDirection = reader.signedByte();
		const compress = reader.boolean();
		const stretch = reader.boolean();
		const uniform = reader.boolean();
		constraints.push({ name, order, skinRequired, bones, target, mix, softness, bendDirection, compress, stretch, uniform });
	}
	return constraints;
}

/**
 * Reads the skeleton's transform constraints.
 *
 * @param reader The reader positioned at the transform constraint count.
 * @returns The transform constraints, in file order.
 */
function readTransformConstraints(reader: ByteReader): TransformConstraintData[] {
	const count = reader.varint(true);
	const constraints: TransformConstraintData[] = [];
	for (let i = 0; i < count; i++) {
		const name = reader.string() ?? "";
		const order = reader.varint(true);
		const skinRequired = reader.boolean();
		const boneCount = reader.varint(true);
		const bones: number[] = [];
		for (let b = 0; b < boneCount; b++) {
			bones.push(reader.varint(true));
		}
		const target = reader.varint(true);
		const local = reader.boolean();
		const relative = reader.boolean();
		const offsetRotation = reader.float();
		const offsetX = reader.float();
		const offsetY = reader.float();
		const offsetScaleX = reader.float();
		const offsetScaleY = reader.float();
		const offsetShearY = reader.float();
		const rotateMix = reader.float();
		const translateMix = reader.float();
		const scaleMix = reader.float();
		const shearMix = reader.float();
		constraints.push({
			name,
			order,
			skinRequired,
			bones,
			target,
			local,
			relative,
			offsetRotation,
			offsetX,
			offsetY,
			offsetScaleX,
			offsetScaleY,
			offsetShearY,
			rotateMix,
			translateMix,
			scaleMix,
			shearMix
		});
	}
	return constraints;
}

/**
 * Reads the skeleton's path constraints.
 *
 * @param reader The reader positioned at the path constraint count.
 * @returns The path constraints, in file order.
 */
function readPathConstraints(reader: ByteReader): PathConstraintData[] {
	const count = reader.varint(true);
	const constraints: PathConstraintData[] = [];
	for (let i = 0; i < count; i++) {
		const name = reader.string() ?? "";
		const order = reader.varint(true);
		const skinRequired = reader.boolean();
		const boneCount = reader.varint(true);
		const bones: number[] = [];
		for (let b = 0; b < boneCount; b++) {
			bones.push(reader.varint(true));
		}
		const target = reader.varint(true);
		const positionMode = readConstant(reader, PATH_POSITION_MODES, "path position mode");
		const spacingMode = readConstant(reader, PATH_SPACING_MODES, "path spacing mode");
		const rotateMode = readConstant(reader, PATH_ROTATE_MODES, "path rotate mode");
		const offsetRotation = reader.float();
		const position = reader.float();
		const spacing = reader.float();
		const rotateMix = reader.float();
		const translateMix = reader.float();
		constraints.push({ name, order, skinRequired, bones, target, positionMode, spacingMode, rotateMode, offsetRotation, position, spacing, rotateMix, translateMix });
	}
	return constraints;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Skins and attachments

/**
 * Reads a mesh-shaped vertex list: either a plain position per vertex, or a bone-weighted influence list per vertex.
 *
 * The format's own page swaps the `weighted` true/false labels (see `FORMAT-3.8.md`). This reads it the way the staged 3.8 files actually
 * lay it out: `weighted = true` means every vertex carries a variable list of bone influences, `weighted = false` means a plain X, Y pair.
 *
 * @param reader The reader positioned at the `weighted` boolean.
 * @param vertexCount How many vertices this Vertices block holds.
 * @returns The decoded vertices, in the unweighted or the bone-weighted shape.
 */
function readVertices(reader: ByteReader, vertexCount: number): MeshVertices {
	const weighted = reader.boolean();
	if (weighted) {
		const bones: number[] = [];
		const values: number[] = [];
		for (let v = 0; v < vertexCount; v++) {
			const influenceCount = reader.varint(true);
			bones.push(influenceCount);
			for (let i = 0; i < influenceCount; i++) {
				bones.push(reader.varint(true));
				values.push(reader.float(), reader.float(), reader.float());
			}
		}
		return { weighted: true, bones: Int32Array.from(bones), values: Float32Array.from(values) };
	}
	const values: number[] = [];
	for (let v = 0; v < vertexCount; v++) {
		values.push(reader.float(), reader.float());
	}
	return { weighted: false, values: Float32Array.from(values) };
}

/**
 * Reads an `ATTACHMENT_REGION` attachment's fields.
 *
 * @param reader The reader positioned at the region path.
 * @param name The attachment's resolved name.
 * @returns The decoded region attachment.
 */
function readRegionAttachment(reader: ByteReader, name: string): RegionAttachment {
	const path = reader.stringRef();
	const rotation = reader.float();
	const x = reader.float();
	const y = reader.float();
	const scaleX = reader.float();
	const scaleY = reader.float();
	const width = reader.float();
	const height = reader.float();
	const color = reader.color();
	return { type: "region", name, path, rotation, x, y, scaleX, scaleY, width, height, color };
}

/**
 * Reads an `ATTACHMENT_BOUNDING_BOX` attachment's fields.
 *
 * @param reader The reader positioned at the vertex count.
 * @param name The attachment's resolved name.
 * @param nonessential Whether nonessential data was exported, gating the editor color field.
 * @returns The decoded bounding box attachment.
 */
function readBoundingBoxAttachment(reader: ByteReader, name: string, nonessential: boolean): BoundingBoxAttachment {
	const vertexCount = reader.varint(true);
	const vertices = readVertices(reader, vertexCount);
	const color = nonessential ? reader.color() : null;
	return { type: "boundingbox", name, vertices, color };
}

/**
 * Reads an `ATTACHMENT_MESH` attachment's fields.
 *
 * @param reader The reader positioned at the mesh path.
 * @param name The attachment's resolved name.
 * @param nonessential Whether nonessential data was exported, gating the edges, width and height fields.
 * @returns The decoded mesh attachment.
 */
function readMeshAttachment(reader: ByteReader, name: string, nonessential: boolean): MeshAttachment {
	const path = reader.stringRef();
	const color = reader.color();
	const uvCount = reader.varint(true);
	const uvs = new Float32Array(uvCount * 2);
	for (let i = 0; i < uvs.length; i++) {
		uvs[i] = reader.float();
	}
	const triangleCount = reader.varint(true);
	const triangles = new Uint16Array(triangleCount);
	for (let i = 0; i < triangleCount; i++) {
		triangles[i] = reader.short();
	}
	const vertices = readVertices(reader, uvCount);
	const hullCount = reader.varint(true);
	let edges: Uint16Array | null = null;
	let width: number | null = null;
	let height: number | null = null;
	if (nonessential) {
		const edgeCount = reader.varint(true);
		edges = new Uint16Array(edgeCount);
		for (let i = 0; i < edgeCount; i++) {
			edges[i] = reader.short();
		}
		width = reader.float();
		height = reader.float();
	}
	return { type: "mesh", name, path, color, uvs, triangles, vertices, hullCount, edges, width, height };
}

/**
 * Reads an `ATTACHMENT_LINKED_MESH` attachment's fields. The parent mesh is kept by name, and the consumer resolves it.
 *
 * @param reader The reader positioned at the mesh path.
 * @param name The attachment's resolved name.
 * @param nonessential Whether nonessential data was exported, gating the width and height fields.
 * @returns The decoded linked mesh attachment.
 */
function readLinkedMeshAttachment(reader: ByteReader, name: string, nonessential: boolean): LinkedMeshAttachment {
	const path = reader.stringRef();
	const color = reader.color();
	const parentSkin = reader.stringRef();
	const parentName = reader.stringRef() ?? "";
	const deform = reader.boolean();
	const width = nonessential ? reader.float() : null;
	const height = nonessential ? reader.float() : null;
	return { type: "linkedmesh", name, path, color, parentSkin, parentName, deform, width, height };
}

/**
 * Reads an `ATTACHMENT_PATH` attachment's fields.
 *
 * @param reader The reader positioned at the closed boolean.
 * @param name The attachment's resolved name.
 * @param nonessential Whether nonessential data was exported, gating the editor color field.
 * @returns The decoded path attachment.
 */
function readPathAttachment(reader: ByteReader, name: string, nonessential: boolean): PathAttachment {
	const closed = reader.boolean();
	const constantSpeed = reader.boolean();
	const vertexCount = reader.varint(true);
	const vertices = readVertices(reader, vertexCount);
	const lengths = new Float32Array(Math.floor(vertexCount / 3));
	for (let i = 0; i < lengths.length; i++) {
		lengths[i] = reader.float();
	}
	const color = nonessential ? reader.color() : null;
	return { type: "path", name, closed, constantSpeed, vertices, lengths, color };
}

/**
 * Reads an `ATTACHMENT_POINT` attachment's fields.
 *
 * @param reader The reader positioned at the rotation.
 * @param name The attachment's resolved name.
 * @param nonessential Whether nonessential data was exported, gating the editor color field.
 * @returns The decoded point attachment.
 */
function readPointAttachment(reader: ByteReader, name: string, nonessential: boolean): PointAttachment {
	const rotation = reader.float();
	const x = reader.float();
	const y = reader.float();
	const color = nonessential ? reader.color() : null;
	return { type: "point", name, rotation, x, y, color };
}

/**
 * Reads an `ATTACHMENT_CLIPPING` attachment's fields.
 *
 * The format's own page calls the end slot index a 4-byte int, but a staged 3.8 file has it as a varint+ (see `FORMAT-3.8.md`). This reads
 * it the way the staged files actually lay it out.
 *
 * @param reader The reader positioned at the end slot index.
 * @param name The attachment's resolved name.
 * @param nonessential Whether nonessential data was exported, gating the editor color field.
 * @returns The decoded clipping attachment.
 */
function readClippingAttachment(reader: ByteReader, name: string, nonessential: boolean): ClippingAttachment {
	const endSlotIndex = reader.varint(true);
	const vertexCount = reader.varint(true);
	const vertices = readVertices(reader, vertexCount);
	const color = nonessential ? reader.color() : null;
	return { type: "clipping", name, endSlotIndex, vertices, color };
}

/**
 * Reads one attachment: its own name, its type constant, then the type-specific fields.
 *
 * @param reader The reader positioned at the attachment's own name.
 * @param placeholderName The name this attachment is stored under in the skin, used when the attachment's own name is null.
 * @param nonessential Whether nonessential data was exported.
 * @returns The decoded attachment.
 */
function readAttachment(reader: ByteReader, placeholderName: string, nonessential: boolean): Attachment {
	const name = reader.stringRef() ?? placeholderName;
	const type = readConstant(reader, ATTACHMENT_TYPES, "attachment type");
	switch (type) {
		case "region":
			return readRegionAttachment(reader, name);
		case "boundingbox":
			return readBoundingBoxAttachment(reader, name, nonessential);
		case "mesh":
			return readMeshAttachment(reader, name, nonessential);
		case "linkedmesh":
			return readLinkedMeshAttachment(reader, name, nonessential);
		case "path":
			return readPathAttachment(reader, name, nonessential);
		case "point":
			return readPointAttachment(reader, name, nonessential);
		case "clipping":
			return readClippingAttachment(reader, name, nonessential);
	}
}

/**
 * Reads one skin's attachment data: the "Skin format" section, shared by the default skin and every named skin.
 *
 * @param reader The reader positioned at the skin's slot count.
 * @param name The skin's name, or `"default"` for the default skin.
 * @param nonessential Whether nonessential data was exported.
 * @returns The decoded skin.
 */
function readSkinFormat(reader: ByteReader, name: string, nonessential: boolean): Skin {
	const attachments = new Map<number, Map<string, Attachment>>();
	const slotCount = reader.varint(true);
	for (let s = 0; s < slotCount; s++) {
		const slotIndex = reader.varint(true);
		const attachmentCount = reader.varint(true);
		const slotAttachments = new Map<string, Attachment>();
		for (let a = 0; a < attachmentCount; a++) {
			const placeholderName = reader.stringRef() ?? "";
			slotAttachments.set(placeholderName, readAttachment(reader, placeholderName, nonessential));
		}
		attachments.set(slotIndex, slotAttachments);
	}
	return { name, attachments };
}

/**
 * Reads the skeleton's skins: the default skin, then every named skin. A named skin's own bone, IK, transform and path constraint index
 * lists are read to stay in sync with the byte stream but not kept, since nothing uses them yet.
 *
 * @param reader The reader positioned at the default skin's slot count.
 * @param nonessential Whether nonessential data was exported.
 * @returns The skins, default skin first.
 */
function readSkins(reader: ByteReader, nonessential: boolean): Skin[] {
	const skins: Skin[] = [readSkinFormat(reader, "default", nonessential)];
	const skinCount = reader.varint(true);
	for (let i = 0; i < skinCount; i++) {
		const name = reader.stringRef() ?? "";
		const boneCount = reader.varint(true);
		for (let b = 0; b < boneCount; b++) {
			reader.varint(true); // bone index, not kept
		}
		const ikCount = reader.varint(true);
		for (let k = 0; k < ikCount; k++) {
			reader.varint(true); // ik constraint index, not kept
		}
		const transformCount = reader.varint(true);
		for (let t = 0; t < transformCount; t++) {
			reader.varint(true); // transform constraint index, not kept
		}
		const pathCount = reader.varint(true);
		for (let p = 0; p < pathCount; p++) {
			reader.varint(true); // path constraint index, not kept
		}
		skins.push(readSkinFormat(reader, name, nonessential));
	}
	return skins;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Events

/**
 * Reads the skeleton's custom event definitions.
 *
 * The format's own page has each event carry a volume and a balance float after the audio path, for the 4.x audio mixer. Every event in
 * the staged 3.8 corpus has a null audio path and no volume/balance bytes follow (see `FORMAT-3.8.md`), so this stops right after the
 * audio path for that case. Whether volume/balance follow a non-null audio path in 3.8 is unproven, since no staged event has one, so an
 * event with a non-null audio path throws rather than guess.
 *
 * @param reader The reader positioned at the event count.
 * @returns The event definitions, in file order.
 */
function readEvents(reader: ByteReader): EventData[] {
	const count = reader.varint(true);
	const events: EventData[] = [];
	for (let i = 0; i < count; i++) {
		const name = reader.stringRef() ?? "";
		const intValue = reader.varint(false);
		const floatValue = reader.float();
		const stringValue = reader.string();
		const audioStart = reader.offset;
		const audioPath = reader.string();
		if (audioPath !== null) {
			throw new SpineFormatError(`Event "${name}" has an audio path: reading volume/balance after a non-null audio path is unsupported`, audioStart);
		}
		events.push({ name, intValue, floatValue, stringValue, audioPath });
	}
	return events;
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Animations

/**
 * Reads a boolean byte that must be exactly 0 or 1. Any other value means the reader has lost its place, so it throws.
 *
 * @param reader The reader positioned at the boolean byte.
 * @param label What this flag is, used in the error message.
 * @returns The flag's value.
 */
function readFlag(reader: ByteReader, label: string): boolean {
	const start = reader.offset;
	const value = reader.byte();
	if (value > 1) {
		throw new SpineFormatError(`${label} byte is ${value}, not 0 or 1`, start);
	}
	return value === 1;
}

/**
 * Reads one keyframe's curve: a `CURVE_*` constant, then 4 control point floats for a Bezier.
 *
 * @param reader The reader positioned at the curve type byte.
 * @returns The decoded curve.
 */
function readCurve(reader: ByteReader): Curve {
	const type = readConstant(reader, CURVE_TYPES, "curve type");
	if (type === "bezier") {
		return { bezier: [reader.float(), reader.float(), reader.float(), reader.float()] };
	}
	return type;
}

/**
 * Reads the curve after a keyframe, which the format omits for the last keyframe.
 *
 * @param reader The reader positioned just after the keyframe's values.
 * @param frame Index of the keyframe just read.
 * @param frameCount How many keyframes the timeline has.
 * @param curves The timeline's curve list, appended to in place.
 */
function readCurveAfter(reader: ByteReader, frame: number, frameCount: number, curves: Curve[]): void {
	if (frame < frameCount - 1) {
		curves.push(readCurve(reader));
	}
}

/**
 * Reads an animation's slot timelines: attachment, color and two-color.
 *
 * @param reader The reader positioned at the slot count.
 * @param timelines The animation's timeline list, appended to in place.
 */
function readSlotTimelines(reader: ByteReader, timelines: Timeline[]): void {
	const slotCount = reader.varint(true);
	for (let s = 0; s < slotCount; s++) {
		const slotIndex = reader.varint(true);
		const timelineCount = reader.varint(true);
		for (let t = 0; t < timelineCount; t++) {
			const type = readConstant(reader, SLOT_TIMELINE_TYPES, "slot timeline type");
			const frameCount = reader.varint(true);
			const times: number[] = [];
			const curves: Curve[] = [];
			if (type === "attachment") {
				const names: (string | null)[] = [];
				for (let f = 0; f < frameCount; f++) {
					times.push(reader.float());
					names.push(reader.stringRef());
				}
				timelines.push({ type, slotIndex, times, names });
			} else if (type === "color") {
				const colors: Color[] = [];
				for (let f = 0; f < frameCount; f++) {
					times.push(reader.float());
					colors.push(reader.color());
					readCurveAfter(reader, f, frameCount, curves);
				}
				timelines.push({ type, slotIndex, times, colors, curves });
			} else {
				const lights: Color[] = [];
				const darks: Color[] = [];
				for (let f = 0; f < frameCount; f++) {
					times.push(reader.float());
					lights.push(reader.color());
					darks.push(reader.color());
					readCurveAfter(reader, f, frameCount, curves);
				}
				timelines.push({ type, slotIndex, times, lights, darks, curves });
			}
		}
	}
}

/**
 * Reads an animation's bone timelines: rotate, translate, scale and shear.
 *
 * @param reader The reader positioned at the bone count.
 * @param timelines The animation's timeline list, appended to in place.
 */
function readBoneTimelines(reader: ByteReader, timelines: Timeline[]): void {
	const boneCount = reader.varint(true);
	for (let b = 0; b < boneCount; b++) {
		const boneIndex = reader.varint(true);
		const timelineCount = reader.varint(true);
		for (let t = 0; t < timelineCount; t++) {
			const type = readConstant(reader, BONE_TIMELINE_TYPES, "bone timeline type");
			const frameCount = reader.varint(true);
			const times: number[] = [];
			const curves: Curve[] = [];
			if (type === "rotate") {
				const angles: number[] = [];
				for (let f = 0; f < frameCount; f++) {
					times.push(reader.float());
					angles.push(reader.float());
					readCurveAfter(reader, f, frameCount, curves);
				}
				timelines.push({ type, boneIndex, times, angles, curves });
			} else {
				const x: number[] = [];
				const y: number[] = [];
				for (let f = 0; f < frameCount; f++) {
					times.push(reader.float());
					x.push(reader.float());
					y.push(reader.float());
					readCurveAfter(reader, f, frameCount, curves);
				}
				timelines.push({ type, boneIndex, times, x, y, curves });
			}
		}
	}
}

/**
 * Reads an animation's IK constraint timelines. A 3.8 keyframe carries mix, softness, bend direction, compress and stretch, not just the
 * mix and bend direction the page lists (see `FORMAT-3.8.md`).
 *
 * @param reader The reader positioned at the IK constraint timeline count.
 * @param timelines The animation's timeline list, appended to in place.
 */
function readIkTimelines(reader: ByteReader, timelines: Timeline[]): void {
	const count = reader.varint(true);
	for (let i = 0; i < count; i++) {
		const constraintIndex = reader.varint(true);
		const frameCount = reader.varint(true);
		const times: number[] = [];
		const mixes: number[] = [];
		const softness: number[] = [];
		const bendDirections: number[] = [];
		const compress: boolean[] = [];
		const stretch: boolean[] = [];
		const curves: Curve[] = [];
		for (let f = 0; f < frameCount; f++) {
			times.push(reader.float());
			mixes.push(reader.float());
			softness.push(reader.float());
			bendDirections.push(reader.signedByte());
			compress.push(readFlag(reader, "IK keyframe compress"));
			stretch.push(readFlag(reader, "IK keyframe stretch"));
			readCurveAfter(reader, f, frameCount, curves);
		}
		timelines.push({ type: "ik", constraintIndex, times, mixes, softness, bendDirections, compress, stretch, curves });
	}
}

/**
 * Reads an animation's transform constraint timelines. Each keyframe but the last carries a curve, which the page leaves out here.
 *
 * @param reader The reader positioned at the transform constraint timeline count.
 * @param timelines The animation's timeline list, appended to in place.
 */
function readTransformTimelines(reader: ByteReader, timelines: Timeline[]): void {
	const count = reader.varint(true);
	for (let i = 0; i < count; i++) {
		const constraintIndex = reader.varint(true);
		const frameCount = reader.varint(true);
		const times: number[] = [];
		const rotateMixes: number[] = [];
		const translateMixes: number[] = [];
		const scaleMixes: number[] = [];
		const shearMixes: number[] = [];
		const curves: Curve[] = [];
		for (let f = 0; f < frameCount; f++) {
			times.push(reader.float());
			rotateMixes.push(reader.float());
			translateMixes.push(reader.float());
			scaleMixes.push(reader.float());
			shearMixes.push(reader.float());
			readCurveAfter(reader, f, frameCount, curves);
		}
		timelines.push({ type: "transform", constraintIndex, times, rotateMixes, translateMixes, scaleMixes, shearMixes, curves });
	}
}

/**
 * Reads an animation's path constraint timelines: position, spacing and mix.
 *
 * @param reader The reader positioned at the path constraint entry count.
 * @param timelines The animation's timeline list, appended to in place.
 */
function readPathTimelines(reader: ByteReader, timelines: Timeline[]): void {
	const count = reader.varint(true);
	for (let i = 0; i < count; i++) {
		const constraintIndex = reader.varint(true);
		const timelineCount = reader.varint(true);
		for (let t = 0; t < timelineCount; t++) {
			const type = readConstant(reader, PATH_TIMELINE_TYPES, "path timeline type");
			const frameCount = reader.varint(true);
			const times: number[] = [];
			const curves: Curve[] = [];
			if (type === "pathMix") {
				const rotateMixes: number[] = [];
				const translateMixes: number[] = [];
				for (let f = 0; f < frameCount; f++) {
					times.push(reader.float());
					rotateMixes.push(reader.float());
					translateMixes.push(reader.float());
					readCurveAfter(reader, f, frameCount, curves);
				}
				timelines.push({ type, constraintIndex, times, rotateMixes, translateMixes, curves });
			} else {
				const values: number[] = [];
				for (let f = 0; f < frameCount; f++) {
					times.push(reader.float());
					values.push(reader.float());
					readCurveAfter(reader, f, frameCount, curves);
				}
				timelines.push({ type, constraintIndex, times, values, curves });
			}
		}
	}
}

/**
 * Reads an animation's deform timelines, grouped by skin and then by slot.
 *
 * The page calls a keyframe's first varint the "end vertex", but in 3.8 it is the number of floats stored, followed by the index of the
 * first one (see `FORMAT-3.8.md`). A count of 0 means the keyframe is all zero and nothing else follows.
 *
 * @param reader The reader positioned at the skin count.
 * @param timelines The animation's timeline list, appended to in place.
 */
function readDeformTimelines(reader: ByteReader, timelines: Timeline[]): void {
	const skinCount = reader.varint(true);
	for (let k = 0; k < skinCount; k++) {
		const skinIndex = reader.varint(true);
		const slotCount = reader.varint(true);
		for (let s = 0; s < slotCount; s++) {
			const slotIndex = reader.varint(true);
			const timelineCount = reader.varint(true);
			for (let t = 0; t < timelineCount; t++) {
				const attachmentName = reader.stringRef() ?? "";
				const frameCount = reader.varint(true);
				const times: number[] = [];
				const starts: number[] = [];
				const values: number[][] = [];
				const curves: Curve[] = [];
				for (let f = 0; f < frameCount; f++) {
					times.push(reader.float());
					const valueCount = reader.varint(true);
					const start = valueCount === 0 ? 0 : reader.varint(true);
					const frameValues: number[] = [];
					for (let v = 0; v < valueCount; v++) {
						frameValues.push(reader.float());
					}
					starts.push(start);
					values.push(frameValues);
					readCurveAfter(reader, f, frameCount, curves);
				}
				timelines.push({ type: "deform", skinIndex, slotIndex, attachmentName, times, starts, values, curves });
			}
		}
	}
}

/**
 * Reads an animation's draw order keyframes. Each change's offset is a varint+, so a changed slot only ever moves later in the draw order.
 *
 * @param reader The reader positioned at the draw order keyframe count.
 * @param timelines The animation's timeline list, appended to in place when there is at least one keyframe.
 */
function readDrawOrderTimeline(reader: ByteReader, timelines: Timeline[]): void {
	const frameCount = reader.varint(true);
	if (frameCount === 0) {
		return;
	}
	const times: number[] = [];
	const changes: DrawOrderChange[][] = [];
	for (let f = 0; f < frameCount; f++) {
		times.push(reader.float());
		const changeCount = reader.varint(true);
		const frameChanges: DrawOrderChange[] = [];
		for (let c = 0; c < changeCount; c++) {
			const slotIndex = reader.varint(true);
			const offset = reader.varint(true);
			frameChanges.push({ slotIndex, offset });
		}
		changes.push(frameChanges);
	}
	timelines.push({ type: "drawOrder", times, changes });
}

/**
 * Reads an animation's event keyframes. A 3.8 keyframe carries no volume or balance floats after the string, unlike the page. That is
 * proven only for events without audio, and `readEvents` already throws on an event with audio (see `FORMAT-3.8.md`).
 *
 * @param reader The reader positioned at the event keyframe count.
 * @param timelines The animation's timeline list, appended to in place when there is at least one keyframe.
 */
function readEventTimeline(reader: ByteReader, timelines: Timeline[]): void {
	const frameCount = reader.varint(true);
	if (frameCount === 0) {
		return;
	}
	const times: number[] = [];
	const events: EventKey[] = [];
	for (let f = 0; f < frameCount; f++) {
		times.push(reader.float());
		const eventIndex = reader.varint(true);
		const intValue = reader.varint(false);
		const floatValue = reader.float();
		const stringValue = readFlag(reader, "Event keyframe has-string") ? reader.string() : null;
		events.push({ eventIndex, intValue, floatValue, stringValue });
	}
	timelines.push({ type: "event", times, events });
}

/**
 * Reads one animation. The page leaves out the name, which 3.8 stores as an inline string first, and no duration is stored at all.
 *
 * @param reader The reader positioned at the animation's name.
 * @returns The decoded animation, with `duration` set to its latest keyframe time.
 */
function readAnimation(reader: ByteReader): Animation {
	const name = reader.string() ?? "";
	const timelines: Timeline[] = [];
	readSlotTimelines(reader, timelines);
	readBoneTimelines(reader, timelines);
	readIkTimelines(reader, timelines);
	readTransformTimelines(reader, timelines);
	readPathTimelines(reader, timelines);
	readDeformTimelines(reader, timelines);
	readDrawOrderTimeline(reader, timelines);
	readEventTimeline(reader, timelines);

	// Some upstream timelines have key times that go back down, so the duration is the largest time, not the last one.
	let duration = 0;
	for (const timeline of timelines) {
		for (const time of timeline.times) {
			duration = Math.max(duration, time);
		}
	}
	return { name, duration, timelines };
}

/**
 * Reads the skeleton's animations, the last section of the file.
 *
 * @param reader The reader positioned at the animation count.
 * @returns The animations, in file order.
 */
function readAnimations(reader: ByteReader): Animation[] {
	const count = reader.varint(true);
	const animations: Animation[] = [];
	for (let i = 0; i < count; i++) {
		animations.push(readAnimation(reader));
	}
	return animations;
}
