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

### Task 5: atlases

Verified by parsing all 2,749 staged `.atlas` files with `src/spine/atlas.ts` and cross-checking every one of the 2,744 staged `.skel`
files against the atlas beside it: 0 parse failures, 0 region-lookup failures, 0 region boxes overflow their page's real PNG size. The
most tightly packed page in the corpus fills 100.00% of its PNG's width or height (see item 2).

**1. Pages and regions are never separated by a blank line, unlike the doc's example.** Confirmed corpus-wide: none of the 2,749 files
contain a single blank line (`grep -c "^$"` is 0 for every one of them). The doc's "A blank line after a region section denotes the end of
regions for a page" does not apply here in the sense that no staged file exercises it, but the reader still honors it: a page's regions end
at a blank line or the end of the file, exactly as documented, and the corpus's single-page files just happen to hit the end-of-file case.

Confirmed separately, and load-bearing for fix rounds 2 and 3: **a page header line is never indented, and a region's own property line
always is.** Checked across all 2,749 files (every page header line and every region property line, `format`/`filter`/`repeat` and
`rotate`/`xy`/`size`/`orig`/`offset`/`index` alike): 0 exceptions. But a page header key line and a region's own *name* line are both
unindented, so indentation of a line by itself cannot tell those two apart, and neither can the line's own key: a region can be named
after something that reads like a page key (e.g. a region literally named `size: 10, 10`). What tells them apart is the line *after*:
a region's own name is always followed by an indented property line, while a page header key line never is (its own next line is
either another unindented header key or the first region's unindented name). So the rule `readPage` uses is: an unindented line whose
*next* line is indented is a region's name; every other unindented line up to that point must be a known page property (`size`,
`format`, `filter`, `repeat`, `pma`) or it throws.

