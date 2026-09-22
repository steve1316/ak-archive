"""
Naming rules for the Spine rig tree.

Upstream lays rigs out as `spine/<operator_id>/<rig_folder>/<kind_folder>/`, each rig folder optionally carrying a skin suffix. The kind
folder names the rig, confirmed by reading the animation names inside a `.skel` rather than by the folder naming pattern: `Spine` holds
`Default`, `Move`, `Relax`, `Sit`, `Sleep` and `Special`, so it is the dorm rig. `Front` and `Back` both hold `Idle`, `Attack*`, `Skill*` and
`Start`, so they are the battle rig - a dorm rig has no camera-facing concept, but a battle rig needs one, hence the two facings.

One exception, also read from the animation names: a few operators ship their battle rig in a plain `char_.../Spine` folder beside the real
dorm rig in `build_char_.../Spine` (Skadi the Corrupting Heart and Sora), and have no `Front` folder. A plain `Spine` folder with no `build_`
twin is still the dorm rig, as in nine forms such as Ifrit's `kfc_1`. `resolve_kind` applies that rule.

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

# Upstream rig folders whose operator part is misspelled, mapped to the operator id it should have been.
FOLDER_ALIASES = {"char_107_liskarm": "char_107_liskam"}


def rig_stem(folder):
    """
    Strip a rig folder down to its operator id and skin suffix.

    Drops the dorm rig's `build_` prefix in any case, since upstream also ships `Build_char_440_pinecn`, and repairs a misspelled operator
    part from `FOLDER_ALIASES`. The skin suffix keeps its upstream spelling.

    Args:
        folder: An upstream rig folder name, such as `build_char_002_amiya_winter_1`.

    Returns:
        The stem, such as `char_002_amiya_winter_1`.
    """
    stem = folder[len("build_"):] if folder.lower().startswith("build_") else folder
    for wrong, right in FOLDER_ALIASES.items():
        if stem.lower() == wrong or stem.lower().startswith(wrong + "_"):
            return right + stem[len(wrong):]
    return stem


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

    stem = rig_stem(folder)
    if "_test_" in stem or stem.endswith("_test"):
        return None

    # Upstream sometimes capitalises the id itself, as in `build_Char_294_ayer`, so the id is matched without case.
    lowered = stem.lower()
    best = None
    for candidate in operator_ids:
        if lowered == candidate or lowered.startswith(candidate + "_"):
            if best is None or len(candidate) > len(best):
                best = candidate
    if best is None:
        return None

    key = BASE_KEY if lowered == best else stem[len(best) + 1:]
    return best, key, kind


def resolve_kind(folder, kind, has_build_dorm):
    """
    Correct the kind `parse_rig` read from the kind folder, for the one layout where the folder name misleads.

    Args:
        folder: The upstream rig folder name, such as `char_1012_skadi2`.
        kind: The kind `parse_rig` returned: `battle`, `back` or `dorm`.
        has_build_dorm: Whether the same operator and key also have a `build_`-prefixed `Spine` folder.

    Returns:
        `battle` for a plain `Spine` folder that sits beside a `build_` dorm folder, otherwise `kind` unchanged.
    """
    if kind == "dorm" and not folder.lower().startswith("build_") and has_build_dorm:
        return "battle"
    return kind


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
