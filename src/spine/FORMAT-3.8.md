# Spine 3.8 binary format, as found in the staged corpus

Esoteric's public binary format page documents Spine 4.x, not 3.8. Where a staged `.skel` file disagrees with the page, the file wins. This
file records every place that happened, with the rig and byte offset that proves it. See `SOURCES.md` for the page URLs.

## Corpus snapshot

Every count below is from the staged corpus as of 2026-09-21: **2,748 skeletons and 2,753 atlases** under
`tools/assets/.staging/assets/spine`, the tree `tools/assets/check_spine_rigs.mjs` scans. Rig paths below are relative to that directory.

The skeletons carry two versions: `3.8.99` (2,742 files) and `3.8.84` (6 files: the base battle and back rigs of `char_1024_hbisc2`,
`char_4043_erato` and `char_4048_doroth`). Both read with the same layout. `readSkeleton` throws on any version that does not start with
`3.8.`.

The gate parses every file to the last byte: every skeleton ends exactly after its last animation, and every timeline's bone, slot,
IK/transform/path constraint, skin, attachment and event reference is in range. Timeline counts:

| Timeline | Count | Timeline | Count |
| --- | --- | --- | --- |
| rotate | 3,965,207 | deform | 1,639,020 |
| translate | 3,956,802 | ik | 124,786 |
| scale | 3,949,159 | transform | 172,399 |
| shear | 3,754,536 | drawOrder | 22,750 |
| attachment | 2,225,085 | twoColor | 16,646 |
| color | 1,774,273 | pathPosition / pathSpacing / pathMix | 4,433 / 4,206 / 4,035 |
| event | 7,170 | | |

## Header

Checked byte for byte against `char_172_svrash/base/battle/char_172_svrash.skel`, reading the header in the order the page's "Format"
section lists it:

| Offset (hex) | Field | Type | Value |
| --- | --- | --- | --- |
| 0x00 | hash length | varint+ | 28 |
| 0x01-0x1b | hash | UTF-8, 27 bytes | `X4oRh8l7k7d1lpk3Vq6T/RLeDUU` |
| 0x1c | version length | varint+ | 7 |
| 0x1d-0x22 | version | UTF-8, 6 bytes | `3.8.99` |

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

No difference from the page here. `hash` and `version` are both varint+-prefixed UTF-8 strings (`hash` is a string, not raw bytes), and
every field is in the page's order with its declared type.

The `nonessential` flag really does gate whether `fps`, `images` and `audio` are in the byte stream.
`char_4093_frston/base/battle/char_4093_frston.skel` has `nonessential = false` and no `fps`, `images` or `audio` bytes at all.

## Bones and constraints

Bones, slots, IK constraints and path constraints match the page's field order and types. Every slot's bone index is in range, and every
constraint's bone and target indices are in range (a path constraint's target is a slot).

**A bone's parent is its plain index, not the index plus one.** The 4.x page stores `parent index + 1`. A 3.8 file stores the index
itself, which is always below the bone's own index. Reading it as index plus one still parses every file to its last byte, because the field
is one varint either way, but it gives 3,468 non-root bones no parent and hangs every other bone off the bone before its real parent. The
bone names decide it: in `char_172_svrash/base/battle/char_172_svrash.skel` the plain reading puts `F_Belt` under `F_Waist` and `F_Head`
under `F_Chest`, while the plus-one reading puts `F_Head` under `F_Bird_Tail`. The gate fails any bone whose parent is not in `[0, index)`.

A slot's dark color is a plain 4-byte int that is exactly `-1` when the slot does not use tint black. There is no separate presence flag.

**Transform constraints have a bone list, like IK and path constraints.** Each is a `varint+ bone count`, that many bone indices, then one
`target` index, exactly as the page documents. 54 files have a transform constraint with more than 1 bone, and the most is 11
(`char_348_ceylon/summer_13/back/char_348_ceylon_summer_13.skel`).

