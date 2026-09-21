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
import os
import shutil

from build_manifest import load_operator_ids
from spine_names import KIND_FOLDERS, parse_rig, published_dir, rig_stem


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


def plan_copies(staging_dir, operator_ids):
    """
    Walk the staged Spine tree and pair every rig file with where it will be published.

    Args:
        staging_dir: Root of the staged tree.
        operator_ids: Every known operator id.

    Returns:
        A `(jobs, skipped)` pair. `jobs` is a sorted list of `(source_path, destination_path)` absolute pairs, empty when the staged tree
        does not exist. `skipped` is a dict with `unmapped_kind`, `test` and `unrecognised_operator` counts for rig-kind folders `parse_rig`
        rejected, plus `other_file` for files inside a matched rig folder that are not one of `RIG_EXTENSIONS`.
    """
    source_root = os.path.join(staging_dir, "upstream", "spine")
    output_root = os.path.join(staging_dir, "assets")
    skipped = {"unmapped_kind": 0, "test": 0, "unrecognised_operator": 0, "other_file": 0}
    if not os.path.isdir(source_root):
        return [], skipped

    jobs = []
    for directory, _subdirs, names in os.walk(source_root):
        relative = os.path.relpath(directory, source_root).replace(os.sep, "/")
        parsed = parse_rig(relative, operator_ids)
        if parsed is None:
            parts = relative.split("/")
            if len(parts) == 3:
                skipped[classify_rejected_rig(parts)] += 1
            continue
        operator_id, key, kind = parsed
        target = published_dir(operator_id, key, kind)
        for name in sorted(names):
            if not name.endswith(RIG_EXTENSIONS):
                skipped["other_file"] += 1
                continue
            jobs.append((os.path.join(directory, name), os.path.join(output_root, target, name)))
    return sorted(jobs), skipped


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

    for index, (source, destination) in enumerate(pending, start=1):
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copy2(source, destination)
        if index % PROGRESS_EVERY == 0:
            print(f"copied {index} of {len(pending)}")
    print(f"copied {len(pending)} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
