"""
Build the manifest the site reads to know which operators have real art.

Walks the **encoded output** under `--staging`, not the staged upstream tree, so the manifest can only ever claim a file that really exists.
For `portraits/` and `illustrations/`, a file named exactly `<id>.webp` means that operator has canonical art. A file named `<id>_<key>.webp`
is a variant, and its key is collected into `skins` for that operator, for the later phase that imports `skin_table.json`. Skill icons are listed
in `skillIcons`, since a page shows one per skill and the import gate checks every skill has one. Potential, elite and class icons are fixed sets
with no per-operator presence to record, so they stay outside the manifest. See `encode.py` for how these filenames are produced.

`portraits` and `illustrations` carry an entry for every operator, `false` included. The site cannot tell the difference - `hasPortrait` reads a
missing id and a `false` id the same way - but a reader can: `false` means this operator has no art upstream and never will, where a missing id
means the pipeline never got to them. 21 operators have no portrait upstream, so that distinction is the difference between a known gap and a
silent one. `skins` stays sparse, since an empty list carries no such meaning.

Usage:
    python3 -u tools/assets/build_manifest.py [--staging PATH]
"""

import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from names import canonical_key, is_base_variant, is_redundant_crop


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(TOOLS_DIR))
DATA_DIR = os.path.join(REPO_ROOT, "src", "data")
DEFAULT_STAGING_DIR = os.path.join(TOOLS_DIR, ".staging")
MANIFEST_PATH = os.path.join(DATA_DIR, "assets-manifest.json")


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Helpers


def load_operator_ids():
    """
    Read every operator id the site knows about, from the generated per-profession shards.

    This is the same source `encode.py` reads, so the manifest can never name an operator the importer does not also know about.

    Returns:
        A set of every operator id, such as `char_002_amiya`.
    """
    ids = set()
    for path in sorted(glob.glob(os.path.join(DATA_DIR, "operators-*.json"))):
        with open(path, encoding="utf-8") as handle:
            operators = json.load(handle)
        for operator in operators:
            ids.add(operator["id"])
    return ids


def split_stem(stem, operator_ids):
    """
    Split an encoded filename stem into the operator it belongs to and its variant key.

    Matches the longest operator id the stem starts with, because ids nest: `char_1001_amiya2` must not be read as `char_002_amiya` plus
    leftover text. A stem equal to an id exactly is that operator's canonical file and carries no key.

    Args:
        stem: The encoded filename without its extension, such as `char_002_amiya` or `char_002_amiya_epoque_4`.
        operator_ids: Every known operator id.

    Returns:
        An `(operator_id, key)` pair, where `key` is None for the canonical file. None when the stem belongs to no known operator.
    """
    best = None
    for candidate in operator_ids:
        if stem == candidate or stem.startswith(candidate + "_"):
            if best is None or len(candidate) > len(best):
                best = candidate
    if best is None:
        return None
    if stem == best:
        return best, None
    return best, stem[len(best) + 1 :]


def scan_kind(staging_dir, kind, operator_ids):
    """
    Walk one encoded art directory and split what it holds into canonical files and variants.

    Args:
        staging_dir: Root of the `--staging` tree.
        kind: The encoded subdirectory to walk, `portraits` or `illustrations`.
        operator_ids: Every known operator id, used to split a filename stem into id and key.

    Returns:
        A `(canonical, variants)` pair. `canonical` is a set of operator ids that have a bare `<id>.webp`. `variants` maps an operator id to
        the list of variant keys its `<id>_<key>.webp` files carry, minus any key `is_redundant_crop` says duplicates another key the same
        operator already has - the encoded tree can still hold those files locally even after names.py stopped producing new ones, since
        nothing here deletes a stale file. An operator left with no keys after that filtering is left out of `variants` entirely rather than
        mapped to an empty list, matching `build_manifest`'s own promise that `skins` only names an operator that has one. Both are empty
        when `kind`'s directory does not exist yet.
    """
    source_dir = os.path.join(staging_dir, "assets", kind)
    canonical = set()
    variants = {}
    if not os.path.isdir(source_dir):
        return canonical, variants

    keys_by_operator = {}
    for name in sorted(os.listdir(source_dir)):
        if not name.endswith(".webp"):
            continue
        stem = name[: -len(".webp")]
        parsed = split_stem(stem, operator_ids)
        if parsed is None:
            continue
        operator_id, key = parsed
        if key is None:
            canonical.add(operator_id)
        else:
            keys_by_operator.setdefault(operator_id, []).append(key)

    # The redundant check needs an operator's whole key set, so it runs in its own pass once keys_by_operator is complete.
    for operator_id, keys in keys_by_operator.items():
        full_keys = set(keys)
        if operator_id in canonical:
            # The canonical variant's own key never survives as a literal entry here - output_name drops it, so its file carries no suffix
            # at all. A numbered "*b" crop of that exact variant would otherwise find no base to match, so its number is reconstructed with
            # the same rule canonical_key used to pick it in the first place, from every base-variant number this operator's keys still show
            # or imply, and added back in as a stand-in before the redundant check runs. This assumes every "*b" crop upstream ships beside
            # its base - true for every operator in the real data today, but not something this reconstruction can prove from the encoded
            # tree alone.
            implied_numbers = {key[:-1] for key in keys if key.endswith("b") and len(key) > 1 and is_base_variant(key[:-1])}
            phantom_canonical = canonical_key({key for key in keys if is_base_variant(key)} | implied_numbers)
            if phantom_canonical is not None:
                full_keys.add(phantom_canonical)
        kept = [key for key in keys if not is_redundant_crop(key, full_keys)]
        if kept:
            variants[operator_id] = kept
    return canonical, variants


