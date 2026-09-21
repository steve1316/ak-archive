# Spine 3.8 binary format, as found in the staged corpus

Esoteric's public binary format page documents Spine 4.x, not 3.8. Where a staged `.skel` file disagrees with the page, the file wins. This
file records every place that happened, with the rig and byte offset that proves it. See `SOURCES.md` for the page URLs.

## Differences from the 4.x page

### Task 1: header, through the version string

Checked byte-for-byte against `char_172_svrash/base/battle/char_172_svrash.skel` (a scratchpad script loaded `src/spine/reader.ts` through
Vite and read the header in the order the page's "Format" section lists it):

| Offset (hex) | Field | Type | Value |
| --- | --- | --- | --- |
| 0x00 | hash length | varint+ | 28 |
| 0x01-0x1b | hash | UTF-8, 27 bytes | `X4oRh8l7k7d1lpk3Vq6T/RLeDUU` |
| 0x1c | version length | varint+ | 7 |
| 0x1d-0x22 | version | UTF-8, 6 bytes | `3.8.99` |

No difference from the page for this range: `hash` and `version` are both varint+-prefixed UTF-8 strings (`hash` is a string, not raw
bytes), in the order the page lists them, and the "Data types" section's varint+ and string encodings decode them correctly. The version
string reads `3.8.99`, as expected for a 3.8-era rig.

The same script went on to read the rest of the header the page describes, past what Task 1 requires. Not asserted by a check yet, but
recorded here since it lines up with the page and will save Task 2 a step:

| Offset (dec) | Field | Type | Value |
| --- | --- | --- | --- |
| 35 | x | float | -241.72645568847656 |
| 39 | y | float | -4.90814208984375 |
| 43 | width | float | 514.5020141601562 |
| 47 | height | float | 462.4248046875 |
| 51 | nonessential | boolean | true |
| 52 | fps | float | 30 |
| 56 | images | string | `E:/SpineInput/` |
| 71 | audio | string | `` (empty, not null) |
| 72 | shared string count | varint+ | 52 |
| 73 | shared string[0] | string | `C_Weapon` |
| 82 | shared string[1] | string | `C_Weapon_2` |
| 93 | shared string[2] | string | `F_Back_Hair` |

No difference found here either: every field is in the page's order and matches its declared type.

### Task 2: bones, slots, IK, transform and path constraints

Verified by parsing 30 skeletons (the header through path constraints) and asserting every bone's parent index is below its own index,
every slot's bone index is in range, and every IK, transform and path constraint's bone and target indices are in range: all 30 pass. The 30
rigs are the 7 named reference operators' base battle rigs (`char_1012_skadi2` has no battle rig, so her base dorm rig was used instead) plus
23 more chosen at random with Python's `random.seed(42)` over every other rig's base battle `.skel`, from the candidates in
`tools/assets/.staging/assets/spine/*/base/battle/`.

Bones, slots, IK constraints and path constraints all match the page's field order and types exactly, with no 3.8-specific differences
found. Two things worth recording even though they are not differences: the header's `nonessential` flag really does gate whether `fps`,
`images` and `audio` are present in the byte stream, confirmed against `char_4093_frston/base/battle/char_4093_frston.skel`, which has
`nonessential = false` and no `fps`/`images`/`audio` bytes at all. And a slot's dark color is a plain 4-byte int that is exactly `-1` when
the slot does not use tint black, not a separate presence flag; this was not asserted by a check but decodes cleanly on every sample.

Transform constraints do **not** differ from the page: they have the same shape as IK and path constraints, a `varint+ bone count` followed
by that many bone indices, then one `target` index, exactly as documented. An earlier version of this file claimed a mystery undocumented
field here (`unknownValue`, read as a fourth byte between `target` and `local`) - that was wrong, and the mistake is worth recording since
it's a real trap: both rigs used to "confirm" it, `char_123_fang/base/battle/char_123_fang.skel` and
`char_2027_wang/base/battle/char_2027_wang.skel`, happen to have exactly 1 bone in every transform constraint. With `boneCount = 1`, the
byte sequence `boneCount(1 byte) + bones[1](1 byte) + target(1 byte)` is byte-identical in length to the wrongly-assumed
`bone(1 byte) + target(1 byte) + unknownValue(1 byte)` - both are 3 bytes, so the misread field order happened to decode plausible-looking
numbers and passed review on a 30-rig sample where no transform constraint had more than 1 bone.

The counter-example that exposed it: `char_400_weedy/sightseer_1/battle/char_400_weedy_sightseer_1.skel`'s 3rd transform constraint has
`boneCount = 2`, `bones = [72, 66]`, `target = 50`. The old (wrong) code read `bone = 72`, `target = 66`, `unknownValue = 50`, then desynced
every field after it, eventually throwing `Unknown path position mode constant 164` once the corrupted offset reached the path constraint
section. With the corrected bone-list shape, all 2,744 staged `.skel` files parse through bones/slots/IK/transform/path constraints with
zero throws; 54 files have at least one transform constraint with `boneCount > 1` (up to 4 bones).

Lesson: a sample where a count field is always 1 cannot distinguish "one fixed field" from "a count of one, plus a loop of one". Any future
byte-forensics on a repeated `count` + `for each: ...` shape should specifically seek out a rig where that count is greater than 1 before
trusting the field order.

Path constraints were checked against `char_115_headbr/base/battle/char_115_headbr.skel`, which has exactly one, with 8 bones: the bone
list is 8 plain single-byte varint+ bone indices followed by one single-byte `target`, matching the page's "for each bone: bone index"
loop followed by one target outside it, the same shape IK constraints use. No extra field, unlike transform constraints.

### Task 3: skins, attachments and events

Verified by parsing all 2,744 staged `.skel` files through skins, attachments and events, and asserting every skin's slot index is in
range, every weighted vertex's bone index is in range, every mesh's triangle indices are below its vertex count, every linked mesh's
parent resolves by name within the named skin (or the default skin when none is named), and every event name is non-empty: all 2,744 pass
with zero throws and zero range failures.

Three real 3.8-vs-4.x differences were found, all confirmed by byte forensics rather than by memory of any runtime:

**1. The "Vertices format" section's `weighted` true/false labels are swapped on the page.** The page reads as if `weighted = true` means a
plain X, Y pair per vertex and `weighted = false` means the bone-influence list. Tested against the mesh attachment in slot 2
(`F_Back_Hair`, name `null`, placeholder `F_Back_Hair`) of `char_115_headbr/base/battle/char_115_headbr.skel`'s default skin, whose
Vertices block starts at offset 5251 with a `weighted` byte of `1`. Reading the page literally (`weighted = true` -> 16 plain X,Y pairs)
leaves the reader at a `hullCount` of 1,042,124 against a 16-vertex mesh - not sane. Reading it inverted (`weighted = true` -> a
variable-length bone-influence list per vertex) leaves the reader at a `hullCount` of 14, which is `<= 16` and sane. Every mesh, bounding
box, path and clipping attachment in the corpus was then read with the inverted meaning and none produced an out-of-range bone index or
triangle index. `readVertices` in `binary.ts` implements the inverted (file-true) meaning, with a comment noting the swap. The page also
labels the per-vertex bone count and each bone index in this block as `float bone count` and `float bone index`, but they decode as
varint+ values, not 4-byte floats: reading the same `char_115_headbr` mesh's Vertices block as varint+ gives vertex 0 an influence count of
1 with bone index 17 and weight `1.0` (a single full-weight influence, as expected), and vertex 1 an influence count of 3 with bone indices
17, 34 and 35 whose weights sum to `1.0` - both sane. Reading either field as a 4-byte float instead immediately desyncs the block.
`readVertices` reads both with `reader.varint(true)`.

**2. `ATTACHMENT_CLIPPING`'s `end slot index` is a varint+, not the page's 4-byte `int`.** Found while parsing
`char_4031_liesel/base/battle/char_4031_liesel.skel`: reading it as a 4-byte int at the clipping attachment starting at offset 36943
(placeholder `F_L_O_EyeWC`, slot 74) decodes to `0x4c0a0102` (over a billion), while this rig has under 100 slots - not sane. Reading the
same byte (`0x4c` = 76) as a varint+ single byte matches the slot range, and every following field (a `varint+` vertex count of 10, then a
weighted-vertex block with bone indices 11 and 15 repeating across several vertices) decodes cleanly from there. `readClippingAttachment`
uses `reader.varint(true)` for `endSlotIndex`.

**3. `EventData`'s `volume` and `balance` floats after the audio path are unproven for a non-null audio path in 3.8.** The page lists 7
fields per event (`name`, `int`, `float`, `string`, `audio`, `volume`, `balance`) unconditionally. Found while parsing
`char_4182_oblvns/avemujica_1/battle/char_4182_oblvns_avemujica_1.skel`, whose event section starts at offset 98592 with `event count = 2`.
Reading all 7 fields decodes the first event cleanly (name index 135, resolving to the real shared string `OnAttack`) but the second
event's name index decodes to 0 (null), its int/float fields are implausible tiny denormals, and the read runs off the end of the file a
few hundred bytes later while trying to read an inline string of length ~2,097,150. Dropping `volume` and `balance` and reading only
`name`, `int`, `float`, `string`, `audio` (5 fields) puts the second event's name index at exactly 136 (`stringCount - 1`, the last shared
string), which resolves to the real, plausible name `OnStart`, and both events then read with sane zeroed int/float/string/audio defaults.
That proves the 5-field shape for a null audio path: in the full 2,744-file corpus every one of the 4,851 events has a null audio path, and
no volume/balance bytes follow. Whether `volume`/`balance` follow a *non-null* audio path is unproven, since no staged event has one -
`readEvents` reads the 5 fields and then throws `SpineFormatError` if the audio path is non-null, rather than guess at a shape the corpus
cannot confirm.