This shape is a trap when only 1-bone constraints are checked. In `char_123_fang/base/battle/char_123_fang.skel` and
`char_2027_wang/base/battle/char_2027_wang.skel` every transform constraint has 1 bone, so `boneCount(1 byte) + bones[1](1 byte) +
target(1 byte)` is the same 3 bytes as a wrong `bone + target + unknown byte` reading, and both decode plausible numbers. The
counter-example is `char_400_weedy/sightseer_1/battle/char_400_weedy_sightseer_1.skel`, whose 3rd transform constraint has `boneCount = 2`,
`bones = [72, 66]`, `target = 50`. The wrong reading takes `bone = 72`, `target = 66` and desyncs every field after it, until it throws
`Unknown path position mode constant 164` in the path constraint section. Any repeated `count` + `for each` shape should be checked on a rig
where the count is above 1.

Path constraints were checked against `char_115_headbr/base/battle/char_115_headbr.skel`, which has exactly one, with 8 bones: 8
single-byte varint+ bone indices, then one single-byte `target`. That matches the page, and is the same shape IK constraints use.

## Skins and attachments

Every skin's slot index is in range, every weighted vertex's bone index is in range, and every mesh's triangle indices are below its vertex
count.

**1. The "Vertices format" section's `weighted` true/false labels are swapped on the page.** The page reads as if `weighted = true` means a
plain X, Y pair per vertex and `weighted = false` means the bone-influence list. Tested against the mesh attachment in slot 2
(`F_Back_Hair`, name `null`, placeholder `F_Back_Hair`) of `char_115_headbr/base/battle/char_115_headbr.skel`'s default skin, whose
Vertices block starts at offset 5251 with a `weighted` byte of `1`. Reading the page literally (`weighted = true` -> 16 plain X, Y pairs)
leaves the reader at a `hullCount` of 1,042,124 against a 16-vertex mesh. Reading it inverted (`weighted = true` -> a variable-length
bone-influence list per vertex) leaves the reader at a `hullCount` of 14, which is sane. Every mesh, bounding box, path and clipping
attachment in the corpus reads with the inverted meaning with no out-of-range bone or triangle index. `readVertices` implements it.

The page also labels the per-vertex bone count and each bone index in this block as `float`, but they decode as varint+ values. Read as
varint+, the same mesh's vertex 0 has 1 influence (bone 17, weight `1.0`), and vertex 1 has 3 influences (bones 17, 34 and 35) whose weights
sum to `1.0`. Reading either field as a 4-byte float desyncs the block at once. `readVertices` reads both with `reader.varint(true)`.

**2. `ATTACHMENT_CLIPPING`'s `end slot index` is a varint+, not the page's 4-byte `int`.** In
`char_4031_liesel/base/battle/char_4031_liesel.skel`, the clipping attachment at offset 36943 (placeholder `F_L_O_EyeWC`, slot 74) reads
as `0x4c0a0102` as an int, over a billion, while the rig has under 100 slots. Read as a single-byte varint+, `0x4c` is 76, in range, and
every following field (a varint+ vertex count of 10, then a weighted vertex block with bone indices 11 and 15) decodes cleanly.
`readClippingAttachment` uses `reader.varint(true)` for `endSlotIndex`.

**3. Linked meshes name their parent, and every parent resolves.** A linked mesh stores its parent's skin (null for the default skin) and
name, plus a `deform` flag. The parent is always in the same slot. The corpus has 324 linked meshes, and every parent resolves to a mesh
attachment. `readSkeleton` keeps the parent by name, and the gate's `checkLinkedMeshes` fails any linked mesh whose parent is missing or is
not a mesh.

## Events

**`EventData` has no `volume` and `balance` floats after a null audio path.** The page lists 7 fields per event (`name`, `int`, `float`,
`string`, `audio`, `volume`, `balance`). In `char_4182_oblvns/avemujica_1/battle/char_4182_oblvns_avemujica_1.skel` the event section
starts at offset 98592 with `event count = 2`. Reading all 7 fields decodes the first event cleanly (name index 135, the shared string
`OnAttack`), but the second event's name index decodes to 0 (null), its int and float fields are tiny denormals, and the read runs off the
end of the file while trying to read an inline string of length ~2,097,150. Reading only the first 5 fields puts the second event's name
index at exactly 136 (`stringCount - 1`, the last shared string), which is the real name `OnStart`, and both events read with zeroed
defaults.

