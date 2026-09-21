// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Skeleton types

/**
 * Types for the data a Spine 3.8 `.skel` file carries. Field names and shapes come from Esoteric Software's public binary format page's
 * "Format" section, adjusted where a staged 3.8 file disagrees with it. See `SOURCES.md` for the page and `FORMAT-3.8.md` for the
 * differences found in the staged corpus.
 */

import type { Color } from "./reader.js";

/** How a bone inherits its parent's transform. Byte order in the format is `normal`, `onlyTranslation`, `noRotationOrReflection`, `noScale`, `noScaleOrReflection`. */
export type TransformMode = "normal" | "onlyTranslation" | "noRotationOrReflection" | "noScale" | "noScaleOrReflection";

/** How a slot's attachment is blended when drawn. Byte order in the format is `normal`, `additive`, `multiply`, `screen`. */
export type BlendMode = "normal" | "additive" | "multiply" | "screen";

/** How a path constraint's position value is interpreted. Byte order in the format is `fixed`, `percent`. */
export type PathPositionMode = "fixed" | "percent";

/** How a path constraint's spacing value is interpreted. Byte order in the format is `length`, `fixed`, `percent`. */
export type PathSpacingMode = "length" | "fixed" | "percent";

/** How a path constraint calculates bone rotation. Byte order in the format is `tangent`, `chain`, `chainScale`. */
export type PathRotateMode = "tangent" | "chain" | "chainScale";

/** One bone in the skeleton's setup pose. */
export interface BoneData {
	/** The bone's name, unique within the skeleton. */
	name: string;
	/** Index of the parent bone, or null for the root bone. */
	parentIndex: number | null;
	/** Setup-pose rotation in degrees, relative to the parent. */
	rotation: number;
	/** Setup-pose X position relative to the parent. */
	x: number;
	/** Setup-pose Y position relative to the parent. */
	y: number;
	/** Setup-pose X scale. */
	scaleX: number;
	/** Setup-pose Y scale. */
	scaleY: number;
	/** Setup-pose X shear. */
	shearX: number;
	/** Setup-pose Y shear. */
	shearY: number;
	/** Bone length. Only used at runtime for two bone IK and debug drawing. */
	length: number;
	/** How this bone inherits its parent's transform. */
	transformMode: TransformMode;
	/** True if this bone is only active when the active skin includes it. */
	skinRequired: boolean;
	/** The bone's editor color, or null when nonessential data was not exported. */
	color: Color | null;
}

/** One slot in the skeleton, attached to a bone and holding an attachment. */
export interface SlotData {
	/** The slot's name, unique within the skeleton. */
	name: string;
	/** Index of the bone this slot is attached to. */
	boneIndex: number;
	/** Setup-pose tint color. */
	color: Color;
	/** Setup-pose dark tint color for two-color tinting, or null when the slot does not use it. */
	darkColor: Color | null;
	/** Name of the attachment active in the setup pose, or null for none. */
	attachmentName: string | null;
	/** Blend mode used when drawing the slot's attachment. */
	blendMode: BlendMode;
}

/** One IK constraint, rotating one or two bones toward a target bone. */
export interface IkConstraintData {
	/** The constraint's name, unique within the skeleton. */
	name: string;
	/** Ordinal controlling the order constraints are applied in. */
	order: number;
	/** True if this constraint is only applied when the active skin includes it. */
	skinRequired: boolean;
	/** Indices of the bones this constraint controls: one bone, or two for two bone IK. */
	bones: number[];
	/** Index of the target bone. */
	target: number;
	/** Influence of the constraint, from 0 (only FK) to 1 (only IK). */
	mix: number;
	/** For two bone IK, the distance from maximum reach where rotation starts to slow. */
	softness: number;
	/** Bend direction for two bone IK: 1 for positive rotation, -1 for negative. */
	bendDirection: number;
	/** True to scale a single constrained bone when the target is too close. */
	compress: boolean;
	/** True to scale the parent bone when the target is out of range. */
	stretch: boolean;
	/** True to scale a single constrained bone on both axes when compress or stretch applies. */
	uniform: boolean;
}

