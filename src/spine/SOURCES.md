# Sources

Clean-room record for `src/spine/`. Every public page consulted while writing this runtime is logged here with what it was used for. The
binding rule: only sources listed here, never a Spine runtime's own source code (not `spine-runtimes`, `spine-ts`, `pixi-spine`,
`@esotericsoftware/*`, or any third-party Spine reader, in any form including package tarballs or a model's recollection of that code). Local
copies of the pages below live in the plan workspace under `docs/` for reading, but their text is Esoteric's and is never copied into this repo.

## 2026-09-21

- https://esotericsoftware.com/spine-binary-format - the binary data types (boolean, short, int, the two varint encodings, float,
  string, color), the field order and field names of every section (for example a mesh's hull count and a linked mesh's deform flag),
  and the `readVarint`, `readString` and `readRefString` snippets that `reader.ts` implements.
- https://esotericsoftware.com/spine-json-format - the names of enum values and fields, such as the transform modes (`onlyTranslation`,
  `noRotationOrReflection`), the attachment types (`linkedmesh`, `boundingbox`) and the keyframe fields.
- https://esotericsoftware.com/spine-atlas-format - the page and region property names that `atlas.ts` reads, their default values when a
  field is omitted, and the blank-line page separator, which the staged corpus does not use (see `FORMAT-3.8.md`).
- The staged Arknights rig files under `tools/assets/.staging/assets/spine` - the corpus oracle. Wherever a page and the bytes disagree, the
  bytes win, and `FORMAT-3.8.md` records each case with the rig and offset that proves it.
- https://esotericsoftware.com/spine-bones - the "Transform inheritance" section, whose Rotation, Scale and Reflection checkboxes are what
  the five transform modes encode, and the "Bone transforms" section on how a bone's transform carries to its children. `MATH.md` records
  the reading taken for each mode.
- https://esotericsoftware.com/spine-tools - the "Axes", "Rotate tool", "Scale tool", "Scale examples" and "Shear tool" sections: rotation
  is counterclockwise from the parent's X axis, translation is stored in the parent's axes, scale applies along the bone's own axes, and
  shear changes the angle between the X and Y axes. These give the local basis and world transform in `MATH.md`.
- https://esotericsoftware.com/spine-atlas-format - read again for geometry: the `offset` field is the whitespace stripped from the left and
  bottom edges, `offsetTop` follows from the original and packed heights, and a `rotate: true` region is stored turned 90 degrees
  counterclockwise. These give the strip and the UV table in `MATH.md`.
- https://esotericsoftware.com/spine-texture-packer - the "Strip whitespace X/Y" and "Rotation" settings, and the setting that strips
  whitespace down to mesh hulls, which backs the mesh UV reading in `MATH.md`. The page gives no rotation direction.
- https://esotericsoftware.com/spine-meshes - the "Linked meshes" section: a linked mesh shares its source mesh's vertices, UVs and weights,
  lives in the same slot, and may use its own image.
- https://esotericsoftware.com/spine-weights - bound bones carry a weight per vertex, and the weights for a vertex sum to 100%. This gives the
  weighted vertex sum in `MATH.md`.
- https://esotericsoftware.com/spine-skeletons - read while working out the world transform. It covers skeleton-level editor settings (export,
  reference scale, draw order between skeletons, hiding) and gave nothing the maths uses.
- https://esotericsoftware.com/spine-runtimes-guide - the runtimes guide's table of contents, used only to find the pages below. Only the
  guide's prose was used. Its code samples were not copied or followed.
- https://esotericsoftware.com/spine-runtime-architecture - the "Data objects" and "Instance objects" sections: stateless setup data such as
  `SkeletonData` and `BoneData`, and a stateful instance named without the "Data" suffix that keeps its data to reset to the setup pose.
  This is the `SkeletonData` and `Skeleton` split.
- https://esotericsoftware.com/spine-runtime-skeletons - the source for these API names, each used in the page's prose: `a`, `b`, `c` and
  `d` as the world transform's 2x2 matrix, with `a` and `c` the X axis and `b` and `d` the Y axis ("World transforms"); `worldX` and
  `worldY` as the bone's world position ("World transforms"); `updateWorldTransform` on a skeleton, which updates every bone in order
  ("updateWorldTransform"); `drawOrder` as the skeleton's list of slots in drawing order ("Generic rendering"); and `setToSetupPose` and
  `setSkin` as calls that change slot attachments ("Changing attachments"). The prose says a world transform maps a point from a bone's
  local coordinates to world coordinates, but it names no method for that. `localToWorld` is this runtime's own name.
- https://esotericsoftware.com/spine-runtime-skins - the opening section: attachments that were in no skin sit in a skin named `default`,
  and `getAttachment` looks in the skeleton's current skin first, then in the default skin. The "Skin changes" section: what setting a skin
  does to slot attachments when the skeleton has no skin yet and when it already has one. `MATH.md` records both rules and the case the page
  leaves open.
- https://esotericsoftware.com/spine-json-format - read again for animation: the "Bone timelines" section, which gives each rotate,
  translate, scale and shear key as a value relative to the setup pose with its default when omitted, and the slot and deform sections'
  curve text, where a bezier's X is the fraction of time between two keys and its Y the fraction of the difference between their values.
  Also its "Slot timelines" section (attachment, color and twoColor keys, each a value "to set" for the slot) and its "Draw order timeline"
  section (signed offsets from the setup pose draw order index, and a key without offsets restoring the setup order).
  `MATH.md` ("Animation") records each rule and the corpus measurements that back the ones the page leaves open.
- https://esotericsoftware.com/spine-slots - the "Tint black" section: the light color tints the lighter portions of an image and
  controls opacity, and the dark color tints the darker portions. The "Blending" section: additive, multiply and screen correspond to
  Photoshop's Linear Dodge, Multiply and Screen. `MATH.md` ("Drawing") derives the two-color formula and the blend factors from these.
- Any other method or helper name in `src/spine/` (for example `localToWorld`, `slotTriangles`, `fitView`, `refit`, `tintTexel` and `defaultSkinName`)
  is this runtime's own choice. Type names such as `Bone`, `Slot`, `Skin` and `Attachment` are the user guide's own terms.
