"""
Copy the staged Spine rigs into the publish tree.

Rigs are copied, not re-encoded. The `.atlas` file names its page image by bare filename, so converting the PNG to WebP would mean rewriting
that reference and proving the browser runtime loads WebP. `../gfl-archive` serves PNG and this follows it.

Resumable: an output that already exists and is newer than its input is skipped, so a re-run after an interruption costs a directory walk
rather than another 2 GB of copying. Skips are also counted by reason and printed at the end of every run, the same way `encode.py` does it,
so a naming-rule gap in a future upstream update shows up in the log instead of vanishing silently.

Usage:
    python3 -u tools/assets/stage_spine.py [--staging PATH] [--dry-run]
"""

import argparse
import filecmp
import os
import shutil

from build_manifest import load_operator_ids
from spine_names import KIND_FOLDERS, parse_rig, published_dir, resolve_kind, rig_stem


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_STAGING_DIR = os.path.join(TOOLS_DIR, ".staging")

# The three files a rig is made of. Anything else in a matched rig folder is ignored.
RIG_EXTENSIONS = (".skel", ".atlas", ".png")

# How often the copy loop reports progress, in files.
PROGRESS_EVERY = 500


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Helpers


def needs_copy(source, destination):
    """
    Whether a rig file has to be copied.

    Args:
        source: The staged file.
        destination: Where it would be written.

    Returns:
        True when the destination is missing or older than the source.
    """
    if not os.path.exists(destination):
        return True
    return os.path.getmtime(destination) < os.path.getmtime(source)


def copy_files(pending):
    """
    Copy each planned file, creating its folder first and reporting progress every `PROGRESS_EVERY` files.

    Args:
        pending: The `(source, destination)` pairs to copy.

    Returns:
        How many files were copied.
    """
    for index, (source, destination) in enumerate(pending, start=1):
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copy2(source, destination)
        if index % PROGRESS_EVERY == 0:
            print(f"copied {index} of {len(pending)}")
    return len(pending)


def classify_rejected_rig(parts):
    """
    Work out why a rig-shaped folder that `parse_rig` rejected was rejected, for the skip summary.

    Mirrors `parse_rig`'s own checks in order, so the reason reported here always matches the reason it actually returned None for.

    Args:
        parts: A rig-kind path already split on `/`, with exactly 3 elements: `[operator_folder, rig_folder, kind_folder]`.

    Returns:
        `"unmapped_kind"` when the kind folder is not `Spine`, `Back` or `Front`, `"test"` for a test rig, otherwise
        `"unrecognised_operator"`.
    """
    folder, kind_folder = parts[1], parts[2]
    if kind_folder not in KIND_FOLDERS:
        return "unmapped_kind"
    stem = rig_stem(folder)
    if "_test_" in stem or stem.endswith("_test"):
        return "test"
    return "unrecognised_operator"


def print_skip_summary(skipped):
    """
    Print the per-reason skip counts for a run.

    Args:
        skipped: A dict mapping a skip reason to how many rig-kind folders or files were skipped for it.
    """
    print("skipped: " + ", ".join(f"{reason}={count}" for reason, count in skipped.items()))


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Planning