All 4,855 events in the corpus have a non-empty name and a null audio path, and none has volume or balance bytes. Whether they follow a
non-null audio path is unproven, since no staged event has one. `readEvents` reads 5 fields and throws `SpineFormatError` on a non-null
audio path rather than guess.

## Animations

The animation part of the page is close to 3.8. The section order (slots, bones, IK, transform, path, deform, draw order, events), the
`SLOT_*`, `BONE_*`, `PATH_*` and `CURVE_*` ids, and the per-keyframe curve (a `CURVE_*` byte, then 4 floats `cx1, cy1, cx2, cy2` for a
Bezier, left out after the last keyframe) all match the bytes. Every difference found:

**1. Each animation starts with its name as an inline string, and no duration is stored.** The page's "For each animation" goes straight
to the slot count. `char_002_amiya/base/battle/char_002_amiya.skel` offset 25840 is the animation count `0x0e` (14), then `07 "Attack"` (an
inline string, not a shared-string ref), then `0x35` (53), the count of slots with timelines. The field after the event keyframes is the
next animation's name, so there is no trailing duration either. `Animation.duration` is the largest key time.

**2. An IK keyframe is `time, mix, softness, bendDirection, compress, stretch`, not the page's `time, mix, bendDirection`.** Same rig,
offset 0x9720 (38688): IK timeline count `04`, constraint `00`, 2 frames, then `00000000` (time 0), `3f800000` (mix 1.0), `00000000`
(softness 0.0), `01` (bend), `00` (compress), `00` (stretch), `01` (stepped curve), then the second key at `3fe22222` (1.767). All 168,671
bend bytes are 1 or -1, every softness is 0 or more, and compress and stretch pass a strict 0/1 check. That check cannot tell compress from
stretch, so the order was tested against each IK constraint's own setup values. Of the 2,087 first keys on a constraint whose setup
compress and stretch differ, 1,805 match the setup in the order above, and 0 match with the two swapped. Compress is also only ever set on
1-bone constraints (1,344 keys), the only case where it has any effect.

**3. Transform constraint keyframes carry a curve.** The page lists 4 mixes per key and no curve. At
`char_400_weedy/sightseer_1/battle/char_400_weedy_sightseer_1.skel` offset 163696: constraint `0x0c`, 5 frames, time 0, four `3f800000`
mixes, curve `01`, then the next time `3eddddde` (0.433). Without the curve byte every transform timeline desyncs.

**4. A deform keyframe's first varint is a value count, not the page's "end vertex".** The page says `end`, then `start`, then the values
from start to end. The bytes say `count`, then `start`, then `count` floats. At `char_002_amiya` offset 38858 (0x97ca), `F_Coat_Back`
deform: key 0 is `00000000 00 00` (time, count 0, linear), key 1 is time `3e6eeeef`, count `0x0a` (10), start `06`, then 10 floats and a
curve byte `01`. Reading only `10 - 6 = 4` floats would land the curve read on a float byte. 109,821 keys have a non-zero start, so the two
readings are told apart, and every key's `start + count` fits the target mesh's deformable float count (2 per vertex, or 2 per bone
influence when weighted).

**5. An event keyframe has no volume and balance after the string.** At `char_1034_jesca2/base/battle/char_1034_jesca2.skel` offset
263038 the `Skill_1_Loop` events read `time, 00 (event 0), 00 (int), 00000000 (float), 00 (no string)` and then `time, 01, 00, 00000000, 01,
08 "skill_1"`, and the very next bytes are `0e "Skill_2_B..."`, the next animation's name. 148 event keys carry a string, so the has-string
flag is proven. Volume and balance are unproven for an event whose definition has an audio path, since no staged event has one. That case
never reaches the keyframe reader, because `readEvents` already throws on it.

**6. Two-color keys are light color, then dark color, 4 bytes each, and the dark alpha byte has no meaning.** All 16,646 two-color
timelines sit on slots with a setup dark color. The first key's light RGB matches the slot's setup color in 15,455 of them, and the dark
RGB matches the setup dark color in 15,652. The dark alpha byte takes many values (mostly 0), so a renderer should ignore it.

