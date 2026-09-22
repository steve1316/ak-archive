# Spine runtime maths

How `src/spine/` turns a rig's numbers into positions. Every formula here was derived from what Esoteric's public user guide says a setting
means, never from a Spine runtime's source (see `SOURCES.md`). Where the guide leaves a detail open, the choice made is named and marked
**confirm against PRTS**: the PRTS wiki's viewer render is the reference that settles it. A choice PRTS contradicts is changed here and in the
code, never patched per rig.

The user compared the setup poses of 8 reference rigs side by side with PRTS and accepted all 8. A choice those rigs exercise is marked
**settled by the PRTS side by side**. A choice they never show (no bone uses it, or no part that uses it is visible) keeps **confirm against
PRTS** until a later comparison covers it.

`tools/assets/check_spine_math.mjs` checks these formulas with small hand-worked cases: each inherit mode, shear on either axis, skeleton
scale, the zero-length fallback, a few multi-bone chains, the setup pose's reset and skin lookup, skin changes, the animation curves,
key search and bone timelines, IK constraints and IK timelines, and the renderer's two-color tint and blend factors.

## Coordinates and angles

- World space is Y-up. Angles are in degrees in the data and are counterclockwise, with 0 pointing along the parent's X axis.
  The tools page says local rotation is the counterclockwise rotation relative to the parent, 0 pointing along the parent's X axis, and
  that world rotation has 0 to the right and 90 up. (https://esotericsoftware.com/spine-tools, "Rotate tool")
- A 2D affine transform is stored as a basis `[a b; c d]` plus an origin `(worldX, worldY)`. The X axis is the column `(a, c)` and the Y axis
  is the column `(b, d)`. A local point `(x, y)` maps to `(a*x + b*y + worldX, c*x + d*y + worldY)`, which is `localToWorld`.

## A bone's local basis

A bone's rotation, scale and shear build its local basis `L = [la lb; lc ld]`:

```
la = cos(r + shX) * sX      lb = cos(r + 90 + shY) * sY
lc = sin(r + shX) * sX      ld = sin(r + 90 + shY) * sY
```

- **Rotation and scale.** The tools page says scale is always applied along the bone's own axes, with the X axis pointing in the direction of
  the bone's rotation. So the X axis is at angle `r` with length `sX`, and the Y axis sits 90 degrees further round with length `sY`.
  Negative scale flips that axis without changing its size, which the formula gives for free. (https://esotericsoftware.com/spine-tools,
  "Scale tool" and "Scale examples")
- **Shear.** The tools page says shear changes the angle between the X and Y axes, and that its X and Y handles each adjust that angle. It
  does not spell out the exact geometry. The reading here is that each shear value tilts its own axis: shear X turns the X axis by `shX`,
  shear Y turns the Y axis by `shY`, and neither changes an axis's length. **Confirm against PRTS**: no reference rig has a sheared bone.
  (https://esotericsoftware.com/spine-tools, "Shear tool")

## World transform

Bones are stored parent first, so one pass in file order computes every world transform. The world transform is built from each bone's
**applied** values, not its local ones. `updateWorldTransform` first copies each bone's local values into its applied ones, then IK changes
only the applied ones (see "IK constraints"). The local values stay as animation wrote them, so running `updateWorldTransform` twice on the
same pose gives the same world values, even at an IK mix below 1.

- **Position.** The tools page says rotation, scale and shear are stored in the bone's own axes but translation is stored in the parent's
  axes. So a bone's world origin is always its parent's full transform applied to its local `(x, y)`, whatever it inherits.
  (https://esotericsoftware.com/spine-tools, "Axes")
- **Basis.** For a bone that inherits everything, the world basis is `Pworld * L`, with `Pworld` the parent's world basis. The bones page
  says a bone's transform affects its child bones, and the tools page's scale example shows a parent's nonuniform scale shearing its
  children, which `Pworld * L` does. (https://esotericsoftware.com/spine-bones, "Bone transforms";
  https://esotericsoftware.com/spine-tools, "Scale examples")
- **The root bone's parent is the skeleton.** Its frame is the basis `S = diag(skeleton.scaleX, skeleton.scaleY)` at
  `(skeleton.x, skeleton.y)`. This is how the page places and flips a whole rig, and it is this runtime's own choice rather than anything
  in the rig. `S` applies to every bone, whatever it inherits: the inherit modes below work on the parent with `S` taken off, and `S` goes
  back on after. So a skeleton flip mirrors a bone that ignores its parent's rotation or reflection too. A skeleton scale of 0 has no
  inverse, so that row of the parent is read as 0, and `S` squashes the bone to 0 on that axis anyway. The references all draw at skeleton
  scale 1, so PRTS says nothing about this rule.

## Inherit modes

The bones page's Inherit checkboxes let a bone ignore parts of its parent's transform: rotation, scale and reflection. A `.skel` stores the
combination as one of five transform modes. In every mode the world origin still goes through the full parent transform. Only the basis
changes. With `P = [a b; c d]` the parent's world basis with the skeleton's scale taken off, `S^-1 * Pworld`:

- `theta = atan2(c, a)`, the angle of the parent's X axis
- `sx = hypot(a, c)`, `sy = hypot(b, d)`, the lengths of the parent's axes
- `flip = sign(a*d - b*c)`, -1 when the parent's basis is reflected
- `R(t)` is the rotation by `t`

| Mode | World basis | Status |
|---|---|---|
| `normal` | `Pworld * L` | From the guide |
| `onlyTranslation` | `S * L` | **Confirm against PRTS** (no visible bone in the references) |
| `noRotationOrReflection` | `S * diag(sx, sy) * L` | **Settled by the PRTS side by side** (7 visible bones across Mudrock, Executor and Skadi) |
| `noScale` | `S` times the unit columns of `P * Lrs`, times `sX` and `sY` | **Settled by the PRTS side by side** (10 visible Mudrock bones) |
| `noScaleOrReflection` | as `noScale`, with the Y column negated when `det(P) < 0` | **Confirm against PRTS** (no visible bone in the references) |

`Lrs` is the local basis with both scales set to 1, so it holds only rotation and shear.

What the bones page says behind each one (https://esotericsoftware.com/spine-bones, "Transform inheritance"):

- **Rotation off.** The bone does not turn when its parents turn, but its world angle can still change when a parent's scale is nonuniform.
  `noRotationOrReflection` keeps the lengths of the parent's axes and drops their direction, so a nonuniform `sx, sy` still bends a rotated
  child's angle. Using the parent's axis lengths for the world axes, even when the parent itself is turned, is this runtime's choice.
- **Scale off.** The bone does not grow or shrink with its parents, but the page says nonuniform parent scale can still change its world
  angle. So `noScale` runs the bone's unit axes through the full parent basis, `M = P * Lrs`, which turns them and bends them the way a
  nonuniform scale does. Then it cuts each column of `M` back to unit length and gives it the bone's own `sX` or `sY`. Angles survive and
  size does not. For example, under a parent scaled `(2, 1)` a child at rotation 45 ends up with its X axis at about 26.6 degrees, not 45.
- **Zero-length axes.** When a parent scale of 0 squashes a column of `M` to zero length, it has no direction to keep. That column falls
  back to `R(theta) * diag(1, flip)` applied to the bone's scaled local axis, the parent's X axis angle alone, with `flip` held at 1 for
  `noScaleOrReflection`. This is this runtime's choice. **Confirm against PRTS**: no reference bone hits it. Rounding keeps a squashed axis
  slightly above zero (a bone at rotation 90 gets `cos(90)` of about 6e-17, not 0), so any axis shorter than 1e-6 counts as zero length.
- **Reflection off.** Normally a negative scale flips the bone to point the other way, and with Reflection off it does not. `noScale` keeps
  whatever reflection `M` carries from the parent. `noScaleOrReflection` negates the Y column when `det(P) < 0`, which undoes the parent's
  reflection. `noRotationOrReflection` drops it, since `diag(sx, sy)` is never a reflection.
- **Only translation.** The bone ignores its parent's rotation, scale and reflection and keeps only the position.
- A parent basis with a zero determinant counts as unreflected here. A zero scale makes one, and so does a shear that lays the Y axis onto
  the X axis (for example shear Y -90 with shear X 0).

## Skins and the setup pose

- The binary reader names the default skin `"default"` and puts it first. Every staged rig has one, always at index 0.
- A slot's attachment is looked up in the active skin first, then in the default skin. The runtime skins page describes this lookup
  (https://esotericsoftware.com/spine-runtime-skins, the opening section).
- The setup pose resets every bone's local transform to its data, puts the draw order back to slot order, and sets each slot's attachment
  from its setup name. A slot whose setup attachment name is null shows nothing. It also copies each slot's color and dark color from its
  data. A slot holds its own copies, so changing them never touches the data.
- `setAttachment` shows the attachment the lookup gives for a name. A null name, or a name neither skin has, clears the slot.
- Changing the skin leaves bone locals and the draw order alone. From no skin, each slot whose setup attachment the new skin has takes it.
  From another skin, a slot showing the old skin's attachment takes the new skin's attachment under the same name, and other slots keep
  theirs. The runtime skins page describes both cases (https://esotericsoftware.com/spine-runtime-skins, "Skin changes"). It does not say
  what happens when the new skin lacks that name. Here the slot takes whatever the lookup gives, which falls back to the default skin, and
  that is this runtime's choice. A caller that wants the new skin's full setup pose resets the pose after.
- With no skin chosen, the player shows `defaultSkinName`: the first non-default skin in file order when a rig has more than one skin, else
  the default skin. 16 staged rigs have more than one, and some keep setup attachments only in their named skin.

## Geometry

`geometry.ts` turns each slot's attachment into world positions, page UVs and triangle indices. The maths gate's geometry cases pin each
rule below with a 256 x 128 page.

### Pooled output

A frame allocates nothing once the pools have grown. Each skeleton keeps one list object per slot and one position array per slot and
length, and `skeletonTriangles` refills the same returned array. So a returned array, its lists and their typed arrays are only valid until
the next `skeletonTriangles` or `slotTriangles` call on the same skeleton. A caller that keeps lists across calls copies them first. Region
lists share one index array, mesh lists use the mesh's own triangles, and UVs come from a per-attachment cache, so nothing in a list may be
changed. The region lookup, the resolved mesh and the page UVs are worked out once per attachment, and again only when the atlas object,
the page-size array, the skeleton data or the slot differ. The atlas and page-size array are compared by identity, so a caller must pass
new ones rather than change them in place.

### Finding the region

An attachment draws the atlas region named by its `path`, or by its own name when `path` is null. Names are matched exactly, trailing spaces
included. The first region with that name across the pages wins.

### The region quad

A region attachment is a `width x height` rectangle centred on its own origin. Its corners are scaled by `scaleX, scaleY` along the
attachment's own axes, turned by `rotation` (counterclockwise, in degrees), moved to `(x, y)` in the bone's space, then put in the world with
`localToWorld`. Corners run bottom-left, bottom-right, top-right, top-left, drawn as triangles `0 1 2` and `2 3 0`.

### Whitespace stripping

The packed image covers only part of the original `originalWidth x originalHeight` image. The atlas format page says `offset` is the
whitespace stripped from the left and bottom edges (https://esotericsoftware.com/spine-atlas-format, "Region sections"). So in the
attachment's y-up space:

```
unitX  = width  / originalWidth         unitY = height / originalHeight
left   = -width/2  + offsetX * unitX    right = left   + packedWidth  * unitX
bottom = -height/2 + offsetY * unitY    top   = bottom + packedHeight * unitY
```

The whitespace above the packed image is `originalHeight - packedHeight - offsetY`, which the same page gives as `offsetTop`. **Settled by
the PRTS side by side**: a wrong strip offset would shift stripped parts off their neighbours.

### UVs and the packed rotation

A point in the packed image is `(px, py)` in pixels, with y pointing down like the page's rows. A region corner uses `(0, h)` for
bottom-left through `(0, 0)` for top-left, where `w x h` is the packed size before rotation. That point lands in the page box at `(qx, qy)`:

| `rotate` | `qx` | `qy` | Box on the page |
|---|---|---|---|
| 0 | `px` | `py` | `w x h` |
| 90 | `py` | `w - px` | `h x w` |
| 180 | `w - px` | `h - py` | `w x h` |
| 270 | `h - py` | `px` | `h x w` |

Then `u = (x + qx) / pageWidth` and `v = (y + qy) / pageHeight`, with the page size read from the PNG.

- **Direction.** The atlas format page says a region with `rotate: true` was "stored in the page image rotated by 90 degrees counter
  clockwise" (https://esotericsoftware.com/spine-atlas-format, "Region sections"). So at 90 the image's top edge becomes the box's left
  edge and its bottom-left corner lands on the box's bottom-right. 270 is the same turn the other way and 180 is upside down. The texture
  packer page only says some images are rotated 90 degrees and gives no direction. **Settled by the PRTS side by side** for 90, 180 and
  270: a wrong direction draws the part upside down, and no reference part was.
  Only the maths gate's rotated case and PRTS can catch a wrong direction. The corpus gate cannot: a turned region keeps its box on the page
  and its quad in the world, so every UV range and bounds number stays the same.

### Mesh UVs

A mesh's `uvs` run 0 to 1 across the region's original image, with v = 0 at the top edge, pointing down. Each maps to the packed image as
`px = u * originalWidth - offsetX` and `py = v * originalHeight - offsetTop`, then through the same table, so a mesh and a region on one
image line up. The meshes page is silent on the v direction. **Settled by the PRTS side by side**: a wrong reading draws the mesh upside
down, and no reference mesh was.

The corpus backs this reading. The texture packer strips whitespace down to the mesh hull (https://esotericsoftware.com/spine-texture-packer,
the setting that uses mesh UVs to strip whitespace). Across the stripped meshes in every 4th staged rig, 2,906 of 2,934 hulls meet the packed
box's edges within 3 pixels under this reading, none do with v pointing up, and none span the full 0-1 range.

The corpus gate keeps checking this. Every mesh on a stripped region, with its UVs mapped by `slotTriangles`, must have its hull meet all
four edges of the packed box within 3 page pixels. At least 95% of meshes must fit overall, and 90% in each `rotate` group of 20 or more. A
flipped v or a wrong strip offset moves the hull off the box. A wrong rotate direction does not, since it turns the whole box onto itself.

### Mesh vertices

These are the setup positions. A deform timeline offsets them first (see "Deform timelines").

- **Plain vertices** are in the slot bone's space: `localToWorld(slot.bone, vx, vy)`.
- **Weighted vertices** add up each influence: `sum(weight * localToWorld(bones[index], bindX, bindY))`. The weights page says each vertex
  carries a weight per bound bone and that the weights sum to 100% (https://esotericsoftware.com/spine-weights, "Adjusting weights"). The
  slot's own bone plays no part. **Settled by the PRTS side by side**: 99.9% of staged rigs use weighted meshes, so
  the references lean on this sum throughout.
- **Linked meshes** share the source mesh's vertices, UVs, triangles and weights, but can use a different image
  (https://esotericsoftware.com/spine-meshes, "Linked meshes"). The source is looked up in the same slot, in the skin the linked mesh names or
  the default skin when it names none. Its region comes from the linked mesh's own `path ?? name`. **Confirm against PRTS**: no linked mesh
  is visible in the references.

### Color

A list's tint is the slot's live color times the attachment's color, channel by channel. A list also carries the slot's live dark color, or
null when the slot has none. The renderer uses both, and the slot's blend mode (see Drawing).

## Drawing

`renderer.ts` draws the lists with WebGL2, in draw order, back to front.

- **Premultiplied color.** The staged PNGs are straight alpha (see `FORMAT-3.8.md`, atlas point 4), so each page is premultiplied when it
  is decoded. The shader's output is premultiplied too. For a slot without a dark color it is the texel times the premultiplied tint
  `(r*a, g*a, b*a, a)`, and the normal blend is `ONE, ONE_MINUS_SRC_ALPHA`: `out = src + dst * (1 - src.a)`. Skipping the premultiply
  would leave bright fringes on soft edges, and premultiplying twice would leave dark ones. **Settled by the PRTS side by side**: the
  references show neither.
- **Two-color tint.** The user guide's slots page says the light color tints the lighter portions of the image and controls opacity, and
  the dark color tints the darker portions. Read as a map of the texture's black to the dark color and its white to the light color, a
  straight texel color `c` gives the straight output `dark + (light - dark) * c`, with alpha `a * light.a`. The output must be
  premultiplied by its own alpha. With a premultiplied texel of rgb `p = a * c` and alpha `a`, that is rgb
  `light.a * (a * dark + (light - dark) * p)` and alpha `a * light.a`. The `light.a` factor matters: without it a slot fading out would keep
  adding color at zero alpha, which draws as a glow. The dark alpha is unused. A slot without a dark color draws with black, which reduces the formula to the plain tint, so
  one shader serves every slot. `tintTexel` in `renderer.ts` works the same formula on the CPU for the maths gate. For example dark
  (0.2, 0, 0), light (1, 1, 1, 1) and texel (0.5, 0.5, 0.5, 1) give (0.6, 0.5, 0.5, 1). This formula is derived, not observed.
  **Confirm against PRTS.**
- **Blend modes.** The slots page names each mode by its Photoshop equivalent: additive is Linear Dodge, and multiply and screen are
  Photoshop's own. In premultiplied colour they are:

  | Mode | Source factor | Destination factor | Result |
  |---|---|---|---|
  | normal | `ONE` | `ONE_MINUS_SRC_ALPHA` | `src + dst * (1 - src.a)` |
  | additive | `ONE` | `ONE` | `src + dst` |
  | multiply | `DST_COLOR` | `ONE_MINUS_SRC_ALPHA` | `src * dst + dst * (1 - src.a)` |
  | screen | `ONE` | `ONE_MINUS_SRC_COLOR` | `src + dst * (1 - src)` |

  A draw call breaks when the page texture or the blend mode changes. **Confirm against PRTS**: no reference rig uses a blend mode other
  than normal.
- **Sampling.** Page textures use LINEAR filtering and CLAMP_TO_EDGE with no mipmaps. The first PNG row is uploaded as v = 0, so the page
  UVs above are used as they are.
- **Projection.** A view rectangle in world units maps onto the whole viewport with y up. The player frames the setup pose's `bounds` once,
  at load, and each draw fits that box into the canvas with 5% of the canvas empty on each side, the aspect kept and the box centred. The
  framing does not follow the pose as it moves, so the camera stays still. `refit` frames the current pose again. `play` frames the
  animation instead: the union of the pose bounds at 8 evenly spaced times from 0 to the duration, fitted the same way. The setup pose can
  hold parts every animation hides, which would leave the figure small and off-centre. A pose between the samples that leaves the box is
  clipped.

## Animation

`animation.ts` samples an animation at a time and writes each bone's local transform, each slot's attachment and colors, and the draw order.
The JSON format page's bone timeline, slot timeline and draw order sections describe each key's value
(https://esotericsoftware.com/spine-json-format). The binary format stores the same values. The maths gate pins every rule below with a case.

A frame is: `setToSetupPose`, then `applyAnimation` applying every timeline in file order, then `updateWorldTransform`. When two timelines
write the same value, the later one wins.

### Curves

Each key's curve runs from that key to the next, so a timeline with `n` keys has `n - 1` curves.

- `stepped` holds the key's value until the next key. `linear` blends in a straight line.
- A bezier `[cx1, cy1, cx2, cy2]` is a cubic from (0, 0) to (1, 1) with those two control points. X is the fraction of the time between the
  two keys and y the fraction of the difference between their values. The page's slot and deform sections say this in those words. Its bone
  section calls the units "frame" and "value", which is the wrong reading for these files: across the 10.0 million bone-timeline beziers in
  the corpus, every control x lies between -0.333 and 1.333, so they are fractions. Control y runs from -37.5 to 37.5, and 34 curves have a
  control y outside [-2, 3], so a bezier may overshoot the two key values.
- To ease a time fraction `t`, bisection over the curve parameter `s` in [0, 1] finds where x equals `t`, in 30 halvings, and gives y
  there. A `t` at or below 0 gives exactly 0, and one at or above 1 gives exactly 1, so every key time shows that key's own value.
- 418 curves have a control x outside [0, 1], so x leaves [0, 1] and crosses 0 or 1 more than once. The search lands on the far crossing,
  so just after a key the value still jumps, even though the ends are exact. For example ulpia's `epoque_48/back` `Skill_3_Begin` has a
  rotate curve `[0, 0.68, -0.286, 0.92]` whose value just after its key is about 0.688, so the bone jumps 69% of the way to the next key
  within the first instant. 15 bone beziers jump by more than 0.001 at a key this way. Which crossing to take is this runtime's choice. **Confirm
  against PRTS** on that ulpia animation.

### Key search

- Most timelines' key times never go down. 943 slot and deform timelines join 2 or 3 sorted runs of keys end to end (see `FORMAT-3.8.md`).
  Key times are split into maximal non-decreasing runs. At a time, the last run whose first key is at or before that time wins, and inside
  it the last key at or before the time. Of several keys with the same time, the last one wins. This is this runtime's choice, since the
  page never describes keys out of order. **Confirm against PRTS.**
- **Before the first key** the timeline does not apply, and the bone keeps its setup value. 24,500 timelines in the corpus start after
  0. The page is silent. **Confirm against PRTS.**
- **After the last key** of a run, that key's value holds.
- The run starts are worked out once per key-time array and cached.

### Bone timelines

Each timeline writes its bone's local value from the setup value, so sampling twice gives the same pose.

| Timeline | Page says the key value is | Local value |
|---|---|---|
| rotate | the rotation relative to the setup pose, 0 if omitted | setup rotation + key angle |
| translate | the X and Y position relative to the setup pose, 0 if omitted | setup x, y + key x, y |
| scale | the X and Y scale relative to the setup pose, 1 if omitted | setup scale x key scale |
| shear | the X and Y shear relative to the setup pose, 0 if omitted | setup shear + key shear |

- **Rotate takes the short way round.** Between two keys the difference `next - prev` is wrapped into [-180, 180) before it is blended.
  The page is silent, so this is measured from the corpus: 63,651 adjacent rotate key pairs differ by more than 180 degrees, most by 330 to
  360. Amiya's back `Attack` bone `B_Belt_B` has keys 0, -343, -31, -333, -16.6, -352.7, 0. Sampled 400 times under this rule it sways
  between -31 and 27 degrees from setup and never moves more than 1.2 degrees between samples. Blended straight, it would spin nearly a
  full turn back and forth. **Confirm against PRTS.**
- **Scale multiplies.** A default of 1 is the identity only for a multiply, and the corpus agrees. For bones whose setup scale is far from
  1 (`|s - 1| > 0.2`), the first scale key in each rig's `Idle` animation (else `Default`, else its first) was compared with 1 and with the
  setup scale, within 0.02. Of 3,985 such axes, 3,757 start near 1, 24 near the setup scale and 204 near neither. Across every animation it
  is 32,557 against 251. Under a replace rule the 3,757 would snap the bone to scale 1 on the first frame. Some of the 24 are a setup
  scale of -1 with a key of -1 (for example `C_Weapon` in `char_1050_chen3`), which a multiply turns to +1. **Confirm against PRTS** on
  those.
- Translate and shear add, as the page says.

### Looping

`loopTime` maps a play time onto the animation: `time mod duration` when looping, `min(time, duration)` when not, and 0 when the duration
is 0. 2,773 of 23,190 staged animations have duration 0. `Animation.duration` is the largest key time, since the binary format stores none.

### Slot timelines

| Timeline | Page says | Rule here |
|---|---|---|
| attachment | the key names "the attachment to set for the slot", with no curve attribute | `setAttachment(slot, name)`, always stepped |
| color | the key holds "the color to set for the slot", with a curve | the blended key color replaces `slot.color` |
| twoColor | the key holds "the light color" and "the dark color" to set, with a curve | light replaces `slot.color`, dark replaces `slot.darkColor` |

- **Attachment is stepped.** The page gives attachment keys no curve, so a key holds until the next. A null name (984,530 of 3,039,474
  keys in the corpus) clears the slot. The page does not mention a null name. A name that neither the active skin nor the default skin
  has also clears it, as `setAttachment` does.
- **Color replaces.** "The color to set" reads as a replace, not a multiply of the setup color. Channels blend one by one along the curve,
  the same way bone values do, and are written into the slot's own color objects in place.
- **Channels are clamped to [0, 1].** The page says a slot curve's y runs "from 0 to 1", but 62 of 104,118 color and two-color beziers in
  the corpus have a control y outside it, and 26 of those take a channel outside [0, 1], by up to 0.023 (chyue's battle `Skill_3`, slot 8
  alpha). A color channel past either end has no meaning, so it is clamped. The page is silent on this, so it is this runtime's choice.
- **The dark alpha is unused.** Two-color keys write only the dark RGB. The dark alpha keeps the setup value (see `FORMAT-3.8.md`, point 6).
- **Two-color on a slot with no dark color** writes the light color and ignores the dark keys. The page is silent. The corpus has none:
  the `--animation` gate counts 0 of 16,646 two-color timelines on such a slot.
- **Before the first key** the setup attachment or color stays, as for bones. Attachment and color timelines are where the sorted runs of
  keys occur, and the key search rule above covers them.

### Draw order

The page says each key lists slots with "the number of draw order entries to shift the specified slot relative to its setup pose draw
order index", and that a key with no offsets "will set the draw order to the setup pose draw order". Offsets are signed (see
`FORMAT-3.8.md`, point 7).

- Draw order keys are always stepped. The page gives them no curve. Before the first key the setup order stays.
- A key with no changes (12,859 of 49,102 keys in the corpus) writes the setup order.
- Otherwise each changed slot goes to place `slotIndex + offset`. The unchanged slots then fill the free places from the front, in their
  setup order. The page is silent on how the unchanged slots fill in, so this is this runtime's choice. **Confirm against PRTS.**
- A key that moves a slot twice, out of range, or onto a taken place would not give a permutation. It writes the setup order instead. The
  corpus has no such key.
- The order is written into `skeleton.drawOrder` in place, with work arrays kept per skeleton.

### Allocation

`applyAnimation` allocates nothing per call once each timeline and skeleton has been seen. That holds whether or not V8 inlines its
helpers. The eased fraction is kept in a `Float64Array`, which stores a double in place. A module `let` would box a new number on each
write. The time fraction goes into that array before the curve is eased too, rather than as an argument: when an animation mixes every
timeline type, V8 runs out of inlining budget, and a fresh double passed to the non-inlined curve helper was boxed once per interpolated
key. No helper in the hot path returns a number: the bezier search writes its result into that array, and the bone blends are written
out where they are used. Colors are written into the slot's own color objects. Measured with gc between rounds of 5,000 calls, dusk
`nian_12` dorm `Special` and SilverAsh base battle `Idle` both settle at 16 to 17 bytes per call, the harness's own floor, with and without
`--no-concurrent-recompilation`.

| Slots | Changes | Order |
|---|---|---|
| 4 | slot 3, offset -2 | 0, 3, 1, 2 |
| 4 | slot 0, offset 2 | 1, 2, 0, 3 |
| 4 | none | 0, 1, 2, 3 |

### Corpus check

`check_spine_rigs.mjs --animation` samples every animation of every staged rig at 8 evenly spaced times from 0 to its duration. Each frame
must have finite positions, UVs and colors, every color channel in [0, 1], and a draw order that is a permutation of the slots. Each color
and two-color timeline is also applied on its own. At each key time the slot must show that key's color. A quarter of the way along each
linear segment it must show a straight blend of the two keys, so a blend run backwards fails. Keys that share a time, and timelines with
more than one sorted run, are skipped.

### IK timelines

An IK key holds the constraint's mix, softness, bend direction, compress and stretch. Mix and softness blend along the key's curve like a
bone value. Bend direction, compress and stretch are on/off values, so they hold from the key until the next. The IK page says each of them
can be keyed. The page does not say how they blend, so this is this runtime's choice. `setToSetupPose` puts every constraint's values back
to its data.

### Deform timelines

A deform key stores `count` floats starting at `start` (see `FORMAT-3.8.md`, point 4). The meshes page's "Deformation" section says only
vertex positions are keyed and that interpolation between deform keys moves the vertices in a straight line
(https://esotericsoftware.com/spine-meshes).

- **The values are offsets, not positions.** For an unweighted target, values `2i, 2i+1` are added to vertex `i`'s setup `x, y`, in the
  slot bone's space. For a weighted target, values `2k, 2k+1` are added to influence `k`'s bind position, in that influence's bone space,
  before the weighted sum. Values outside a key's `[start, start + count)` are 0. Evidence: every key's `start + count` fits 2 per vertex,
  or 2 per influence when weighted. Keys with count 0 are common, and read as positions they would collapse a mesh to a point.
- **Which attachment a timeline drives.** It applies only when `deformSource` of the slot's current attachment is the very object
  `skins[skinIndex]` holds for that slot and name. `deformSource` follows a linked mesh to its parent while the linked mesh's `deform`
  flag is set. The JSON format page describes the flag as inheriting the parent's deform timelines, and the meshes page's "Linked meshes"
  section calls it "Inherit timelines". 267 of the 324 linked meshes set it, and 57 whose parents are deformed do not. Comparing by
  identity also settles skins: a same-named attachment in another skin is a different object.
- **Timing** follows the other timelines: the sorted runs rule, no effect before the first key, the last key holds, and the curve eases
  between keys. At eased fraction `p` each value is `a + (b - a) * p` over the target's full length, with zeros outside each key's range.
  The result goes into `slot.deform`, and `slot.deformLength` becomes the full length.
- **Resetting.** `setToSetupPose` sets every `deformLength` to 0. So do `setAttachment`, `setSkin` and the attachment timeline, whenever
  the slot's attachment actually changes. Attachment timelines come before deform timelines in the file, so a swap and then a deform in the
  same frame works.
- **Sizing.** Each slot's `deform` array is made once, when the `Skeleton` is built, at the largest target length any deform timeline
  names for that slot.
- `computeWorldVertices` is the one place vertices meet bones, with the offsets added only when `deformLength` matches the vertices. The
  mesh triangles use it.

`check_spine_rigs.mjs --animation` applies each deform key on its own to its target at the key's own time and requires exactly that key's
offsets. Across the corpus, 2,175,893 keys compare. Of 1,639,020 deform timelines (counted once per animation), 1,166,836 find their
attachment in the slot at some one of the 8 samples and 472,184 never do. Dropping the zero fill fails 2,225 rigs. Allocation is
unchanged: `applyAnimation` plus `skeletonTriangles` measure 15.9 bytes per frame on Mudrock base battle `Attack` (27 slots deformed at
once) and Executor base battle `Attack_A` (81), the same as before deform, which is the harness floor.

### Not applied yet

Transform, path and event timelines are skipped for now.

## IK constraints

`constraints.ts` solves IK. The IK constraints page (https://esotericsoftware.com/spine-ik-constraints) says what each setting does. The
maths is plane geometry: aiming a bone at a point, and the law of cosines for a two-bone chain. Where the page leaves a choice open, the
staged corpus decided it, and the evidence is below.

### Order

After the plain pass over the bones, the constraints run in ascending `order`. Before each solve, the chain's parent and the target have
up-to-date world transforms. After it, the chain's first bone and all its descendants are recomputed, in parent-first order. The list of
constraint steps is sorted once when the skeleton is built, so transform and path constraints can join it later.

### The space the solve works in

The target's world position is taken relative to the first bone's world origin. It is then mapped back through the basis that the bone's
local axes go through, so every angle and length below is in that space:

| First bone's mode | Basis |
|---|---|
| `normal`, `noScale`, `noScaleOrReflection` | the parent's world basis, or `S` for the root |
| `onlyTranslation` | `S` |
| `noRotationOrReflection` | `S * diag(sx, sy)`, with the parent's axis lengths as in "Inherit modes" |

For the `noScale` modes, cutting an axis back to unit length does not change its direction, so the parent's basis still gives the right
angles. A scaled, rotated or reflected parent is handled once, by this mapping.

Corpus evidence, over 2,748 rigs (2,685 with IK), for chains with setup mix 1. Each chain is solved alone on its own setup pose.

- **One bone.** 1,940 chains have their target within 0.01 of the bone's line, and all 1,940 solve back to their setup rotation within 0.5
  degrees. Without the mode-aware basis (the parent's basis for every mode), 22 of them miss, all `noScale` or `noRotationOrReflection`
  bones, some by over 120 degrees. With world angles instead of the parent's space, 29 of 1,940 match. Past a gap of 0.01 the solve turns
  the bone by exactly `asin(gap / distance)`, the turn that closes the gap. That held for all 4,388 chains with a gap below 0.5.
- **Two bones.** See "Bend direction".

### One bone

- The desired rotation points the bone's X axis at the target: `atan2(ty, tx)` minus the angle of the bone's X axis at rotation 0. That
  angle is `atan2(sin(shearX) * scaleX, cos(shearX) * scaleX)`: the shear, turned by 180 when scale X is negative.
- The applied rotation is `rotation + (desired - rotation) * mix`, with the difference wrapped into [-180, 180). The page says mixing uses
  the shortest rotation direction.
- **Compress** (one bone only, per the page): when the target is closer than the bone's length times `|scaleX|`, scale X is multiplied by
  `distance / length`. **Stretch**: the same when the target is farther. **Uniform** multiplies scale Y by the same factor. The factor is
  blended as `1 + (factor - 1) * mix`. A bone with length 0 cannot compress or stretch.

### Two bones

With the page's limits below applied, the parent's local basis is `R(rotation) * diag(sx, sy)`. In the parent's space:

- `a` is the length of `diag(sx, sy) * (child.x, child.y)`, the distance from the parent's origin to the child's, and `phi` is its angle.
- `b` is the length of `diag(sx, sy) * R(childRotation) * (childScaleX * length, 0)` turned by the child's shear: the child's tip offset.
  It does not depend on the child's rotation when the parent's scale is uniform.
- With `d` the distance to the target and `theta` its angle, the law of cosines gives the parent's interior angle
  `alpha = acos((a^2 + d^2 - b^2) / (2 * a * d))`, with the cosine clamped to [-1, 1].
- The parent's direction to the child's origin is `theta - bendDirection * alpha`, so the parent's rotation is that minus `phi`.
- The child aims from its new origin at the target: that offset is turned back by the parent's rotation, divided by `(sx, sy)`, and the
  child's rotation is its angle minus the angle of the child's own X axis at rotation 0.
- When `d > a + b`, `alpha` is 0 and the chain lies straight toward the target. When the target is too close to reach (`d < |a - b|`), the
  chain folds flat along the line to it.
- Both rotations blend by the mix, the short way round. The child's position is not changed, except by the page's Y rule below.

### Bend direction

The page says that with "Positive" checked, the child turns counterclockwise (positive) relative to the parent. So `bendDirection` 1 takes
the solution with the parent's direction at `theta - alpha`, in the parent's space.

The corpus agrees. For 4,992 two-bone chains with setup mix 1 whose child's tip is within 0.5 of the target, both mirror solutions were
solved. When the two differ by at least 4 degrees at the child, 97.4% of setup poses sit nearer this convention's solution than the
mirror one (4,450 of 4,570). The flipped sign gets 2.6%, and world angles instead of the parent's space get 96.1% (4,286 of 4,458), but they
also fail the one-bone check above. The other 422 chains are too straight to tell apart. The strict test, with both setup rotations
reproduced within 0.5 degrees, gives only 56% on the same chains. A near-straight chain turns by degrees to close a gap of a fraction of
a unit. Some chains are also posed in the opposite bend to their own `bendDirection`, so the mirror solution reproduces both setup rotations
within 0.5 degrees: 130 of the 4,992 chains with a gap below 0.5, and 84 of the 1,790 with a gap below 0.01.

### Stretch

When stretch is on and the target is past `a + b`, the parent's local scale X is multiplied by `d / (a + b)` (and scale Y when uniform).
The child is not scaled locally, but it inherits the parent's scale, so both bones grow by that factor in the world and the straight chain
ends on the target. For example, two bones of length 10 with the target at 30 get the parent's scale X to 1.5, the child's local scale X
stays 1, and both bones' world X axes are 1.5 long. The page says stretch scales "the bones". This reading keeps the tip on the target.
Scaling the child locally as well would put it at 37.5. The factor is blended as `1 + (factor - 1) * mix`. **Confirm against PRTS.**

### The page's two-bone limits

The IK page lists these, and the runtime follows them. **Confirm against PRTS**:

- Stretch does nothing when softness is above 0, or when the parent's local scale is nonuniform (`||sx| - |sy|| > 1e-4`).
- The child's local Y is set to 0 when stretch is on, and when the parent's local scale is nonuniform. 5,613 of the corpus's 8,707
  two-bone chains have a child setup Y above 0.01 in size. This rule changes 132 of them: 125 with stretch set in the data or keyed on, and 7
  under a nonuniform parent.
- The parent's local shear is set to 0. Two chains in the corpus have a parent with shear.
- These changes go to the applied values, so the animation's own values are untouched.

### Softness

The page says softness slows the bones as the chain straightens. The value is how far short of full reach the slowing starts, and the chain
is only fully straight once the target is that far past full reach. With `R = a + b` and softness `s > 0`, a target distance `d` past
`R - s` is eased to

```
x = d - (R - s)
d' = R - s + x - x^2 / (4 * s)    for x < 2 * s
d' = R                            for x >= 2 * s
```

`d'` meets `d` with the same slope at `R - s`, and reaches `R` with slope 0 at `R + s`. When `s` is larger than `R`, a near target would ease to a
negative distance and fold the chain backward, so `d'` stops at 0. At 0 the parent points at the target and the child folds back toward
the parent's origin. In the corpus, softness is at most 0.197 of the reach, so no rig reaches this. The chain solves for `d'` along the line to the
target. Softness is taken in the parent's space, the same units as `a` and `b`. The quadratic is this runtime's choice, since the page gives
no formula. **Confirm against PRTS** (267 constraints use softness).

### Allocation

Solving allocates nothing. The target and the basis go through a module `Float64Array`, the short-turn wrap is written out where it is
used, and no helper in the path returns a number. `Math.hypot` allocates in V8 on every call, so lengths use `Math.sqrt` of a sum of
squares. That applies in `updateBone` too, where the world basis is also written out in place, since passing the numbers to a helper
boxed them whenever V8 did not inline it. V8's sampling heap profiler, over 5,000 frames of `setToSetupPose`, `applyAnimation` and
`updateWorldTransform`, attributes 0 bytes to `updateWorldTransform`, `updateBone` and the solver on Mudrock base battle `Attack` (21 IK
constraints) and Amiya base battle `Attack`. `applyAnimation` profiles at 0 too, including philae `nian_12` dorm `Special`, which mixes every timeline type.

### Corpus check

`check_spine_rigs.mjs --ik` runs over every rig with IK:

- **Setup pose.** One-bone chains with setup mix 1 and a gap below 0.01 must solve back to their setup rotation within 0.5 degrees, in at
  least 99% of cases. Two-bone chains with setup mix 1 and a gap below 0.5, whose mirrors differ by at least 4 degrees, must sit nearer
  their bend's solution in at least 95% of cases. The strict gap-0.5 angle rates are printed for information.
- **Animation.** Every animation, sampled 8 times. Solved rotations and scales must be finite. A chain at mix 1 without stretch must point
  at its target (one bone) or end on it or on the line to it (two bones), within 0.01. Chains that a later constraint can move are left out
  of the reach check, and so are two-bone chains under a nonuniform parent or with a non-normal bone, where the solve is not exact.