/** One transform constraint, copying a target bone's transform onto another bone. */
export interface TransformConstraintData {
	/** The constraint's name, unique within the skeleton. */
	name: string;
	/** Ordinal controlling the order constraints are applied in. */
	order: number;
	/** True if this constraint is only applied when the active skin includes it. */
	skinRequired: boolean;
	/** Indices of the bones whose transform this constraint controls. */
	bones: number[];
	/** Index of the target bone. */
	target: number;
	/** True if the target's local transform is affected, else its world transform is. */
	local: boolean;
	/** True if the target's transform is adjusted relatively, else it is set absolutely. */
	relative: boolean;
	/** Rotation offset from the target bone, in degrees. */
	offsetRotation: number;
	/** X offset from the target bone. */
	offsetX: number;
	/** Y offset from the target bone. */
	offsetY: number;
	/** X scale offset from the target bone. */
	offsetScaleX: number;
	/** Y scale offset from the target bone. */
	offsetScaleY: number;
	/** Y shear offset from the target bone. */
	offsetShearY: number;
	/** Influence on rotation, from 0 (no effect) to 1 (only the constraint). */
	rotateMix: number;
	/** Influence on translation. See `rotateMix`. */
	translateMix: number;
	/** Influence on scale. See `rotateMix`. */
	scaleMix: number;
	/** Influence on shear. See `rotateMix`. */
	shearMix: number;
}

/** One path constraint, moving one or more bones along a target slot's path attachment. */
export interface PathConstraintData {
	/** The constraint's name, unique within the skeleton. */
	name: string;
	/** Ordinal controlling the order constraints are applied in. */
	order: number;
	/** True if this constraint is only applied when the active skin includes it. */
	skinRequired: boolean;
	/** Indices of the bones this constraint controls. */
	bones: number[];
	/** Index of the target slot, which carries the path attachment. */
	target: number;
	/** How the path position value is interpreted. */
	positionMode: PathPositionMode;
	/** How the spacing value is interpreted. */
	spacingMode: PathSpacingMode;
	/** How bone rotation along the path is calculated. */
	rotateMode: PathRotateMode;
	/** Rotation offset from the path rotation, in degrees. */
	offsetRotation: number;
	/** Position along the path. */
	position: number;
	/** Spacing between bones. */
	spacing: number;
	/** Influence on rotation, from 0 (no effect) to 1 (only the constraint). */
	rotateMix: number;
	/** Influence on translation. See `rotateMix`. */
	translateMix: number;
}

/** Kind of attachment a skin can hold. Byte order in the format is `region`, `boundingbox`, `mesh`, `linkedmesh`, `path`, `point`, `clipping`. */
export type AttachmentType = "region" | "boundingbox" | "mesh" | "linkedmesh" | "path" | "point" | "clipping";

/** Mesh-shaped vertices with no bone weights: a plain list of positions relative to the slot's bone. */
export interface UnweightedVertices {
	/** Discriminant: false, since no vertex here carries bone weights. */
	weighted: false;
	/** Vertex positions relative to the slot's bone, flattened as x0, y0, x1, y1, ... */
	values: Float32Array;
}

/** Mesh-shaped vertices where every vertex is deformed by one or more bones. */
export interface WeightedVertices {
	/** Discriminant: true, since every vertex here carries bone weights. */
	weighted: true;
	/** Per-vertex bone influence list, flattened: for each vertex, an influence count followed by that many bone indices. */
	bones: Int32Array;
	/** Per-influence bind data, flattened in the same order as the indices in `bones`: bind X, bind Y, weight for each influence. */
	values: Float32Array;
}

/** A mesh, bounding box, path or clipping attachment's vertex list, in either the unweighted or the bone-weighted shape. */
export type MeshVertices = UnweightedVertices | WeightedVertices;

/** An image attachment, drawn as a single quad relative to the slot's bone. */
export interface RegionAttachment {
	/** Discriminant for the `Attachment` union. */
	type: "region";
	/** The attachment's own name, or the skin placeholder name when the format's name field was null. */
	name: string;
	/** Texture region lookup key that overrides the attachment name, or null to use the attachment name. */
	path: string | null;
	/** Rotation in degrees relative to the slot's bone. */
	rotation: number;
	/** X position relative to the slot's bone. */
	x: number;
	/** Y position relative to the slot's bone. */
	y: number;
	/** X scale of the image. */
	scaleX: number;
	/** Y scale of the image. */
	scaleY: number;
	/** Width of the image. */
	width: number;
	/** Height of the image. */
	height: number;
	/** Tint color for the attachment. */
	color: Color;
}

