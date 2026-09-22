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
