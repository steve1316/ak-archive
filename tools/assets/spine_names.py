"""
Naming rules for the Spine rig tree.

Upstream lays rigs out as `spine/<operator_id>/<rig_folder>/<kind_folder>/`, each rig folder optionally carrying a skin suffix. The kind
folder names the rig, confirmed by reading the animation names inside a `.skel` rather than by the folder naming pattern: `Spine` holds
`Default`, `Move`, `Relax`, `Sit`, `Sleep` and `Special`, so it is the dorm rig. `Front` and `Back` both hold `Idle`, `Attack*`, `Skill*` and
`Start`, so they are the battle rig - a dorm rig has no camera-facing concept, but a battle rig needs one, hence the two facings.

We republish as `spine/<operator_id>/<key>/<kind>/`, which flattens upstream's kind folders into one addressable shape and keeps each atlas
beside its page image, since an atlas refers to that image by bare filename. `kind` is `battle`, `back` or `dorm` - publishing `back`
separately from `battle` means the two facings never collide on the same path.
"""


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

# Upstream's kind folders, mapped by what their animation names actually are (see the module docstring), not by folder naming pattern.
KIND_FOLDERS = {"Spine": "dorm", "Front": "battle", "Back": "back"}

# The key used when a rig carries no skin suffix.
BASE_KEY = "base"


def parse_rig(path, operator_ids):
    """
    Split an upstream rig path into the operator it belongs to, its variant key and its kind.

    Matches the longest operator id the path starts with, because ids nest: `char_1001_amiya2` must not be read as `char_002_amiya` with
    leftover text. This mirrors `split_stem` in `build_manifest.py`, which solves the same nesting problem for flat filenames.

    Args:
        path: A rig path relative to `spine/`, such as `char_002_amiya/build_char_002_amiya_winter_1/Spine`.
        operator_ids: Every known operator id.

    Returns:
        An `(operator_id, key, kind)` triple, where `key` is `base` for a rig with no skin suffix and `kind` is `battle`, `back` or `dorm`.
        None when the path belongs to no known operator, names no known kind, or is a test rig.
    """
    parts = path.split("/")
    if len(parts) < 3:
        return None

    folder, kind_folder = parts[1], parts[2]
    kind = KIND_FOLDERS.get(kind_folder)
    if kind is None:
        return None

    stem = folder[len("build_"):] if folder.startswith("build_") else folder
    if "_test_" in stem or stem.endswith("_test"):
        return None

    best = None
    for candidate in operator_ids:
        if stem == candidate or stem.startswith(candidate + "_"):
            if best is None or len(candidate) > len(best):
                best = candidate
    if best is None:
        return None

    key = BASE_KEY if stem == best else stem[len(best) + 1:]
    return best, key, kind


def published_dir(operator_id, key, kind):
    """
    Build the published directory for one rig.

    Args:
        operator_id: The operator id.
        key: The variant key, or `base`.
        kind: `battle`, `back` or `dorm`.

    Returns:
        A path relative to the asset root, with forward slashes and no trailing slash.
    """
    return f"spine/{operator_id}/{key}/{kind}"