**7. A draw order change's offset is a varint+ whose 32 bits read as a signed int.** Negative offsets are stored as 5-byte varints of their
two's complement, so a slot can move earlier as well as later: 201,129 changes are negative, such as `F_R_Arm` moving by -14 in
`char_002_amiya`'s `Attack`. Read this way, all 49,102 draw order keys are valid permutations: slot indices ascending, each target in range
and unique. Read as zig-zag varint-, 31,180 of them are not.

Two things that are upstream data, not format differences:

- **Key times sometimes go down.** 943 timelines in 84 files, all attachment, color or deform timelines, have a key time lower than the one
  before it. Each one is 2 or 3 sorted runs of keys joined end to end, never more: 690 are exact repeats of the first run, 253 have runs
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

## Atlas

Every one of the 2,753 atlases parses with `src/spine/atlas.ts`, every skeleton's region, mesh and linked mesh attachments find their
region in the atlas beside them, and no region box overflows its page's real PNG size.

**1. Pages and regions are never separated by a blank line, unlike the doc's example.** None of the 2,753 files contains a blank line.
The reader still honors the doc's rule that a blank line ends a page's regions. The corpus's files just end at the end of the file instead.

**2. A page header line is never indented, and a region property line always is.** This holds for every page header line and every region
property line in the corpus. But a page header line and a region's *name* line are both unindented, and a region can be named after
something that reads like a page key (for example a region named `size: 10, 10`). What tells them apart is the line after: a region's name
is always followed by an indented property line, and a page header line never is. So `readPage` treats an unindented line whose next line
is indented as a region's name. Every unindented line before that must be a known page property (`size`, `format`, `filter`, `repeat`,
`pma`) or it throws, so a typo like `premult: true` fails instead of turning into a region.

**3. A page header is always exactly `format`, `filter`, `repeat`, in that order, with no `size` and no `pma`.** All 2,753 page headers
have this shape (`char_002_amiya/base/battle/char_002_amiya.atlas` lines 2-4 is representative). The doc's `size` ("0,0 if omitted") and
`pma` ("false if omitted") are always omitted, so `AtlasPage.width` and `height` are always 0 and `pma` is always `false`. Raw Android
atlases are known to record 1.5x the real PNG size, but the staged files drop the page `size` field entirely. `pma` accepts only `true` or
`false` and throws on anything else.

Because no page declares a size, the gate's page size check never fires on the corpus and is only a backstop. The check that runs on real
data is the region box check: every region's packed box, from its `xy` and its `width`/`height` (swapped when `rotate` is 90 or 270), must
lie inside its page's real PNG size, read from the PNG's IHDR bytes. All 248,881 regions pass. The gate also prints the largest fraction of
a page any region's box reaches, and that is 100.00%, so at least one page is packed edge to edge and the check is a real constraint.
`checkRegionBounds` in `check_spine_rigs.mjs` implements it.

**4. Premultiplied alpha is undeclared, and the PNGs are straight alpha.** No atlas sets `pma`, so every page reads `pma = false`. The
pixels agree. In a premultiplied image no color channel can exceed alpha, so for every pixel with `0 < alpha < 255` the test counted how
often `max(r, g, b) <= alpha` holds, over 20 staged PNGs picked across operators and all three kinds. A premultiplied page would pass at
100%, less rounding. No page reached the 99.5% bar: the range was 70.4% (`char_1019_siege2/epoque_50/battle`) to 99.43%
(`char_1001_amiya2/base/back`), with a median of about 92%. Even the closest pages break it by real margins, not rounding: in
`char_485_pallas/base/battle` (99.29%) the 97 failing pixels exceed their alpha by a median of 7 and up to 80.

