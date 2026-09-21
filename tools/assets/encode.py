"""
Re-encode staged upstream PNGs into the WebP files the site publishes.

Portraits and illustrations get their filenames from the naming rules in `names.py`: one variant per operator becomes
the canonical, suffix-free file, and the rest keep their variant key as a suffix. Class icons need no naming rule -
the staged filename is already the lowercase class name the site asks for. See `names.py` for why one variant has to
be picked as canonical, and `fetch.py` for where the staged tree this script reads comes from.

`parse_asset` returns None both for a file that belongs to no known operator (a token or summon) and, in principle,
for a bare `<id>.png` with no variant suffix, and `is_test_variant` is a plain substring match. Neither is a live bug
against the real staged tree, but both are silent, so this script counts what each one skips and prints the counts at
the end of every run - that is what makes a future upstream change visible in the run log instead of vanishing.

Usage:
    python3 -u tools/assets/encode.py [--dry-run] [--only {portraits,illustrations,classes}] [--staging PATH]
"""

import argparse
import glob
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from names import canonical_key, is_redundant_crop, is_test_variant, output_name, parse_asset


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(TOOLS_DIR))
DATA_DIR = os.path.join(REPO_ROOT, "src", "data")
DEFAULT_STAGING_DIR = os.path.join(TOOLS_DIR, ".staging")

# A1 measured this ceiling and quality against the real size distribution. Illustrations come down about 10x;
# portraits, which are 180x360 and never reach the ceiling, come down about 6x because only the format changes.
MAX_EDGE = 2048
QUALITY = 85

# Upstream directory to published directory.
KINDS = {"charpor": "portraits", "charpack": "illustrations"}

# How often the real encode reports a running count and byte total.
PROGRESS_EVERY = 100


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Helpers


def format_bytes(count):
    """
    Render a byte count as a human-readable size.

    Args:
        count: Number of bytes.

    Returns:
        A string such as `6.5 GB` or `234 KB`, scaling up through B, KB, MB, GB.
    """
    value = float(count)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024


