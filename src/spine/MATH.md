# Spine runtime maths

How `src/spine/` turns a rig's numbers into positions. Every formula here was derived from what Esoteric's public user guide says a setting
means, never from a Spine runtime's source (see `SOURCES.md`). Where the guide leaves a detail open, the choice made is named and marked
**confirm against PRTS**: the PRTS wiki's viewer render is the reference that settles it. A choice PRTS contradicts is changed here and in the
code, never patched per rig.

`tools/assets/check_spine_math.mjs` checks these formulas with small hand-worked cases: each inherit mode, shear on either axis, skeleton
scale, the zero-length fallback, a few multi-bone chains, and the setup pose's reset and skin lookup.

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
  shear Y turns the Y axis by `shY`, and neither changes an axis's length. **Confirm against PRTS.**
  (https://esotericsoftware.com/spine-tools, "Shear tool")

## World transform

Bones are stored parent first, so one pass in file order computes every world transform.

- **Position.** The tools page says rotation, scale and shear are stored in the bone's own axes but translation is stored in the parent's
  axes. So a bone's world origin is always its parent's full transform applied to its local `(x, y)`, whatever it inherits.
  (https://esotericsoftware.com/spine-tools, "Axes")
- **Basis.** For a bone that inherits everything, the world basis is `P * L`, with `P` the parent's world basis. The bones page says a
  bone's transform affects its child bones, and the tools page's scale example shows a parent's nonuniform scale shearing its children, which
  `P * L` does. (https://esotericsoftware.com/spine-bones, "Bone transforms"; https://esotericsoftware.com/spine-tools, "Scale examples")
- **The root bone's parent is the skeleton.** Its frame is the basis `diag(skeleton.scaleX, skeleton.scaleY)` at `(skeleton.x, skeleton.y)`.
  This is how the page places and flips a whole rig, and it is this runtime's own choice rather than anything in the rig.

## Inherit modes

The bones page's Inherit checkboxes let a bone ignore parts of its parent's transform: rotation, scale and reflection. A `.skel` stores the
combination as one of five transform modes. In every mode the world origin still goes through the full parent transform. Only the basis
changes. With `P = [a b; c d]` the parent's world basis:

- `theta = atan2(c, a)`, the angle of the parent's X axis
- `sx = hypot(a, c)`, `sy = hypot(b, d)`, the lengths of the parent's axes
- `flip = sign(a*d - b*c)`, -1 when the parent's basis is reflected
- `R(t)` is the rotation by `t`

| Mode | World basis | Status |
|---|---|---|
| `normal` | `P * L` | From the guide |
| `onlyTranslation` | `L` | **Confirm against PRTS** |
| `noRotationOrReflection` | `diag(sx, sy) * L` | **Confirm against PRTS** |
| `noScale` | columns of `P * Lrs` at unit length, times `sX` and `sY` | **Confirm against PRTS** |
| `noScaleOrReflection` | as `noScale`, with the Y column negated when `det(P) < 0` | **Confirm against PRTS** |

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
  `noScaleOrReflection`. This is this runtime's choice. Rounding keeps a squashed axis slightly above zero (a bone at rotation 90 gets
  `cos(90)` of about 6e-17, not 0), so any axis shorter than 1e-6 counts as zero length.
- **Reflection off.** Normally a negative scale flips the bone to point the other way, and with Reflection off it does not. `noScale` keeps
  whatever reflection `M` carries from the parent. `noScaleOrReflection` negates the Y column when `det(P) < 0`, which undoes the parent's
  reflection. `noRotationOrReflection` drops it, since `diag(sx, sy)` is never a reflection.
- **Only translation.** The bone ignores its parent's rotation, scale and reflection and keeps only the position.
- A parent basis with a zero determinant counts as unreflected here. A zero scale makes one, and so does a shear that lays the Y axis onto
  the X axis (for example shear Y -90 with shear X 0).

## Skins and the setup pose

- The binary reader names the default skin `"default"` and puts it first. Every staged rig has one, always at index 0.
- A slot's attachment is looked up in the active skin first, then in the default skin. A slot whose setup attachment name is null shows
  nothing. The setup pose resets every bone's local transform to its data, puts the draw order back to slot order, and sets each slot's
  attachment from its setup name.
- A handful of staged rigs keep some setup attachments only in a named skin, so with no skin chosen those slots show nothing until one is.