/** A non-rendered polygon used for hit detection. */
export interface BoundingBoxAttachment {
	/** Discriminant for the `Attachment` union. */
	type: "boundingbox";
	/** The attachment's own name, or the skin placeholder name when the format's name field was null. */
	name: string;
	/** The bounding box's vertices. */
	vertices: MeshVertices;
	/** Editor color, or null when nonessential data was not exported. */
	color: Color | null;
}

/** A deformable image attachment made of a triangulated vertex mesh. */
export interface MeshAttachment {
	/** Discriminant for the `Attachment` union. */
	type: "mesh";
	/** The attachment's own name, or the skin placeholder name when the format's name field was null. */
	name: string;
	/** Texture region lookup key that overrides the attachment name, or null to use the attachment name. */
	path: string | null;
	/** Tint color for the attachment. */
	color: Color;
	/** Texture coordinates per vertex, flattened as u0, v0, u1, v1, ... */
	uvs: Float32Array;
	/** Triangle indices into the vertex list, 3 per triangle. */
	triangles: Uint16Array;
	/** The mesh's vertices. */
	vertices: MeshVertices;
	/** Number of vertices, counted from the start of `vertices`, that make up the polygon hull. Hull vertices are always listed first. */
	hullLength: number;
	/** Vertex indices for the mesh's edges, or null when nonessential data was not exported. */
	edges: Uint16Array | null;
	/** Width of the image used by the mesh, or null when nonessential data was not exported. */
	width: number | null;
	/** Height of the image used by the mesh, or null when nonessential data was not exported. */
	height: number | null;
}

/** A mesh attachment that reuses another mesh's vertices, deforming along with it. The parent reference is left unresolved for a later task. */
export interface LinkedMeshAttachment {
	/** Discriminant for the `Attachment` union. */
	type: "linkedmesh";
	/** The attachment's own name, or the skin placeholder name when the format's name field was null. */
	name: string;
	/** Texture region lookup key that overrides the attachment name, or null to use the attachment name. */
	path: string | null;
	/** Tint color for the attachment. */
	color: Color;
	/** Name of the skin holding the source mesh, or null when the source mesh is in the default skin. */
	parentSkin: string | null;
	/** Name of the source mesh attachment, which is always in the same slot as this one. */
	parentName: string;
	/** True if deform timelines for the source mesh should also apply to this mesh. */
	inheritDeform: boolean;
	/** Width of the image used by the mesh, or null when nonessential data was not exported. */
	width: number | null;
	/** Height of the image used by the mesh, or null when nonessential data was not exported. */
	height: number | null;
}

/** A polygon used as a path for path constraints. */
export interface PathAttachment {
	/** Discriminant for the `Attachment` union. */
	type: "path";
	/** The attachment's own name, or the skin placeholder name when the format's name field was null. */
	name: string;
	/** True if the last and first vertex are connected. */
	closed: boolean;
	/** True if movement along the path uses constant speed. */
	constantSpeed: boolean;
	/** The path's vertices. */
	vertices: MeshVertices;
	/** Setup-pose length from the start of the path to the end of each curve, one entry per 3 vertices. */
	lengths: Float32Array;
	/** Editor color, or null when nonessential data was not exported. */
	color: Color | null;
}

/** A single labeled point relative to the slot's bone, used for attaching effects or other game objects. */
export interface PointAttachment {
	/** Discriminant for the `Attachment` union. */
	type: "point";
	/** The attachment's own name, or the skin placeholder name when the format's name field was null. */
	name: string;
	/** Rotation in degrees relative to the slot's bone. */
	rotation: number;
	/** X position relative to the slot's bone. */
	x: number;
	/** Y position relative to the slot's bone. */
	y: number;
	/** Editor color, or null when nonessential data was not exported. */
	color: Color | null;
}

/** A polygon that clips the rendering of every slot between this one and the slot `endSlotIndex` names. */
export interface ClippingAttachment {
	/** Discriminant for the `Attachment` union. */
	type: "clipping";
	/** The attachment's own name, or the skin placeholder name when the format's name field was null. */
	name: string;
	/** Index of the slot where clipping stops. */
	endSlotIndex: number;
	/** The clipping polygon's vertices. */
	vertices: MeshVertices;
	/** Editor color, or null when nonessential data was not exported. */
	color: Color | null;
}

/** One attachment a skin can place into a slot, discriminated by `type`. */
export type Attachment = RegionAttachment | BoundingBoxAttachment | MeshAttachment | LinkedMeshAttachment | PathAttachment | PointAttachment | ClippingAttachment;