def scan_skill_icons(staging_dir):
    """
    List the skill icon keys the encoded tree actually holds.

    Args:
        staging_dir: Root of the `--staging` tree.

    Returns:
        The sorted keys. Empty when no skill icons are encoded.
    """
    folder = os.path.join(staging_dir, "assets", "skills")
    if not os.path.isdir(folder):
        return []
    return sorted(name[: -len(".webp")] for name in os.listdir(folder) if name.endswith(".webp"))


def build_manifest(staging_dir, operator_ids):
    """
    Walk both encoded art kinds and assemble the manifest the site reads.

    Args:
        staging_dir: Root of the `--staging` tree.
        operator_ids: Every known operator id.

    Returns:
        A dict with `portraits`, `illustrations`, `skins`, `variants` and `skillIcons` keys, each with its entries sorted so a re-run of an unchanged tree produces no diff. `portraits` and `illustrations` name every operator, `skins` only those that have a variant. `variants` records each kind's variant keys separately, in that kind's own upstream spelling. `skins` merges them, which loses both whether a kind has the file and how it spells it - upstream lower-cases some keys under `charpor/` only. `skillIcons` is a flat list of the encoded skill icon keys, listed because a page shows one per skill and the import gate checks every skill has one. Potentials, elites and classes are fixed sets and are not part of the manifest.
    """
    portraits, portrait_variants = scan_kind(staging_dir, "portraits", operator_ids)
    illustrations, illustration_variants = scan_kind(staging_dir, "illustrations", operator_ids)

    skins = {}
    for operator_id in set(portrait_variants) | set(illustration_variants):
        keys = set(portrait_variants.get(operator_id, [])) | set(illustration_variants.get(operator_id, []))
        skins[operator_id] = sorted(keys)

    return {
        "portraits": {operator_id: operator_id in portraits for operator_id in sorted(operator_ids)},
        "illustrations": {operator_id: operator_id in illustrations for operator_id in sorted(operator_ids)},
        "skins": {operator_id: skins[operator_id] for operator_id in sorted(skins)},
        "variants": {
            "portraits": {operator_id: sorted(keys) for operator_id, keys in sorted(portrait_variants.items())},
            "illustrations": {operator_id: sorted(keys) for operator_id, keys in sorted(illustration_variants.items())},
        },
        "skillIcons": scan_skill_icons(staging_dir),
    }


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Entry point


def main():
    """Parse arguments, walk the encoded tree, write the manifest, and print the three counts."""
    parser = argparse.ArgumentParser(description="Walk the encoded asset tree and write the manifest the site reads for asset presence.")
    parser.add_argument("--staging", default=DEFAULT_STAGING_DIR, help="Root of the staged tree. Defaults to tools/assets/.staging.")
    args = parser.parse_args()

    operator_ids = load_operator_ids()
    manifest = build_manifest(args.staging, operator_ids)

    # Compact, one line, no spaces after `:` or `,` - matches what the importer's `JSON.stringify(value)` writes for every sibling file
    # under `src/data/`, so this generated file is not the one outlier in that directory.
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(MANIFEST_PATH, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, separators=(",", ":"))
        handle.write("\n")

    portraits = sum(1 for present in manifest["portraits"].values() if present)
    illustrations = sum(1 for present in manifest["illustrations"].values() if present)
    print(f"portraits     {portraits} of {len(manifest['portraits'])}")
    print(f"illustrations {illustrations} of {len(manifest['illustrations'])}")
    print(f"skins         {len(manifest['skins'])}")


if __name__ == "__main__":
    main()
