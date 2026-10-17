# Story engine: known gaps

`node tools/story/audit_coverage.mjs` lists every command and argument the story data uses that `src/pages/story/engine.ts` does not read.
The guard test fails when that list changes without `engine-coverage.json` being refreshed (`node tools/story/audit_coverage.mjs --write`).
This page says why each remaining gap is left, so a new gap is easy to tell from an accepted one.

## Needs art the site does not have

- `bgeffect`, `effect`: particle and prefab effects from the game client (sparks, snow, fire, signal noise).
- `interlude`: cut-in masks (`ui_cutin_mask_*`).
- `avgdisplay`, `theater`, `showitem`, `hideitem`, `imagerotate`: UI overlays and item art.

## Needs a reference to get right

Their effect is not written down anywhere, and a guess would look wrong. Compare against a recording before implementing.

- `largebg`, `gridbg`, `verticalbg` (`solidwidth`, `solidheight`, `x`, `y`) and `largebgtween`: panning strips of several images. The strip origin is unclear.
- `blocker.initr`: always 2 and never with a style. Probably a radial start.
- `charslot.iscopy`, `end`, `glitch`, `random`, `matname`, and `character.blok`.
- `cgitem.layer`, `style`, `afrom`, `ato`, `aduration`, `rfrom`, `rto` (fade and rotation of an art scene), and `image.xscalefrom`, `yscalefrom`.
- `focusout.id`, `curtain.a`, `curtain.afrom`, `curtain.ato`, `subtitle.afrom`, `subtitle.ato`, `blocker.image`.

## Already covered another way, or no visible effect

- `animtext.id`, `name`, `style`: the style only names which of place and time are present, and those lines are drawn when present.
- `background.width`, `height`, `tiled`: scale factors that match `xscale` and `yscale` in the data.
- `cameraeffect.initamount`: 0 in nearly every use, which is where the fade already starts. `from` and `to` are chaos-effect names.
- `charslot.afrom`: the engine reads `ato`, since `afrom` equals it or is 0 or 1 in all but a few uses.
- `sticker.hidelog`: only affects the log, which does not list stickers.
- Misspelt arguments in the scripts (`fadetiem`, `isblocke`, `foucs`, `xsclae`), which the game ignores too.