/** A skin's attachment data: a named set of attachments that can be placed into slots. */
export interface Skin {
	/** The skin's name. The default skin, which has no name in the format, is recorded as `"default"`. */
	name: string;
	/** This skin's attachments, keyed by slot index and then by the placeholder name they are stored under in the skin. */
	attachments: Map<number, Map<string, Attachment>>;
}

/** A custom event definition, giving the default payload an animation's event keyframes can override. */
export interface EventData {
	/** The event's name, unique within the skeleton. */
	name: string;
	/** Default integer payload for this event. */
	intValue: number;
	/** Default float payload for this event. */
	floatValue: number;
	/** Default string payload for this event, or null when none is set. */
	stringValue: string | null;
	/** Path to an audio file to play when this event fires, or null when the event does not play audio. */
	audioPath: string | null;
}

/** How a keyframe interpolates toward the next keyframe: straight line, hold until the next key, or a Bezier curve. */
export type Curve = "linear" | "stepped" | { bezier: [number, number, number, number] };

/** Sets a slot's attachment at each keyframe. */
export interface AttachmentTimeline {
	/** Discriminant for the `Timeline` union. */
	type: "attachment";
	/** Index of the slot this timeline drives. */
	slotIndex: number;
	/** Keyframe times in seconds. */
	times: number[];
	/** Attachment name set at each keyframe, or null to clear the slot. */
	names: (string | null)[];
}

/** Tints a slot at each keyframe. */
export interface ColorTimeline {
	/** Discriminant for the `Timeline` union. */
	type: "color";
	/** Index of the slot this timeline drives. */
	slotIndex: number;
	/** Keyframe times in seconds. */
	times: number[];
	/** Slot color at each keyframe. */
	colors: Color[];
	/** Curve from each keyframe to the next, one fewer than there are keyframes. */
	curves: Curve[];
}

/** Tints a slot with a light and a dark color at each keyframe, for two-color tinting. */
export interface TwoColorTimeline {
	/** Discriminant for the `Timeline` union. */
	type: "twoColor";
	/** Index of the slot this timeline drives. */
	slotIndex: number;
	/** Keyframe times in seconds. */
	times: number[];
	/** Light slot color at each keyframe. */
	lights: Color[];
	/** Dark slot color at each keyframe. Its alpha byte has no meaning and is kept as read. */
	darks: Color[];
	/** Curve from each keyframe to the next, one fewer than there are keyframes. */
	curves: Curve[];
}

/** Rotates a bone at each keyframe. */
export interface RotateTimeline {
	/** Discriminant for the `Timeline` union. */
	type: "rotate";
	/** Index of the bone this timeline drives. */
	boneIndex: number;
	/** Keyframe times in seconds. */
	times: number[];
	/** Rotation in degrees at each keyframe, relative to the setup pose. */
	angles: number[];
	/** Curve from each keyframe to the next, one fewer than there are keyframes. */
	curves: Curve[];
}

/** Translates, scales or shears a bone at each keyframe. */
export interface BoneXYTimeline {
	/** Discriminant for the `Timeline` union. */
	type: "translate" | "scale" | "shear";
	/** Index of the bone this timeline drives. */
	boneIndex: number;
	/** Keyframe times in seconds. */
	times: number[];
	/** X translation, scale or shear at each keyframe. */
	x: number[];
	/** Y translation, scale or shear at each keyframe. */
	y: number[];
	/** Curve from each keyframe to the next, one fewer than there are keyframes. */
	curves: Curve[];
}

/** Changes an IK constraint's settings at each keyframe. */
export interface IkConstraintTimeline {
	/** Discriminant for the `Timeline` union. */
	type: "ik";
	/** Index of the IK constraint this timeline drives. */
	constraintIndex: number;
	/** Keyframe times in seconds. */
	times: number[];
	/** IK mix at each keyframe, from 0 (only FK) to 1 (only IK). */
	mixes: number[];
	/** Two bone IK softness at each keyframe. */
	softness: number[];
	/** Bend direction at each keyframe, 1 or -1. */
	bendDirections: number[];
	/** Compress flag at each keyframe. */
	compress: boolean[];
	/** Stretch flag at each keyframe. */
	stretch: boolean[];
	/** Curve from each keyframe to the next, one fewer than there are keyframes. */
	curves: Curve[];
}