def plan_rig_paths(paths, operator_ids):
    """
    Decide where every upstream rig file publishes, from relative paths alone, so a folder on disk and a trees API listing plan the same way.

    Args:
        paths: File paths relative to the upstream `spine` folder, with forward slashes, such as
            `char_002_amiya/build_char_002_amiya/Spine/build_char_002_amiya.skel`.
        operator_ids: Every known operator id.

    Returns:
        A `(pairs, skipped)` pair. `pairs` is a list of `(upstream_path, published_path)` pairs, the published path relative to the asset root, such
        as `spine/char_002_amiya/base/dorm/build_char_002_amiya.skel`. Two upstream files can share a published path, since upstream files a few
        rigs twice, so the caller decides whether those copies agree. `skipped` counts `unmapped_kind`, `test`, `unrecognised_operator` and
        `other_file`.
    """
    skipped = {"unmapped_kind": 0, "test": 0, "unrecognised_operator": 0, "other_file": 0}
    folders = {}
    for path in sorted(paths):
        directory, _slash, name = path.rpartition("/")
        folders.setdefault(directory, []).append(name)
    rigs = []
    for directory, names in folders.items():
        parsed = parse_rig(directory, operator_ids)
        if parsed is None:
            parts = directory.split("/")
            if len(parts) == 3:
                skipped[classify_rejected_rig(parts)] += 1
            continue
        rigs.append((directory, directory.split("/")[1], parsed, names))
    # A plain `Spine` folder is the battle rig when the same form also has a `build_` dorm folder. See `resolve_kind`.
    build_dorms = {parsed[:2] for _directory, folder, parsed, _names in rigs if parsed[2] == "dorm" and folder.lower().startswith("build_")}
    pairs = []
    for directory, folder, parsed, names in rigs:
        operator_id, key, kind = parsed
        target = published_dir(operator_id, key, resolve_kind(folder, kind, (operator_id, key) in build_dorms))
        for name in names:
            if not name.endswith(RIG_EXTENSIONS):
                skipped["other_file"] += 1
                continue
            pairs.append((f"{directory}/{name}", f"{target}/{name}"))
    return pairs, skipped


def plan_copies(staging_dir, operator_ids):
    """
    Walk the staged Spine tree and pair every rig file with where it will be published. The naming lives in `plan_rig_paths`.

    Args:
        staging_dir: Root of the staged tree.
        operator_ids: Every known operator id.

    Returns:
        A `(jobs, skipped)` pair. `jobs` is a sorted list of `(source_path, destination_path)` absolute pairs, empty when the staged tree
        does not exist. `skipped` is a dict with `unmapped_kind`, `test` and `unrecognised_operator` counts for rig-kind folders `parse_rig`
        rejected, plus `other_file` for files inside a matched rig folder that are not one of `RIG_EXTENSIONS`.

    Raises:
        ValueError: When two different upstream rig files would be published to the same path.
    """
    source_root = os.path.join(staging_dir, "upstream", "spine")
    output_root = os.path.join(staging_dir, "assets")
    if not os.path.isdir(source_root):
        return [], {"unmapped_kind": 0, "test": 0, "unrecognised_operator": 0, "other_file": 0}
    paths = []
    for directory, _subdirs, names in os.walk(source_root):
        relative = os.path.relpath(directory, source_root).replace(os.sep, "/")
        paths.extend(f"{relative}/{name}" for name in names)
    pairs, skipped = plan_rig_paths(paths, operator_ids)
    jobs = [(os.path.join(source_root, *upstream.split("/")), os.path.join(output_root, *published.split("/"))) for upstream, published in pairs]
    # Upstream files a few rigs twice, under a second operator's folder (Fang under Knit's, Blade under Owl's). Those copies are identical
    # and collapse to one job. Two different files bound for one path would silently overwrite each other, so that fails.
    by_destination = {}
    for source, destination in jobs:
        first = by_destination.setdefault(destination, source)
        if first != source and not filecmp.cmp(first, source, shallow=False):
            raise ValueError(f"two different upstream files publish to {destination}: {first} and {source}")
    return sorted((source, destination) for destination, source in by_destination.items()), skipped


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Entry point


def main():
    """Parse arguments, plan the copies, and run them unless this is a dry run."""
    parser = argparse.ArgumentParser(description="Copy staged Spine rigs into the publish tree.")
    parser.add_argument("--staging", default=DEFAULT_STAGING_DIR, help="Root of the staged tree. Defaults to tools/assets/.staging.")
    parser.add_argument("--dry-run", action="store_true", help="Report what would be copied without writing anything.")
    args = parser.parse_args()

    operator_ids = load_operator_ids()
    jobs, skipped = plan_copies(args.staging, operator_ids)
    pending = [job for job in jobs if needs_copy(*job)]
    skipped["already_copied"] = len(jobs) - len(pending)

    total = sum(os.path.getsize(source) for source, _destination in jobs)
    print(f"rig files   {len(jobs)}")
    print(f"to copy     {len(pending)}")
    print(f"bytes       {total / 1e9:.2f} GB")
    print_skip_summary(skipped)

    if args.dry_run:
        print("--dry-run: nothing was written")
        return 0

    print(f"copied {copy_files(pending)} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
