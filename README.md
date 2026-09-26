# Arknights Archive

An unofficial archive for _Arknights_, the mobile game by Hypergryph / Yostar: operators, enemies and the story, with their art and Spine chibis. It runs entirely in the browser and is hosted on GitHub Pages.

**[Open Arknights Archive](https://steve1316.github.io/ak-archive/)**

[![Deploy](https://github.com/steve1316/ak-archive/actions/workflows/deploy.yml/badge.svg)](https://github.com/steve1316/ak-archive/actions/workflows/deploy.yml)
[![Refresh game data](https://github.com/steve1316/ak-archive/actions/workflows/refresh.yml/badge.svg)](https://github.com/steve1316/ak-archive/actions/workflows/refresh.yml)
[![Last commit](https://img.shields.io/github/last-commit/steve1316/ak-archive)](https://github.com/steve1316/ak-archive/commits/master)
[![License](https://img.shields.io/github/license/steve1316/ak-archive)](LICENSE)

![An operator page with its chibi](https://raw.githubusercontent.com/steve1316/ak-archive-assets/main/readme/operator-page.webp)

## Features

- **Operator Index** - filter by rarity, class, faction, position, tag and release year, search by name, and sort by rarity, name or Global release.
- **Operator pages** - stats by elite phase, level and potential, skills at any level, talents, potentials and modules, the profile and handbook files, and every skin in a zoomable full-art viewer.
- **Animations** - battle and dorm chibis, front and back, played by the site's own Spine 3.8 runtime.
- **Enemy Index** - every enemy with its variants grouped, filtered by level, faction, attack and damage type, with stats by level, abilities, handbook text and chibis.
- **Story player** - read the main story, 50 events, 19 side stories and 319 operator records in the browser, with the game's own backgrounds, character art, music and sound effects. Branching scenes let you pick, and it reads on a phone in either orientation.
- **Always current** - a daily job picks up new operators, skins, enemies and stories from the game data.

<p>
  <img src="https://raw.githubusercontent.com/steve1316/ak-archive-assets/main/readme/operator-index.webp" width="49%" alt="The Operator Index filtered to 6-star operators">
  <img src="https://raw.githubusercontent.com/steve1316/ak-archive-assets/main/readme/stories.webp" width="49%" alt="The Main Theme story picker">
</p>

![The story player in the prologue](https://raw.githubusercontent.com/steve1316/ak-archive-assets/main/readme/story-player.webp)

## Running locally

You need Node 22 and pnpm, which ships with Node through corepack.

```sh
corepack enable
pnpm install
pnpm dev          # dev server at http://localhost:5173/ak-archive/
pnpm typecheck    # type check only
pnpm build        # type check, then a production build into build/
pnpm preview      # serve the production build
pnpm test:data    # data pipeline tests
```

To serve the production build the way GitHub Pages does, but from the site root, run `docker compose up --build` and open http://localhost:8088.

Art is not in this repo. Operator and enemy art loads from [ak-archive-assets](https://github.com/steve1316/ak-archive-assets), set by `VITE_ASSET_BASE_URL` in `.env`, and the story's art and audio from [ak-archive-story](https://github.com/steve1316/ak-archive-story), set by `VITE_STORY_ASSET_BASE_URL`.

## How it works

- **`src/`** - the site: React 19, TypeScript and MUI, built with Vite on [archive-kit](https://github.com/steve1316/archive-kit). Game data ships as generated JSON, and each page loads only what it needs.
- **`src/spine/`** - a Spine 3.8 runtime written for this site from Esoteric Software's public format docs, since the official runtimes start at 4.0.
- **`tools/data/`** - imports operator and enemy data from the game's tables, builds the release dates, and checks the result.
- **`tools/story/`** - parses the game's own story scripts into the scenes the story player reads.
- **`tools/assets/`** - Python tools (Python 3.12) that fetch art, chibi rigs and story assets from community mirrors, encode them to WebP, and publish them to the asset repos.
- **`.github/workflows/`** - `deploy.yml` publishes the site on every push to `master`. `refresh.yml` runs daily, imports anything new, and deploys only if something changed.

## Data sources

- **Game data** - [ArknightsGamedata](https://github.com/ArknightsAssets/ArknightsGamedata) (Global), with [ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData) (CN) for old event stages the Global client no longer ships.
- **Release dates and story music titles** - the [Arknights Wiki](https://arknights.wiki.gg/) under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **Art, chibis and story assets** - [ArknightsResource](https://github.com/fexli/ArknightsResource), [Ark-Models](https://github.com/isHarryh/Ark-Models) and [ArknightsAssets2](https://github.com/ArknightsAssets/ArknightsAssets2), extracted from the game's own files.

_Arknights_ and its characters, art and data are © Hypergryph / Studio Montagne / Yostar. This is an unofficial fan project and is not affiliated with or endorsed by them.

## License

The code is licensed under [GPL-3.0](LICENSE).