Fix round 2 replaced an earlier version that instead peeked at the line *after* a candidate boundary and guessed whether *that* line
looked like a page-only header key - that lookahead let a malformed page property (a key it didn't recognize) fall through silently
and get misread as a region named after the whole malformed line, e.g. `premult: true` becoming a fake region literally named
`"premult: true"`. Fix round 2's replacement decided the header/region boundary by `PAGE_KEYS` membership of the *candidate line itself*, with no check on
the next line at all - closer, but still wrong in the other direction: a region genuinely named `size: 10, 10` would be misread as the
page declaring `size: 10, 10`, and the line after it (the region's real first property) would then throw a misleading "unknown page
property" error. No staged file has a region name that coincidentally matches a page key, so this was a latent bug rather than a real
corpus failure. Fix round 3 is the rule described above: it only trusts a line's own key once it has first confirmed, from the next
line's indentation, that the line cannot be a region name.

**2. A page header is always exactly `format`, `filter`, `repeat`, in that order, with no `size` and no `pma`.** Checked across all 2,749
files: every page header has exactly this 3-field shape (`char_002_amiya/base/battle/char_002_amiya.atlas` lines 2-4 is representative).
The doc's `size` field ("0,0 if omitted") and `pma` field ("false if omitted") are always omitted, so `AtlasPage.width`/`height` are always
0 as parsed from the text, and `pma` is always `false`. PROJECT.md's note that raw Android atlases record 1.5x the real PNG size does not
show up here: whatever staged these files (`Ark-Models` or `fexli`, per PROJECT.md) appears to drop the page `size` field entirely rather
than emit a corrected one. Fix round 2 also tightened `pma` parsing: an earlier version treated any value other than the literal string
`"true"` as `false`, so a typo like `pma: yes` silently became `false` instead of failing. `readPage` now accepts only `true` or `false`
and throws on anything else.

Because of that, the gate's original page-size check (`page.width > 0 && page.height > 0` before comparing to the PNG's real IHDR size)
never fired on any of the 2,749 files, so it proved nothing about the real corpus - it only ever guarded a hypothetical future atlas
that does declare a size. Fix round 1 kept that check (it is a handful of lines, and still catches a declared-but-wrong size if one ever
shows up), but added the check that actually exercises the 1.5x trap on real data: every region's packed box, from its `xy` and its
`width`/`height` (swapped when `rotate` is 90 or 270, since a rotated region's box has its edges swapped on the page), must lie inside
its page's real PNG size read from the IHDR bytes. This runs on all 248,623 regions across all 2,749 pages and found 0 overflows. The
gate also prints the largest fraction of a page any region's box reaches, across the whole corpus: 100.00%, meaning at least one page is
packed edge to edge, which is the expected shape for a texture packer and confirms the check is a real constraint, not a slack one.
`checkRegionBounds` in `check_spine_rigs.mjs` implements this.

**3. A region's bounds are 4 split fields (`xy`, `size`, `orig`, `offset`), not the doc's 2 combined fields (`bounds`, `offsets`).** The
doc describes one `bounds: x, y, w, h` field and one `offsets: offsetLeft, offsetBottom, origW, origH` field. Every one of the 248,623
regions in the corpus instead uses 4 separate fields in a fixed order: `rotate, xy, size, orig, offset, index`
(`char_002_amiya/base/battle/char_002_amiya.atlas` lines 5-10, region `F_Belt`). `xy` is the packed position, `size` the packed size (the
doc's `bounds` split in two), `orig` the pre-stripping original size, and `offset` the left/bottom stripped whitespace (the doc's `offsets`
split in two, with the trailing "and the original image size" half of `offsets` moved into `orig`). `readRegion` reads these 4 keys
directly rather than the doc's 2.

**4. `rotate` really does take a bare degree number, not just `true`/`false`.** The doc allows this ("Otherwise it may be false for 0
rotation or a number representing degrees from 0 to 360"), and the corpus uses it: of 248,623 regions, `rotate` is `false` in 149,560,
`true` in 95,328, `270` in 1,981 (e.g. `char_377_gdglow/sanrio_1/battle/char_377_gdglow_sanrio_1.atlas` line 517, region `F_L_Calf`) and
`180` in 1,754 (e.g. `char_1016_agoat2/base/battle/char_1016_agoat2.atlas` line 118). No other values were found. `readRegion` maps `true`
to 90 and `false` to 0. Fix round 2 narrowed the accepted degree values from the doc's full 0-360 range down to exactly `{0, 90, 180,
270}` - the 4 values the corpus actually uses, and the only ones an axis-aligned packed box can have - and throws on anything else
(e.g. `rotate: 45`), rather than accepting an arbitrary degree value the corpus never produces.

**5. No atlas in the corpus has more than one page.** All 2,749 files parse to exactly 1 page each, matching the 2,749 PNGs 1-for-1.
Since none of the 2,749 files contains a blank line (item 1), every one of them reads as a single page whose regions run to the end of
the file - the doc's documented multi-page separator (a blank line) is the only thing that could start a second page, and the corpus
never uses it.

**6. Region `index` is always -1 and no `split`, `pad` or custom name/value pair appears anywhere.** All 248,623 regions have
`index: -1`; frame-by-frame animation regions (sharing a name, different index) are not used by any staged rig. The doc documents a
ninepatch `split`/`pad` field and arbitrary custom name/value pairs as valid region properties, but since neither appears anywhere in
the corpus, fix round 2 made `readRegion` throw `AtlasFormatError` on any region property key besides `rotate`, `xy`, `size`, `orig`,
`offset` and `index`, rather than silently reading an unrecognized key past without error the way an earlier version did (that earlier
behavior is what let a typo'd key like `xyy:` pass silently, leaving the region at its 0,0 default instead of failing).

One thing that is upstream data, not a format difference: **a region name can carry a trailing space, and it is significant.**
`char_4184_dolris/avemujica_1/dorm/build_char_4184_dolris_avemujica_1.atlas` line 1020 has a region literally named `F_Weaon_Af3 ` (note
the trailing space), and the sibling skeleton's mesh attachment in that same rig looks it up by that exact name, trailing space included.
An earlier version of `readRegion` trimmed the region name line, which silently turned this into a 3-instance region-lookup failure the
gate caught immediately (see the mutation tests in `task-5-report.md`). `readRegion` now takes the region name line as-is.
