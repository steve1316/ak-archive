# Sources

Clean-room record for `src/spine/`. Every public page consulted while writing this runtime is logged here with what it was used for. The
binding rule: only sources listed here, never a Spine runtime's own source code (not `spine-runtimes`, `spine-ts`, `pixi-spine`,
`@esotericsoftware/*`, or any third-party Spine reader, in any form including package tarballs or a model's recollection of that code). Local
copies of the pages below live in the plan workspace under `docs/` for reading, but their text is Esoteric's and is never copied into this repo.

## 2026-09-21

- https://esotericsoftware.com/spine-binary-format
- https://esotericsoftware.com/spine-json-format
- https://esotericsoftware.com/spine-atlas-format

Used for: data types, byte layout. The atlas format page specifically for `src/spine/atlas.ts` (Task 5): the page/region property names,
their default values when a field is omitted, and the doc's stated blank-line page separator, which the staged corpus does not use (see
`FORMAT-3.8.md`).