/** Changes a transform constraint's mixes at each keyframe. */
export interface TransformConstraintTimeline {
	/** Discriminant for the `Timeline` union. */
	type: "transform";
	/** Index of the transform constraint this timeline drives. */
	constraintIndex: number;
	/** Keyframe times in seconds. */
	times: number[];
	/** Rotate mix at each keyframe. */
	rotateMixes: number[];
	/** Translate mix at each keyframe. */
	translateMixes: number[];
	/** Scale mix at each keyframe. */
	scaleMixes: number[];
	/** Shear mix at each keyframe. */
	shearMixes: number[];
	/** Curve from each keyframe to the next, one fewer than there are keyframes. */
	curves: Curve[];
}

/** Changes a path constraint's position or spacing at each keyframe. */
export interface PathValueTimeline {
	/** Discriminant for the `Timeline` union. */
	type: "pathPosition" | "pathSpacing";
	/** Index of the path constraint this timeline drives. */
	constraintIndex: number;
	/** Keyframe times in seconds. */
	times: number[];
	/** Path position or spacing at each keyframe. */
	values: number[];
	/** Curve from each keyframe to the next, one fewer than there are keyframes. */
	curves: Curve[];
}

/** Changes a path constraint's mixes at each keyframe. */
export interface PathMixTimeline {
	/** Discriminant for the `Timeline` union. */
	type: "pathMix";
	/** Index of the path constraint this timeline drives. */
	constraintIndex: number;
	/** Keyframe times in seconds. */
	times: number[];
	/** Rotate mix at each keyframe. */
	rotateMixes: number[];
	/** Translate mix at each keyframe. */
	translateMixes: number[];
	/** Curve from each keyframe to the next, one fewer than there are keyframes. */
	curves: Curve[];
}

/** Offsets a mesh-shaped attachment's vertices at each keyframe. */
export interface DeformTimeline {
	/** Discriminant for the `Timeline` union. */
	type: "deform";
	/** Index of the skin that holds the attachment. */
	skinIndex: number;
	/** Index of the slot that holds the attachment. */
	slotIndex: number;
	/** Name the attachment is stored under in the skin. */
	attachmentName: string;
	/** Keyframe times in seconds. */
	times: number[];
	/** Index of the first vertex value each keyframe stores. Values before it are zero. */
	starts: number[];
	/** The stored vertex values at each keyframe, starting at the matching `starts` entry. Empty when the keyframe is all zero. */
	values: number[][];
	/** Curve from each keyframe to the next, one fewer than there are keyframes. */
	curves: Curve[];
}

/** One slot move within a draw order keyframe. */
export interface DrawOrderChange {
	/** Index of the slot to move. */
	slotIndex: number;
	/** How many places to move the slot from its setup draw order position. */
	offset: number;
}

/** Reorders the slots at each keyframe. */
export interface DrawOrderTimeline {
	/** Discriminant for the `Timeline` union. */
	type: "drawOrder";
	/** Keyframe times in seconds. */
	times: number[];
	/** The slot moves at each keyframe. An empty list restores the setup draw order. */
	changes: DrawOrderChange[][];
}

/** One event keyframe's payload. */
export interface EventKey {
	/** Index into the skeleton's event definitions. */
	eventIndex: number;
	/** Integer payload for this firing. */
	intValue: number;
	/** Float payload for this firing. */
	floatValue: number;
	/** String payload for this firing, or null to use the event definition's default. */
	stringValue: string | null;
}

/** Fires events at each keyframe. */
export interface EventTimeline {
	/** Discriminant for the `Timeline` union. */
	type: "event";
	/** Keyframe times in seconds. */
	times: number[];
	/** The event fired at each keyframe. */
	events: EventKey[];
}

/** One timeline in an animation, discriminated by `type`. */
export type Timeline =
	| AttachmentTimeline
	| ColorTimeline
	| TwoColorTimeline
	| RotateTimeline
	| BoneXYTimeline
	| IkConstraintTimeline
	| TransformConstraintTimeline
	| PathValueTimeline
	| PathMixTimeline
	| DeformTimeline
	| DrawOrderTimeline
	| EventTimeline;

/** A named animation. */
export interface Animation {
	/** The animation's name, unique within the skeleton. */
	name: string;
	/** Length in seconds: the largest keyframe time in any timeline. The format does not store it. */
	duration: number;
	/** Every timeline the animation carries, in file order. */
	timelines: Timeline[];
}