def load_operator_ids():
    """
    Read every operator id the site knows about, from the generated per-profession shards.

    This is the same source `tools/data` writes, so this script and the site can never disagree about which ids
    exist.

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


def needs_encode(input_path, output_path):
    """
    Whether an input file still needs to be (re-)encoded.

    An output that already exists and is newer than its input is left alone. This is what makes a 6.5 GB run
    resumable after an interruption instead of re-encoding files a previous run already finished.

    Args:
        input_path: The staged source file.
        output_path: The published WebP path.

    Returns:
        True when `output_path` is missing or older than `input_path`, False otherwise.
    """
    if not os.path.exists(output_path):
        return True
    return os.path.getmtime(output_path) < os.path.getmtime(input_path)


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Planning

# A planned job is an (input_path, output_path, label) triple. `label` is the "input -> output" line --dry-run
# prints, precomputed at plan time from the same names the job was built from, rather than reconstructed from paths.


def plan_variant_kind(staging_dir, upstream_name, published_name, operator_ids):
    """
    Work out every job for one upstream art directory, and count what the naming rules skipped.

    Every surviving variant key is grouped by operator first, so `canonical_key` runs once per operator rather than
    once per file - the canonical variant is a property of the operator's whole file set, not of any single file.

    Args:
        staging_dir: The root of the `--staging` tree.
        upstream_name: The upstream directory name, such as `charpor`.
        published_name: The published directory name, such as `portraits`.
        operator_ids: Every known operator id.

    Returns:
        A `(jobs, skipped)` pair. `jobs` is a list of `(input_path, output_path, label)` triples. `skipped` is a
        dict with `unrecognised`, `test` and `redundant` counts. Both are empty when `upstream_name`'s source
        directory does not exist - that stage simply has nothing to do.
    """
    source_dir = os.path.join(staging_dir, "upstream", upstream_name)
    dest_dir = os.path.join(staging_dir, "assets", published_name)

    jobs = []
    skipped = {"unrecognised": 0, "test": 0, "redundant": 0}
    if not os.path.isdir(source_dir):
        print(f"skipping {published_name}: {source_dir} does not exist")
        return jobs, skipped

    keys_by_operator = {}
    files_by_operator = {}

    for name in sorted(os.listdir(source_dir)):
        if not name.endswith(".png"):
            continue
        stem = name[: -len(".png")]
        parsed = parse_asset(stem, operator_ids)
        if parsed is None:
            skipped["unrecognised"] += 1
            continue
        operator_id, key = parsed
        if is_test_variant(key):
            skipped["test"] += 1
            continue
        keys_by_operator.setdefault(operator_id, []).append(key)
        files_by_operator.setdefault(operator_id, []).append((name, key))

    # The redundant check runs here, once every key for an operator is known, rather than beside the test-variant
    # check above - it needs the operator's whole key set to tell a "b" crop from the base it duplicates.
    for operator_id, files in files_by_operator.items():
        keys = keys_by_operator[operator_id]
        canonical = canonical_key(keys)
        for name, key in files:
            if is_redundant_crop(key, keys):
                skipped["redundant"] += 1
                continue
            out_name = output_name(operator_id, key, canonical)
            label = f"{upstream_name}/{name} -> {published_name}/{out_name}"
            jobs.append((os.path.join(source_dir, name), os.path.join(dest_dir, out_name), label))
    return jobs, skipped


def plan_classes(staging_dir):
    """
    Work out every job for the class icons, which need no naming rule - the staged filename is already the
    published one, just re-extensioned.

    Args:
        staging_dir: The root of the `--staging` tree.

    Returns:
        A list of `(input_path, output_path, label)` triples. Empty when the classes directory does not exist.
    """
    source_dir = os.path.join(staging_dir, "classes")
    dest_dir = os.path.join(staging_dir, "assets", "classes")

    jobs = []
    if not os.path.isdir(source_dir):
        print(f"skipping classes: {source_dir} does not exist")
        return jobs

    for name in sorted(os.listdir(source_dir)):
        if not name.endswith(".png"):
            continue
        stem = name[: -len(".png")]
        out_name = f"{stem}.webp"
        label = f"classes/{name} -> classes/{out_name}"
        jobs.append((os.path.join(source_dir, name), os.path.join(dest_dir, out_name), label))
    return jobs


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Encoding


def encode_one(job):
    """
    Encode one staged PNG to WebP, downscaling only when it exceeds `MAX_EDGE` on its longest edge.

    Runs in a worker process, so it takes a plain (input_path, output_path) pair rather than anything holding open
    file handles or process-local state.

    Args:
        job: An `(input_path, output_path)` pair.

    Returns:
        The number of bytes written to `output_path`.

    Raises:
        OSError: If the input cannot be read or the output cannot be written.
        PIL.UnidentifiedImageError: If the input is not a readable image.
    """
    input_path, output_path = job
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with Image.open(input_path) as image:
        image = image.convert("RGBA")
        longest_edge = max(image.size)
        if longest_edge > MAX_EDGE:
            scale = MAX_EDGE / longest_edge
            new_size = (round(image.width * scale), round(image.height * scale))
            image = image.resize(new_size, Image.LANCZOS)
        image.save(output_path, "WEBP", quality=QUALITY, method=6)
    return os.path.getsize(output_path)


def encode_all(jobs):
    """
    Encode a list of jobs across a process pool sized to the machine, printing progress along the way.

    Encoding is CPU-bound and independent per file, so a `ProcessPoolExecutor` parallelises it across every core.
    Progress prints every `PROGRESS_EVERY` files as each one finishes, not in submission order, so it reflects
    real throughput rather than stalling on whichever file happened to be submitted first.

    Args:
        jobs: A list of `(input_path, output_path, label)` triples to encode.

    Returns:
        A `(count, total_bytes)` pair for the files actually encoded.

    Raises:
        OSError: If any input cannot be read or any output cannot be written.
        PIL.UnidentifiedImageError: If any input is not a readable image.
    """
    count = 0
    total_bytes = 0
    with ProcessPoolExecutor(max_workers=os.cpu_count() or 1) as executor:
        futures = [executor.submit(encode_one, (input_path, output_path)) for input_path, output_path, _label in jobs]
        for future in as_completed(futures):
            total_bytes += future.result()
            count += 1
            if count % PROGRESS_EVERY == 0:
                print(f"{count}/{len(jobs)} encoded, {format_bytes(total_bytes)}")
    return count, total_bytes


def print_skip_summary(skipped):
    """
    Print the per-reason skip counts for a run.

    Args:
        skipped: A dict mapping a skip reason (`unrecognised`, `test`, `redundant`, `already_exists`) to how many
            files were skipped for it.
    """
    print("skipped: " + ", ".join(f"{reason}={count}" for reason, count in skipped.items()))


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Entry point


def main():
    """Parse arguments and run the encode pipeline for the selected stages."""
    parser = argparse.ArgumentParser(description="Re-encode staged upstream art into the WebP files the site publishes.")
    parser.add_argument("--dry-run", action="store_true", help="Print input -> output for every file and encode nothing.")
    parser.add_argument("--only", choices=("portraits", "illustrations", "classes"), help="Run only this stage. Defaults to all three.")
    parser.add_argument("--staging", default=DEFAULT_STAGING_DIR, help="Root of the staged tree. Defaults to tools/assets/.staging.")
    args = parser.parse_args()

    stages = (args.only,) if args.only else ("portraits", "illustrations", "classes")
    operator_ids = load_operator_ids()

    jobs = []
    skipped = {"unrecognised": 0, "test": 0, "redundant": 0}
    for upstream_name, published_name in KINDS.items():
        if published_name not in stages:
            continue
        kind_jobs, kind_skipped = plan_variant_kind(args.staging, upstream_name, published_name, operator_ids)
        jobs.extend(kind_jobs)
        skipped["unrecognised"] += kind_skipped["unrecognised"]
        skipped["test"] += kind_skipped["test"]
        skipped["redundant"] += kind_skipped["redundant"]

    if "classes" in stages:
        jobs.extend(plan_classes(args.staging))

    to_encode = [job for job in jobs if needs_encode(job[0], job[1])]
    skipped["already_exists"] = len(jobs) - len(to_encode)

    if args.dry_run:
        for _input_path, _output_path, label in jobs:
            print(label)
        print_skip_summary(skipped)
        return

    count, total_bytes = encode_all(to_encode)
    print(f"encoded {count} files, {format_bytes(total_bytes)}")
    print_skip_summary(skipped)


if __name__ == "__main__":
    main()