### Task 4: animations and timelines

Verified by parsing all 2,744 staged `.skel` files to the last byte with `tools/assets/check_spine_rigs.mjs`: every file ends exactly after its
last animation, and every timeline's bone, slot, IK/transform/path constraint, skin, attachment and event reference is in range. The run
also covers the 2,987 raw files under `.staging/upstream/spine`, which parse with zero failures too. Timeline counts over the staged corpus:

| Timeline | Count | Timeline | Count |
| --- | --- | --- | --- |
| rotate | 3,962,487 | deform | 1,638,543 |
| translate | 3,954,153 | ik | 124,670 |
| scale | 3,947,115 | transform | 172,399 |
| shear | 3,753,086 | drawOrder | 22,725 |
| attachment | 2,223,901 | twoColor | 16,646 |
| color | 1,774,116 | pathPosition / pathSpacing / pathMix | 4,433 / 4,206 / 4,035 |
| event | 7,163 | | |

The animation part of the page is close to 3.8: the section order (slots, bones, IK, transform, path, deform, draw order, events), the
`SLOT_*`, `BONE_*`, `PATH_*` and `CURVE_*` ids, and the per-keyframe curve (a `CURVE_*` byte, then 4 floats `cx1, cy1, cx2, cy2` for a
Bezier, left out after the last keyframe) all match the bytes. Every difference found:

**1. Each animation starts with its name as an inline string, and no duration is stored.** The page's "For each animation" goes straight
to the slot count. `char_002_amiya/base/battle/char_002_amiya.skel` offset 25840 is the animation count `0x0e` (14), then `07 "Attack"` (an
inline string, not a shared-string ref), then `0x35` (53), the count of slots with timelines. The next field after the event keyframes is the
next animation's name, so there is no trailing duration either. `Animation.duration` is the largest key time.

**2. An IK keyframe is `time, mix, softness, bendDirection, compress, stretch`, not the page's `time, mix, bendDirection`.** Same rig,
offset 0x9720 (38688): IK timeline count `04`, constraint `00`, 2 frames, then `00000000` (time 0), `3f800000` (mix 1.0), `00000000`
(softness 0.0), `01` (bend), `00` (compress), `00` (stretch), `01` (stepped curve), then the second key at `3fe22222` (1.767). Over the
corpus, all 168,547 bend bytes are 1 or -1, every softness is 0 or more, and compress/stretch are read with a strict 0/1 check that never
trips. That check cannot tell compress from stretch, so the order was tested against each IK constraint's own setup values: of 2,087 first
keys, 1,805 match the constraint's setup compress and stretch in the order above, and 0 match with the two swapped. Compress is also only
ever set on 1-bone constraints (1,344 keys), which is the only case where it has any effect.

