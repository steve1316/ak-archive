"""
Merge a refresh run's partial manifest and rig indexes into the committed ones.

A scheduled refresh only fetches and encodes what is new, so the builders it runs see a tree holding only the new files and write partial
outputs. This folds those into `src/data`. A merge only ever adds: a presence flag turns true and never back to false, and a list or a map gains
entries and never loses them. Removing an asset stays a deliberate local step. Files keep the formatting their builders write, so merging an
empty partial leaves them byte for byte unchanged.

Usage:
    python3 -u tools/assets/merge_indexes.py [--manifest-partial FILE] [--spine-partial FILE] [--enemy-spine-partial FILE]
"""

import argparse
import json
import os

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(TOOLS_DIR)), "src", "data")
MANIFEST_PATH = os.path.join(DATA_DIR, "assets-manifest.json")
SPINE_INDEX_PATH = os.path.join(DATA_DIR, "spine-index.json")
ENEMY_SPINE_INDEX_PATH = os.path.join(DATA_DIR, "enemy-spine-index.json")

# Manifest sections that map an id to a presence flag.
FLAG_SECTIONS = ("portraits", "illustrations", "enemies")

# Manifest sections that are flat, sorted key lists.
LIST_SECTIONS = ("skillIcons", "moduleArt", "moduleTypes")

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Merging


def merge_key_lists(committed, partial):
    """
    Union two maps of id to sorted key list.

    Args:
        committed: The committed map.
        partial: The partial map.

    Returns:
        A map with every id from both, each list the sorted union, ids in sorted order.
    """
    ids = sorted(set(committed) | set(partial))
    return {entry: sorted(set(committed.get(entry, [])) | set(partial.get(entry, []))) for entry in ids}


def merge_manifest(committed, partial):
    """
    Merge a partial asset manifest into the committed one.

    Args:
        committed: The committed manifest.
        partial: The manifest `build_manifest.py` wrote for the refresh run's tree.

    Returns:
        The merged manifest, its sections in the committed order with any new section after them.

    Raises:
        ValueError: When a section is not one this merge knows, since guessing how to merge it could drop entries.
    """
    merged = {}
    for section in list(committed) + [name for name in partial if name not in committed]:
        old = committed.get(section)
        new = partial.get(section)
        if new is None:
            merged[section] = old
        elif old is None:
            merged[section] = new
        elif section in FLAG_SECTIONS:
            merged[section] = {entry: bool(old.get(entry)) or bool(new.get(entry)) for entry in sorted(set(old) | set(new))}
        elif section in LIST_SECTIONS:
            merged[section] = sorted(set(old) | set(new))
        elif section == "skins":
            merged[section] = merge_key_lists(old, new)
        elif section == "variants":
            merged[section] = {kind: merge_key_lists(old.get(kind, {}), new.get(kind, {})) for kind in sorted(set(old) | set(new))}
        else:
            raise ValueError(f"unknown manifest section {section}, so it cannot be merged safely")
    return merged


def merge_spine_index(committed, partial):
    """
    Merge a partial operator rig index into the committed one, operator by operator, form by form, kind by kind.

    Args:
        committed: The committed index.
        partial: The index built from the refresh run's tree.

    Returns:
        The merged index. A kind present in both takes the partial entry, which was read from the file just fetched.
    """
    merged = {operator: {form: dict(kinds) for form, kinds in forms.items()} for operator, forms in committed.items()}
    for operator, forms in partial.items():
        for form, kinds in forms.items():
            merged.setdefault(operator, {}).setdefault(form, {}).update(kinds)
    return merged


def merge_enemy_spine_index(committed, partial):
    """
    Merge a partial enemy rig index into the committed one.

    Args:
        committed: The committed index.
        partial: The index built from the refresh run's tree.

    Returns:
        The merged index.
    """
    return {**committed, **partial}


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Entry point


def read_json(path):
    """
    Read a JSON file.

    Args:
        path: The file.

    Returns:
        The parsed value.
    """
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write_compact(path, value, sort_keys):
    """
    Write JSON compact on one line with a trailing newline, the way every file under `src/data` is written.

    Args:
        path: The file.
        value: The value.
        sort_keys: Whether to sort keys, as the rig index builders do. The manifest keeps insertion order.
    """
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(value, handle, separators=(",", ":"), sort_keys=sort_keys)
        handle.write("\n")


def main():
    """Parse arguments and merge each partial that exists into its committed file."""
    parser = argparse.ArgumentParser(description="Merge a refresh run's partial manifest and rig indexes into src/data.")
    parser.add_argument("--manifest-partial", help="Partial manifest from build_manifest.py --out.")
    parser.add_argument("--spine-partial", help="Partial operator rig index from build_spine_index.py --index.")
    parser.add_argument("--enemy-spine-partial", help="Partial enemy rig index from build_spine_index.py --enemies --index.")
    args = parser.parse_args()
    steps = (
        (args.manifest_partial, MANIFEST_PATH, merge_manifest, False),
        (args.spine_partial, SPINE_INDEX_PATH, merge_spine_index, True),
        (args.enemy_spine_partial, ENEMY_SPINE_INDEX_PATH, merge_enemy_spine_index, True),
    )
    for partial_path, committed_path, merge, sort_keys in steps:
        if not partial_path or not os.path.exists(partial_path):
            print(f"skipping {os.path.basename(committed_path)}: no partial")
            continue
        write_compact(committed_path, merge(read_json(committed_path), read_json(partial_path)), sort_keys)
        print(f"merged {os.path.basename(partial_path)} into {os.path.basename(committed_path)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
