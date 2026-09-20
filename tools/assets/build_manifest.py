"""
Build the manifest the site reads to know which operators have real art.

Walks the **encoded output** under `--staging`, not the staged upstream tree, so the manifest can only ever claim a file that really exists.
For `portraits/` and `illustrations/`, a file named exactly `<id>.webp` means that operator has canonical art. A file named `<id>_<key>.webp`
is a variant, and its key is collected into `skins` for that operator, for the later phase that imports `skin_table.json`. Class icons carry
no per-operator presence and are not part of the manifest. See `encode.py` for how these filenames are produced.

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
        the list of variant keys its `<id>_<key>.webp` files carry. Both are empty when `kind`'s directory does not exist yet.
    """
    source_dir = os.path.join(staging_dir, "assets", kind)
    canonical = set()
    variants = {}
    if not os.path.isdir(source_dir):
        return canonical, variants

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
            variants.setdefault(operator_id, []).append(key)
    return canonical, variants


def build_manifest(staging_dir, operator_ids):
    """
    Walk both encoded art kinds and assemble the manifest the site reads.

    Args:
        staging_dir: Root of the `--staging` tree.
        operator_ids: Every known operator id.

    Returns:
        A dict with `portraits`, `illustrations` and `skins` keys, each with its entries sorted by operator id so a re-run of an unchanged
        tree produces no diff. `portraits` and `illustrations` name every operator, `skins` only those that have a variant.
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
