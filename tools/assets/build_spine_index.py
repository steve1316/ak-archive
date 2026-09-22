"""
Index the staged Spine tree so the site knows which rigs an operator has.

Walks the **staged output** rather than the upstream tree, so the index can only ever name a rig that was actually staged for publishing.
This mirrors `build_manifest.py`, which walks the encoded output for the same reason.

That staged tree is already in published layout - `spine/<id>/<key>/<kind>/` - so nothing here needs `spine_names`. The naming rules ran in
`stage_spine.py`; re-applying them would be a second copy to keep in sync.

`anims` is left empty here and filled by `fill_spine_anims.mjs`, which reads the names out of each skeleton and must run after this
script. Splitting it that way keeps this script free of a skeleton parser, and lets the animation names be refreshed without
re-walking the tree.

Usage:
    python3 -u tools/assets/build_spine_index.py [--staging PATH]
"""

import argparse
import json
import os

from build_manifest import DATA_DIR, load_operator_ids


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_STAGING_DIR = os.path.join(TOOLS_DIR, ".staging")
INDEX_PATH = os.path.join(DATA_DIR, "spine-index.json")

# Must match the field names on `SpineForm` in src/types/spine.ts. Kept in sync by hand since this script deliberately does not import
# spine_names.py (see the module docstring).
KNOWN_KINDS = ("battle", "back", "dorm")


def read_rig(folder):
    """
    Read one staged rig folder into an index entry.

    Args:
        folder: A staged rig folder holding `.skel`, `.atlas` and `.png` files.

    Returns:
        A `{skel, atlas, anims}` dict, or None when the folder lacks either a skeleton or an atlas, which makes it unrenderable.

    Raises:
        ValueError: When the folder holds more than one skeleton. The index names one rig per kind, so a second one would be hidden. That
            is how Skadi the Corrupting Heart's battle rig once went missing, filed beside her dorm rig.
    """
    skels = sorted(name[: -len(".skel")] for name in os.listdir(folder) if name.endswith(".skel"))
    atlases = sorted(name[: -len(".atlas")] for name in os.listdir(folder) if name.endswith(".atlas"))
    if len(skels) > 1:
        raise ValueError(f"{folder} holds {len(skels)} skeletons: {', '.join(skels)}")
    if not skels or not atlases:
        return None
    return {"skel": skels[0], "atlas": atlases[0], "anims": []}


def build_index(staging_dir, operator_ids):
    """
    Walk the staged Spine tree and assemble the index.

    Args:
        staging_dir: Root of the staged tree.
        operator_ids: Every known operator id.

    Returns:
        A dict keyed by operator id, then variant key, then `battle`, `back` or `dorm`, sorted at every level so an unchanged tree
        produces no diff.

    Raises:
        ValueError: A directory at the kind level is not one of `KNOWN_KINDS`. This is a pipeline invariant, so it fails loudly
            rather than silently indexing an unknown key that `SpineForm` has no field for.
    """
    root = os.path.join(staging_dir, "assets", "spine")
    index = {}
    if not os.path.isdir(root):
        return index

    for operator_id in sorted(os.listdir(root)):
        if operator_id not in operator_ids:
            continue
        forms = {}
        operator_dir = os.path.join(root, operator_id)
        for key in sorted(os.listdir(operator_dir)):
            kinds = {}
            key_dir = os.path.join(operator_dir, key)
            for kind in sorted(os.listdir(key_dir)):
                if kind not in KNOWN_KINDS:
                    raise ValueError(f"unknown Spine kind directory: {os.path.join(key_dir, kind)}")
                rig = read_rig(os.path.join(key_dir, kind))
                if rig is not None:
                    kinds[kind] = rig
            if kinds:
                forms[key] = kinds
        if forms:
            index[operator_id] = forms
    return index


def main():
    """Parse arguments, walk the staged tree, write the index, and print the counts."""
    parser = argparse.ArgumentParser(description="Walk the staged Spine tree and write the index the site reads.")
    parser.add_argument("--staging", default=DEFAULT_STAGING_DIR, help="Root of the staged tree. Defaults to tools/assets/.staging.")
    args = parser.parse_args()

    index = build_index(args.staging, load_operator_ids())

    # Compact, one line, matching every sibling file under `src/data/`.
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(INDEX_PATH, "w", encoding="utf-8") as handle:
        json.dump(index, handle, separators=(",", ":"), sort_keys=True)
        handle.write("\n")

    forms = sum(len(entry) for entry in index.values())
    rigs = sum(len(form) for entry in index.values() for form in entry.values())
    print(f"operators {len(index)}")
    print(f"forms     {forms}")
    print(f"rigs      {rigs}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