**3. Transform constraint keyframes carry a curve.** The page lists 4 mixes per key and no curve. At
`char_400_weedy/sightseer_1/battle/char_400_weedy_sightseer_1.skel` offset 163696: constraint `0x0c`, 5 frames, time 0, four `3f800000`
mixes, curve `01`, then the next time `3eddddde` (0.433). Without the curve byte every transform timeline desyncs.

**4. A deform keyframe's first varint is a value count, not the page's "end vertex".** The page says `end`, then `start`, then the values
from start to end. The bytes say `count`, then `start`, then `count` floats. At `char_002_amiya` offset 38858 (0x97ca), `F_Coat_Back`
deform: key 0 is `00000000 00 00` (time, count 0, linear), key 1 is time `3e6eeeef`, count `0x0a` (10), start `06`, then 10 floats and a
curve byte `01`. Reading only `10 - 6 = 4` floats would land the curve read on a float byte. Corpus-wide, 109,772 keys have a non-zero start,
so the two readings are told apart, and every key's `start + count` fits the target mesh's deformable float count (2 per vertex, or 2 per
bone influence when weighted).

**5. An event keyframe has no volume and balance after the string.** At `char_1034_jesca2/base/battle/char_1034_jesca2.skel` offset
263038 the `Skill_1_Loop` events read `time, 00 (event 0), 00 (int), 00000000 (float), 00 (no string)` and then `time, 01, 00, 00000000, 01,
08 "skill_1"`, and the very next bytes are `0e "Skill_2_B..."`, the next animation's name. 148 event keys carry a string, so the has-string
flag is proven. Volume/balance are unproven for an event whose definition has an audio path, since no staged event has one. That case never
reaches the keyframe reader: `readEvents` already throws on a non-null audio path.

**6. Two-color keys are light color, then dark color, 4 bytes each, and the dark alpha byte has no meaning.** All 16,646 two-color
timelines sit on slots with a setup dark color. The first key's light color matches the slot's setup color in 15,455 of them, and the
dark color matches the setup dark color in 15,652. The dark alpha byte takes many values (mostly 0), so a renderer should ignore it.

**7. A draw order change's offset is a varint+, so a slot only moves later.** Read as varint+, all 49,072 draw order keys are valid
moves: slot indices ascending, each target in range and unique. Read as zig-zag varint-, 31,171 of them are not, so the varint+ reading
is the one the bytes support.

Two things that are upstream data, not format differences:

- **Key times sometimes go down.** 943 timelines in 84 files, all attachment, color or deform timelines, have a key time lower than the one
  before it. Each one is 2 or 3 sorted runs of keys joined end to end, never more: 684 are an exact repeat of the first run, 259 have runs
  with different times, and in 69 the second run goes past the end of the first. One example is `char_002_amiya`'s `Start` slot 4
  attachment timeline at offset 157478: `04 01 00 04`, then four keys `(0, F_Hood) (1, F_Hood) (0, F_Hood) (1, F_Hood)`. Another is
  `char_1001_amiya2/base/back/char_1001_amiya2.skel` at 0x12cb3, a color timeline with 5 keys at `0.567, 0.733, 0, 0.567, 0.733`. The frame
  count byte really says 4 and 5, so this is what the files hold, not a misread, and other readings of these bytes fail 1,677 to 2,492
  files. No bone, constraint, draw order or event timeline does it. The gate allows it only in those three timeline types, and only for up
  to 3 runs.

  **Note for Stage 2:** a binary search over these keys is undefined, since it assumes sorted times. The player must pick a rule for them
  on purpose (for example, use only the first run, or search each run) rather than inherit whatever a sorted-key search happens to do.
- **Bezier control X values can leave 0 to 1.** 418 of 10.2 million Bezier curves have `cx1` or `cx2` between -0.34 and 1.34. They are
  real editor handles, so nothing clamps them at read time.
