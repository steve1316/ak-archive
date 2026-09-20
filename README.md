# Arknights Archive

An unofficial archive for _Arknights_, the mobile game by Hypergryph / Yostar: operators, their art, skills
and lore, in a fast static site.

**Status: not built yet.** This repo is a scaffold. See `PLAN.md` for the phased plan.

Built on [archive-kit](https://github.com/steve1316/archive-kit), the shared framework extracted from
[Griffin Archive](https://github.com/steve1316/gfl-archive).

## Planned for v1

- **Operator Index** - filter by rarity, class, subclass and faction, sort by name, rarity or release, and
  search by name with match highlighting.
- **Operator pages** - stats scaling by level, elite promotion and trust; talents and the six potential
  ranks; a skins gallery in a zoomable art viewer; operator file text and RIIC base skills.

Skills and modules, chibi animations, enemies, a story player and a tower-defence simulator are later phases,
each with its own plan.

## Data and art

Game data comes from community mirrors of the game's own tables and is fetched at build time, never vendored
here. Art is not in this repo either - it loads from
[ak-archive-assets](https://github.com/steve1316/ak-archive-assets) over raw GitHub links, set by
`VITE_ASSET_BASE_URL`.

Game content is © Hypergryph / Studio Montagne / Yostar. This is an unofficial fan project, not affiliated
with or endorsed by them. The site's own source code is GPL-3.0.