/** The full data a Spine 3.8 skeleton binary carries. */
export interface SkeletonData {
	/** Spine editor version string that exported this skeleton, e.g. `3.8.99`. */
	version: string;
	/** X coordinate of the lower left corner of the setup pose attachment bounds. */
	x: number;
	/** Y coordinate of the lower left corner of the setup pose attachment bounds. */
	y: number;
	/** Width of the setup pose attachment bounds. */
	width: number;
	/** Height of the setup pose attachment bounds. */
	height: number;
	/** Dopesheet framerate in frames per second, or null when nonessential data was not exported. */
	fps: number | null;
	/** Every bone, with each parent appearing before its children. */
	bones: BoneData[];
	/** Every slot, in draw order. */
	slots: SlotData[];
	/** Every IK constraint. */
	ik: IkConstraintData[];
	/** Every transform constraint. */
	transform: TransformConstraintData[];
	/** Every path constraint. */
	path: PathConstraintData[];
	/** Every skin, with the default skin first. */
	skins: Skin[];
	/** Every custom event definition. */
	events: EventData[];
	/** Every animation. */
	animations: Animation[];
}

// //////////////////////////////////////////////////////////////////////////////////////////////////
// //////////////////////////////////////////////////////////////////////////////////////////////////
// Atlas types

/** Pixel format the atlas loader should use to store a page's image in memory. `RGBA8888` when the atlas omits the `format` field. */
export type AtlasFormat = "Alpha" | "Intensity" | "LuminanceAlpha" | "RGB565" | "RGBA4444" | "RGB888" | "RGBA8888";

/** Texture filter setting for a page's minification or magnification. `Nearest` when the atlas omits the `filter` field. */
export type AtlasFilter = "Nearest" | "Linear" | "MipMap" | "MipMapNearestNearest" | "MipMapLinearNearest" | "MipMapNearestLinear" | "MipMapLinearLinear";

/** Texture wrap setting for a page. `none` when the atlas omits the `repeat` field. */
export type AtlasRepeat = "none" | "x" | "y" | "xy";

/** One packed image region within an atlas page, looked up by name from a skeleton's region, mesh or linked mesh attachment. */
export interface AtlasRegion {
	/** The region's name. Multiple regions may share a name when they differ by `index`, for frame-by-frame animation. */
	name: string;
	/** X pixel position of the packed image within the page. */
	x: number;
	/** Y pixel position of the packed image within the page. */
	y: number;
	/** Packed width of the image within the page, in pixels. */
	width: number;
	/** Packed height of the image within the page, in pixels. */
	height: number;
	/** Left-edge whitespace stripped from the image before packing, in pixels. 0 when the atlas omits the `offset` field. */
	offsetX: number;
	/** Bottom-edge whitespace stripped from the image before packing, in pixels. 0 when the atlas omits the `offset` field. */
	offsetY: number;
	/** Width of the image before whitespace stripping, in pixels. Equal to `width` when the atlas omits the `orig` field. */
	originalWidth: number;
	/** Height of the image before whitespace stripping, in pixels. Equal to `height` when the atlas omits the `orig` field. */
	originalHeight: number;
	/** Rotation in degrees the region was packed at, counter clockwise: 0 for `false`, 90 for `true`, or the stated degree value. */
	rotate: number;
	/** Frame index for regions sharing a name in frame-by-frame animation, or -1 when the atlas omits the `index` field. */
	index: number;
}

/** One page of a texture atlas: one packed image and the regions within it. */
export interface AtlasPage {
	/** The page image's file name, as written in the atlas, e.g. `char_002_amiya.png`. */
	name: string;
	/** Declared pixel width of the page image, or 0 when the atlas omits the `size` field. The staged corpus always omits it. */
	width: number;
	/** Declared pixel height of the page image, or 0 when the atlas omits the `size` field. The staged corpus always omits it. */
	height: number;
	/** Pixel format the atlas loader should use for this page's image. */
	format: AtlasFormat;
	/** Minification and magnification texture filter for this page, in that order. */
	filter: [AtlasFilter, AtlasFilter];
	/** Texture wrap setting for this page. */
	repeat: AtlasRepeat;
	/** True if this page's image has premultiplied alpha applied. False when the atlas omits the `pma` field. */
	pma: boolean;
	/** Every region packed into this page, in file order. */
	regions: AtlasRegion[];
}

/** A parsed `.atlas` file: one or more packed pages. */
export interface Atlas {
	/** Every page the atlas declares, in file order. */
	pages: AtlasPage[];
}