| PNG | Semi-transparent pixels | `max(r, g, b) <= alpha` |
|---|---:|---:|
| `char_180_amgoat/base/back` | 5,472 | 99.34% |
| `char_499_kaitou/epoque_37/battle` | 16,144 | 72.93% |
| `char_197_poca/rilakkuma_1/dorm` | 178,306 | 72.51% |
| `char_4182_oblvns/base/back` | 42,035 | 86.32% |
| `char_485_pallas/base/battle` | 13,576 | 99.29% |
| `char_117_myrrh/base/dorm` | 59,754 | 85.86% |
| `char_1040_blaze2/winter_5/back` | 24,167 | 93.15% |
| `char_1019_siege2/epoque_50/battle` | 38,667 | 70.40% |
| `char_308_swire/nian_2/dorm` | 82,723 | 91.67% |
| `char_1001_amiya2/base/back` | 7,066 | 99.43% |
| `char_464_cement/base/battle` | 16,054 | 97.79% |
| `char_252_bibeak/winter_2/dorm` | 82,407 | 84.42% |
| `char_201_moeshd/kfc_1/battle` | 9,670 | 97.58% |
| `char_4186_tmoris/base/dorm` | 50,883 | 76.57% |
| `char_4019_ncdeer/ncdeer_1/back` | 7,663 | 96.61% |
| `char_148_nearl/summer_2/battle` | 9,846 | 96.09% |
| `char_4194_rmixer/boc_12/dorm` | 240,718 | 74.21% |
| `char_473_mberry/epoque_14/back` | 6,724 | 98.66% |
| `char_476_blkngt/nian_8/battle` | 10,635 | 98.40% |
| `char_4026_vulpis/base/dorm` | 218,976 | 85.60% |

So `player.ts` decodes every page with `createImageBitmap(..., { premultiplyAlpha: "premultiply" })` and the renderer works in
premultiplied color from there (see `MATH.md`, "Drawing").

**5. A region's bounds are 4 split fields (`xy`, `size`, `orig`, `offset`), not the doc's 2 combined fields (`bounds`, `offsets`).** The
doc describes one `bounds: x, y, w, h` field and one `offsets: offsetLeft, offsetBottom, origW, origH` field. Every region in the corpus
instead uses 4 separate fields in a fixed order: `rotate, xy, size, orig, offset, index` (`char_002_amiya/base/battle/char_002_amiya.atlas`
lines 5-10, region `F_Belt`). `xy` is the packed position, `size` the packed size, `orig` the original size before whitespace stripping, and
`offset` the stripped left and bottom whitespace. `readRegion` reads these 4 keys directly.

**6. `rotate` takes a bare degree number, not just `true`/`false`.** The doc allows this ("Otherwise it may be false for 0 rotation or a
number representing degrees from 0 to 360"), and the corpus uses it: `rotate` is `false` in 149,723 regions, `true` in 95,423, `270` in
1,981 (for example `char_377_gdglow/sanrio_1/battle/char_377_gdglow_sanrio_1.atlas` line 517, region `F_L_Calf`) and `180` in 1,754 (for
example `char_1016_agoat2/base/battle/char_1016_agoat2.atlas` line 118). No other values appear. `readRegion` maps `true` to 90 and `false`
to 0, accepts only 0, 90, 180 and 270, and throws on anything else, since a packed box can only be axis-aligned.

**7. No atlas has more than one page.** All 2,753 files parse to exactly 1 page, matching their PNGs 1 for 1. Since no file contains a
blank line, the only thing that could start a second page never appears.

**8. Region `index` is always -1, and no `split`, `pad` or custom name/value pair appears.** Frame-by-frame regions (a shared name with
different indices) are not used by any staged rig. The doc allows ninepatch `split`/`pad` fields and custom name/value pairs, but since
none appears, `readRegion` throws `AtlasFormatError` on any region key besides `rotate`, `xy`, `size`, `orig`, `offset` and `index`. A
typo like `xyy:` fails instead of leaving the region at 0,0.

One thing that is upstream data, not a format difference: **a region name can carry a trailing space, and it is significant.**
`char_4184_dolris/avemujica_1/dorm/build_char_4184_dolris_avemujica_1.atlas` line 1020 has a region named `F_Weaon_Af3 ` (note the
trailing space), and the sibling skeleton's mesh attachment looks it up by that exact name. Trimming the name line makes 3 attachments in
that rig fail their region lookup, so `readRegion` takes the region name line as-is.
