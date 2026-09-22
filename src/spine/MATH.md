# Spine runtime maths

How `src/spine/` turns a rig's numbers into positions. Every formula here was derived from what Esoteric's public user guide says a setting
means, never from a Spine runtime's source (see `SOURCES.md`). Where the guide leaves a detail open, the choice made is named and marked
**confirm against PRTS**: the PRTS wiki's viewer render is the reference that settles it. A choice PRTS contradicts is changed here and in the
code, never patched per rig.

The user compared the setup poses of 8 reference rigs side by side with PRTS and accepted all 8. A choice those rigs exercise is marked
**settled by the PRTS side by side**. A choice they never show (no bone uses it, or no part that uses it is visible) keeps **confirm against
PRTS** until a later comparison covers it.

`tools/assets/check_spine_math.mjs` checks these formulas with small hand-worked cases: each inherit mode, shear on either axis, skeleton
scale, the zero-length fallback, a few multi-bone chains, the setup pose's reset and skin lookup, and skin changes.

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

Bones are stored parent first, so one pass in file order computes every world transform.

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
null when the slot has none. The renderer ignores the dark color for now and draws every slot with the normal blend (see Drawing).

## Drawing

`renderer.ts` draws the lists with WebGL2, in draw order, back to front.

- **Premultiplied color.** The staged PNGs are straight alpha (see `FORMAT-3.8.md`, atlas point 4), so each page is premultiplied when it
  is decoded. A list's tint is premultiplied too, as `(r*a, g*a, b*a, a)`. The fragment color is the texel times the tint, which stays
  premultiplied, and it blends with `ONE, ONE_MINUS_SRC_ALPHA`: `out = src + dst * (1 - src.a)`. Skipping the premultiply would leave
  bright fringes on soft edges, and premultiplying twice would leave dark ones. **Settled by the PRTS side by side**: the references show
  neither.
- **Blend modes.** Every list uses that normal blend for now, whatever its slot's `blendMode`. Additive, multiply and screen come later.
- **Sampling.** Page textures use LINEAR filtering and CLAMP_TO_EDGE with no mipmaps. The first PNG row is uploaded as v = 0, so the page
  UVs above are used as they are.
- **Projection.** A view rectangle in world units maps onto the whole viewport with y up. The player frames the setup pose's `bounds` once,
  at load, and each draw fits that box into the canvas with 5% of the canvas empty on each side, the aspect kept and the box centred. The
  framing does not follow the pose as it moves, so the camera stays still. `refit` frames the current pose again.
