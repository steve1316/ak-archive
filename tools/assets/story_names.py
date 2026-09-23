"""
Naming rules for the story assets: which upstream file each reference the stories make resolves to, and where it is published.

The stories name assets by bare keys - `bg_cher_1`, `avg_2_2`, `char_002_amiya_1#7`, `Sound_Beta_2/Music/.../m_dia_escape_intro` - and the mirror
stores them under folders whose naming changed over the game's life. Sprites are the tangle: `avg_npc_484_1#5$1` is a file of that exact name in
the `avg_npc_484_1` folder, `char_002_amiya_1#7` is `char_002_amiya_7.png` in `char_002_amiya_1`, and `avg_npc_061#3` is `avg_npc_061_3.png` in
`avg_npc_061`, with face 1 dropping its suffix in the last two. So each reference is tried against the real listing in a fixed order rather than
derived from one rule. Case is ignored throughout, since the scripts and the mirror disagree on it.
"""

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

# The kinds of reference `src/data/story-asset-refs.json` lists.
REFERENCE_KINDS = ("backgrounds", "images", "items", "sprites", "music", "sounds")

# The kinds `src/data/story-assets.json` records. Music and sounds share `audio`, and covers and map art come from the story index.
MANIFEST_KINDS = ("backgrounds", "images", "items", "sprites", "audio", "covers", "maps")

# Reference kinds found by file name alone, each in its own flat folder.
IMAGE_KINDS = ("backgrounds", "images", "items")

# The map art file names tried for main episode N, in order.
MAP_NAMES = ("zone_map_{n}_up.png", "main_{n}_up.png", "zone_map_{n}_1.png")

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Keys and paths


def sprite_key(name):
    """
    The published key of a sprite, the same rule as `spriteKey` in `tools/story/keys.mjs`.

    Args:
        name: The upstream sprite name, such as `char_002_amiya_1#7`.

    Returns:
        The name lowercased with `#` and `$` turned into `-`.
    """
    return name.lower().replace("#", "-").replace("$", "-")


def manifest_kind(kind):
    """
    The manifest kind a reference kind is recorded under.

    Args:
        kind: A reference kind, or `covers` / `maps`.

    Returns:
        `audio` for music and sounds, the kind itself otherwise.
    """
    return "audio" if kind in ("music", "sounds") else kind


def manifest_key(kind, key):
    """
    The key a published asset is recorded under in the manifest.

    Args:
        kind: A reference kind, or `covers` / `maps`.
        key: The reference, or the group id for covers and maps.

    Returns:
        The sprite key for sprites, the group id for covers and maps, and the lowercased reference otherwise.
    """
    if kind == "sprites":
        return sprite_key(key)
    if kind in ("covers", "maps"):
        return key
    return key.lower()


def published_path(kind, key):
    """
    Where an asset is published in the story asset repo.

    Args:
        kind: A reference kind, or `covers` / `maps`.
        key: The reference, or the group id for covers and maps.

    Returns:
        The path, such as `sprites/char_002_amiya_1-7.webp` or `audio/sound_beta_2/music/m_a.mp3`.
    """
    folder = manifest_kind(kind)
    if folder == "audio":
        return f"audio/{manifest_key(kind, key)}.mp3"
    return f"{folder}/{manifest_key(kind, key)}.webp"


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Resolving


def index_by_name(files):
    """
    Index listed files by lowercased file name. When two files share a name, the first listed wins.

    Args:
        files: Listing entries with a `path`.

    Returns:
        A dict of lowercased file name to entry.
    """
    index = {}
    for item in files:
        index.setdefault(item["path"].rsplit("/", 1)[-1].lower(), item)
    return index


def index_by_path(files):
    """
    Index listed files by lowercased path.

    Args:
        files: Listing entries with a `path`.

    Returns:
        A dict of lowercased path to entry.
    """
    return {item["path"].lower(): item for item in files}


def sprite_candidates(name):
    """
    The paths under `avg/characters` a sprite may be stored at, most specific first.

    Args:
        name: The upstream sprite name.

    Returns:
        Lowercased candidate paths, without repeats.
    """
    lowered = name.lower()
    if "#" in lowered:
        base, rest = lowered.split("#", 1)
        face = rest.split("$", 1)[0]
        candidates = [f"{base}/{lowered}.png"]
        if base.endswith("_1"):
            candidates.append(f"{base}/{base[:-2]}_{face}.png")
        candidates.append(f"{base}/{base}_{face}.png")
        if face == "1":
            candidates.append(f"{base}/{base}.png")
        candidates += [f"{base}_{face}.png", f"{lowered}.png"]
        if face == "1":
            candidates.append(f"{base}.png")
    else:
        base = lowered.split("$", 1)[0]
        candidates = [f"{base}/{lowered}.png", f"{lowered}/{lowered}.png", f"{lowered}.png"]
    return list(dict.fromkeys(candidates))


def resolve(kind, key, indexes):
    """
    Find the upstream file a reference points at.

    Args:
        kind: A reference kind.
        key: The reference.
        indexes: Listing indexes by role, from `index_by_name` or `index_by_path`.

    Returns:
        The listing entry, or None when the mirror has no such file.
    """
    if kind in IMAGE_KINDS:
        return indexes[kind].get(f"{key.lower()}.png")
    if kind == "sprites":
        characters = indexes["characters"]
        return next((characters[candidate] for candidate in sprite_candidates(key) if candidate in characters), None)
    return indexes["audio"].get(f"{key.lower()}.mp3")


def cover_entry(tab, group, indexes):
    """
    Find a group's cover: a main episode's `mainmission` card, or an event's or side story's entry picture.

    Args:
        tab: `main`, `events` or `side`.
        group: The group's story index entry, with `id` and `cover`.
        indexes: Listing indexes by role.

    Returns:
        The listing entry, or None when there is no cover.
    """
    if tab == "main":
        return indexes["mainmission"].get(f"{group['id'].lower()}.png")
    if not group.get("cover"):
        return None
    return indexes["hubs"].get(f"{group['cover'].lower()}.png")


def map_entry(group_id, indexes):
    """
    Find a main episode's map art.

    Args:
        group_id: The group id, such as `main_11`.
        indexes: Listing indexes by role.

    Returns:
        The listing entry, or None for an episode without map art or a group that is not a main episode.
    """
    if not group_id.startswith("main_"):
        return None
    number = group_id[len("main_") :]
    return next((indexes["zonemaps"][name.format(n=number)] for name in MAP_NAMES if name.format(n=number) in indexes["zonemaps"]), None)
