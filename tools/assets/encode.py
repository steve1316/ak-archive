"""
Re-encode staged upstream PNGs into the WebP files the site publishes.

Portraits and illustrations get their filenames from the naming rules in `names.py`: one variant per operator becomes
the canonical, suffix-free file, and the rest keep their variant key as a suffix. Class icons need no naming rule -
the staged filename is already the lowercase class name the site asks for, and enemy icons keep their upstream enemy id. See `names.py` for why one variant has to
be picked as canonical, and `fetch.py` for where the staged tree this script reads comes from.

`parse_asset` returns None both for a file that belongs to no known operator (a token or summon) and, in principle,
for a bare `<id>.png` with no variant suffix, and `is_test_variant` is a plain substring match. Neither is a live bug
against the real staged tree, but both are silent, so this script counts what each one skips and prints the counts at
the end of every run - that is what makes a future upstream change visible in the run log instead of vanishing.

Usage:
    python3 -u tools/assets/encode.py [--dry-run] [--only {portraits,illustrations,classes,skills,potentials,elites,enemies,modules}] [--staging PATH]
"""

import argparse
import functools
import glob
import json
import os
import re
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

# Where Task 3's icon clone keeps its art, relative to `--staging`.
ICONS_ARTS_DIR = os.path.join("icons-upstream", "assets", "dyn", "arts")

# Portraits from the icon clone, used for an operator `charpor` has no portrait for at all. `charpor` stopped adding portraits after October
# 2025, and these are the same 180x360 busts with slightly different compression.
PORTRAIT_FALLBACK_DIR = os.path.join(ICONS_ARTS_DIR, "charportraits")

# Fixed icon sets: (upstream folder, upstream file prefix, how many, published folder). File `i` publishes as `<folder>/<i>.webp`.
NUMBERED_ICONS = {"potentials": ("potential_hub", "potential_", 6), "elites": ("elite_hub", "elite_", 3)}

# Where `fetch.py --only enemies` stages the enemy icons, relative to `--staging`.
ENEMY_ICONS_DIR = os.path.join("enemies-upstream", "enemy")

# Every stage, in the order they run when `--only` is omitted.
STAGES = ("portraits", "illustrations", "classes", "skills", "potentials", "elites", "enemies", "modules")

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

# A planned job is an (input_path, output_path, label, kind) quadruple. `label` is the "input -> output" line --dry-run
# prints, precomputed at plan time from the same names the job was built from, rather than reconstructed from paths.
# `kind` is the published directory name, such as `portraits` or `classes` - `encode_one` reads it to decide whether
# a job needs the class-only glyph conversion.


def plan_variant_kind(staging_dir, upstream_name, published_name, operator_ids, fallback_dir=None):
    """
    Work out every job for one upstream art directory, and count what the naming rules skipped.

    Every surviving variant key is grouped by operator first, so `canonical_key` runs once per operator rather than
    once per file - the canonical variant is a property of the operator's whole file set, not of any single file.

    Args:
        staging_dir: The root of the `--staging` tree.
        upstream_name: The upstream directory name, such as `charpor`.
        published_name: The published directory name, such as `portraits`.
        operator_ids: Every known operator id.
        fallback_dir: Another directory, relative to `staging_dir`, read only for operators with no file at all in `upstream_name`. None
            for no fallback.

    Returns:
        A `(jobs, skipped)` pair. `jobs` is a list of `(input_path, output_path, label, kind)` quadruples, `kind` always
        `published_name`. `skipped` is a dict with `unrecognised`, `test` and `redundant` counts. Both are empty when
        `upstream_name`'s source directory does not exist - that stage simply has nothing to do.
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

    def collect(directory, only_new):
        """
        Group a directory's recognised files by operator into `keys_by_operator` and `files_by_operator`.

        Args:
            directory: The directory to read.
            only_new: Skip operators an earlier call already collected, so a fallback never mixes with the primary source.
        """
        found = {}
        for name in sorted(os.listdir(directory)):
            if not name.endswith(".png"):
                continue
            parsed = parse_asset(name[: -len(".png")], operator_ids)
            if parsed is None:
                skipped["unrecognised"] += 1
                continue
            operator_id, key = parsed
            if only_new and operator_id in files_by_operator:
                continue
            if is_test_variant(key):
                skipped["test"] += 1
                continue
            found.setdefault(operator_id, []).append((os.path.join(directory, name), name, key))
        for operator_id, files in found.items():
            keys_by_operator[operator_id] = [key for _path, _name, key in files]
            files_by_operator[operator_id] = files

    collect(source_dir, False)
    fallback_source = os.path.join(staging_dir, fallback_dir) if fallback_dir else None
    if fallback_source and os.path.isdir(fallback_source):
        collect(fallback_source, True)

    # The redundant check runs here, once every key for an operator is known, rather than beside the test-variant
    # check above - it needs the operator's whole key set to tell a "b" crop from the base it duplicates.
    for operator_id, files in files_by_operator.items():
        keys = keys_by_operator[operator_id]
        canonical = canonical_key(keys)
        for path, name, key in files:
            if is_redundant_crop(key, keys):
                skipped["redundant"] += 1
                continue
            out_name = output_name(operator_id, key, canonical)
            label = f"{os.path.basename(os.path.dirname(path))}/{name} -> {published_name}/{out_name}"
            jobs.append((path, os.path.join(dest_dir, out_name), label, published_name))
    return jobs, skipped


def plan_classes(staging_dir):
    """
    Work out every job for the class icons, which need no naming rule - the staged filename is already the
    published one, just re-extensioned.

    Args:
        staging_dir: The root of the `--staging` tree.

    Returns:
        A list of `(input_path, output_path, label, kind)` quadruples, `kind` always `"classes"`. Empty when the classes
        directory does not exist.
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
        jobs.append((os.path.join(source_dir, name), os.path.join(dest_dir, out_name), label, "classes"))
    return jobs


def icon_key(stem):
    """
    The published key for a skill icon, the same rule as `iconKey` in `tools/data/lib/skills.mjs`.

    Args:
        stem: The upstream file stem after `skill_icon_`, such as `skcom_powerstrike[3]`.

    Returns:
        The key, such as `skcom_powerstrike_3`.
    """
    return re.sub(r"_+$", "", re.sub(r"[^a-z0-9_]+", "_", stem.lower()))


@functools.cache
def load_details():
    """
    Read every operator's details record the importer wrote. Cached, since the skills and modules stages both read it in one run.

    Returns:
        A tuple of details dicts, one per operator.
    """
    details = []
    for path in sorted(glob.glob(os.path.join(DATA_DIR, "details-*.json"))):
        with open(path, encoding="utf-8") as handle:
            details.extend(json.load(handle).values())
    return tuple(details)


def load_skill_icon_keys():
    """
    Read every skill icon key the importer wrote, so only icons a page can show are encoded. Skills live in the details files.

    Returns:
        A set of keys.
    """
    return {skill["icon"] for detail in load_details() for skill in detail.get("skills", [])}


def load_module_keys():
    """
    Read every module art key and badge key the importer wrote.

    Returns:
        An `(art_keys, type_keys)` pair of sets.
    """
    modules = [module for detail in load_details() for module in detail.get("modules", [])]
    return {module["art"] for module in modules}, {module["typeIcon"] for module in modules}


def plan_skills(staging_dir, wanted):
    """
    Work out a job for every skill icon an operator uses.

    Args:
        staging_dir: The root of the `--staging` tree.
        wanted: Every key the importer wrote.

    Returns:
        A `(jobs, missing)` pair: the `(input_path, output_path, label, kind)` quadruples, `kind` always `"skills"`, and
        the sorted keys upstream has no file for.
    """
    source_dir = os.path.join(staging_dir, ICONS_ARTS_DIR, "skills")
    dest_dir = os.path.join(staging_dir, "assets", "skills")
    if not os.path.isdir(source_dir):
        print(f"skipping skills: {source_dir} does not exist")
        return [], sorted(wanted)
    jobs = []
    found = set()
    for name in sorted(os.listdir(source_dir)):
        if not (name.startswith("skill_icon_") and name.endswith(".png")):
            continue
        key = icon_key(name[len("skill_icon_") : -len(".png")])
        if key in wanted and key not in found:
            found.add(key)
            jobs.append((os.path.join(source_dir, name), os.path.join(dest_dir, f"{key}.webp"), f"skills/{name} -> skills/{key}.webp", "skills"))
    return jobs, sorted(wanted - found)


def plan_modules(staging_dir, art_keys, type_keys):
    """
    Work out a job for every module picture and branch badge a page can show.

    Keys match exactly. A file such as `uniequip_002_chen2` is another operator's module (Ch'en the Holungday), not a stage of Ch'en's, so it
    is encoded only when that operator's module names it. File names are compared lowercase, since two badge codes differ from their file
    only in case, and everything publishes under the lowercase key.

    Args:
        staging_dir: The root of the `--staging` tree.
        art_keys: Every module art key the importer wrote.
        type_keys: Every badge key the importer wrote.

    Returns:
        A `(jobs, missing)` pair: the `(input_path, output_path, label, kind)` quadruples, `kind` `"modules"` or `"module-types"`, and the
        sorted keys upstream has no file for.
    """
    jobs = []
    found = set()
    for folder, published, wanted in (("uniequipimgsmall", "modules", art_keys), ("uniequipdirection", "module-types", type_keys)):
        source_dir = os.path.join(staging_dir, ICONS_ARTS_DIR, "ui", folder)
        names = sorted(os.listdir(source_dir)) if os.path.isdir(source_dir) else []
        for name in names:
            stem = name[: -len(".png")].lower() if name.endswith(".png") else None
            if stem in wanted and (published, stem) not in found:
                found.add((published, stem))
                out = os.path.join(staging_dir, "assets", published, f"{stem}.webp")
                jobs.append((os.path.join(source_dir, name), out, f"{folder}/{name} -> {published}/{stem}.webp", published))
    missing = {key for key in art_keys if ("modules", key) not in found} | {key for key in type_keys if ("module-types", key) not in found}
    return jobs, sorted(missing)


def load_enemy_ids():
    """
    Read every enemy variant id the importer wrote, so only enemies a page can show are encoded.

    Returns:
        A set of enemy ids, such as `enemy_1007_slime_2`. Empty when the importer has not written `enemies.json`.
    """
    path = os.path.join(DATA_DIR, "enemies.json")
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8") as handle:
        return {variant["id"] for enemy in json.load(handle) for variant in enemy["variants"]}


def plan_enemies(staging_dir, wanted):
    """
    Work out a job for every enemy icon a page can show.

    Args:
        staging_dir: The root of the `--staging` tree.
        wanted: Every enemy id the importer wrote.

    Returns:
        A `(jobs, missing)` pair: the `(input_path, output_path, label, kind)` quadruples, `kind` always `"enemies"`, and the sorted ids with no
        staged icon. A missing icon is not an error, since the manifest records presence and the site draws a placeholder.
    """
    source_dir = os.path.join(staging_dir, ENEMY_ICONS_DIR)
    dest_dir = os.path.join(staging_dir, "assets", "enemies")
    if not os.path.isdir(source_dir):
        print(f"skipping enemies: {source_dir} does not exist")
        return [], []
    jobs = []
    missing = []
    for enemy_id in sorted(wanted):
        source = os.path.join(source_dir, f"{enemy_id}.png")
        if os.path.exists(source):
            jobs.append((source, os.path.join(dest_dir, f"{enemy_id}.webp"), f"enemy/{enemy_id}.png -> enemies/{enemy_id}.webp", "enemies"))
        else:
            missing.append(enemy_id)
    return jobs, missing


def plan_numbered(staging_dir, published_name):
    """
    Work out the jobs for one fixed, numbered icon set.

    Args:
        staging_dir: The root of the `--staging` tree.
        published_name: A key of `NUMBERED_ICONS`, such as `potentials`.

    Returns:
        A list of `(input_path, output_path, label, kind)` quadruples, `kind` always `published_name`.
    """
    folder, prefix, count = NUMBERED_ICONS[published_name]
    source_dir = os.path.join(staging_dir, ICONS_ARTS_DIR, folder)
    dest_dir = os.path.join(staging_dir, "assets", published_name)
    return [
        (os.path.join(source_dir, f"{prefix}{index}.png"), os.path.join(dest_dir, f"{index}.webp"), f"{folder}/{prefix}{index}.png -> {published_name}/{index}.webp", published_name)
        for index in range(count)
    ]


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Encoding


def whiten_glyph(image):
    """
    Turn a white-glyph-on-black source into a white glyph on transparency, with alpha taken from the source's brightness.

    Upstream ships each class icon as a white glyph over an opaque black square, since the game itself draws it on a dark
    panel of its own. The site instead draws the icon on a card over the page background, so the black square has to become
    transparency rather than staying a black square. Luminance stands in for alpha because the source is already just white
    on black: a white pixel becomes fully opaque, a black pixel fully transparent, with no other colour to account for.

    Args:
        image: The source image, already converted to `RGBA`.

    Returns:
        A new `RGBA` image, solid white, with alpha equal to the source's grayscale luminance.
    """
    glyph = Image.new("RGBA", image.size, (255, 255, 255, 0))
    glyph.putalpha(image.convert("L"))
    return glyph


def encode_one(job):
    """
    Encode one staged PNG to WebP, downscaling only when it exceeds `MAX_EDGE` on its longest edge.

    Runs in a worker process, so it takes a plain (input_path, output_path, kind) triple rather than anything holding
    open file handles or process-local state. A `classes` job additionally passes through `whiten_glyph`, so the class
    badge and the Animations placeholder get a transparent glyph instead of upstream's white-on-black square. A `module-types`
    job is saved losslessly, since the branch badges are tiny flat glyphs that lossy encoding would smear.

    Args:
        job: An `(input_path, output_path, kind)` triple. `kind` is the published directory name, such as `portraits`
            or `classes`.

    Returns:
        The number of bytes written to `output_path`.

    Raises:
        OSError: If the input cannot be read or the output cannot be written.
        PIL.UnidentifiedImageError: If the input is not a readable image.
    """
    input_path, output_path, kind = job
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with Image.open(input_path) as image:
        image = image.convert("RGBA")
        longest_edge = max(image.size)
        if longest_edge > MAX_EDGE:
            scale = MAX_EDGE / longest_edge
            new_size = (round(image.width * scale), round(image.height * scale))
            image = image.resize(new_size, Image.LANCZOS)
        if kind == "classes":
            image = whiten_glyph(image)
        if kind == "module-types":
            image.save(output_path, "WEBP", lossless=True, method=6)
        else:
            image.save(output_path, "WEBP", quality=QUALITY, method=6)
    return os.path.getsize(output_path)


def encode_all(jobs):
    """
    Encode a list of jobs across a process pool sized to the machine, printing progress along the way.

    Encoding is CPU-bound and independent per file, so a `ProcessPoolExecutor` parallelises it across every core.
    Progress prints every `PROGRESS_EVERY` files as each one finishes, not in submission order, so it reflects
    real throughput rather than stalling on whichever file happened to be submitted first.

    Args:
        jobs: A list of `(input_path, output_path, label, kind)` quadruples to encode.

    Returns:
        A `(count, total_bytes)` pair for the files actually encoded.

    Raises:
        OSError: If any input cannot be read or any output cannot be written.
        PIL.UnidentifiedImageError: If any input is not a readable image.
    """
    count = 0
    total_bytes = 0
    with ProcessPoolExecutor(max_workers=os.cpu_count() or 1) as executor:
        futures = [executor.submit(encode_one, (input_path, output_path, kind)) for input_path, output_path, _label, kind in jobs]
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
    parser.add_argument("--only", choices=STAGES, help="Run only this stage. Defaults to all of them.")
    parser.add_argument("--staging", default=DEFAULT_STAGING_DIR, help="Root of the staged tree. Defaults to tools/assets/.staging.")
    args = parser.parse_args()

    stages = (args.only,) if args.only else STAGES
    operator_ids = load_operator_ids()

    jobs = []
    skipped = {"unrecognised": 0, "test": 0, "redundant": 0}
    for upstream_name, published_name in KINDS.items():
        if published_name not in stages:
            continue
        fallback = PORTRAIT_FALLBACK_DIR if published_name == "portraits" else None
        kind_jobs, kind_skipped = plan_variant_kind(args.staging, upstream_name, published_name, operator_ids, fallback)
        jobs.extend(kind_jobs)
        skipped["unrecognised"] += kind_skipped["unrecognised"]
        skipped["test"] += kind_skipped["test"]
        skipped["redundant"] += kind_skipped["redundant"]

    if "classes" in stages:
        jobs.extend(plan_classes(args.staging))

    missing = []
    if "skills" in stages:
        skill_jobs, missing = plan_skills(args.staging, load_skill_icon_keys())
        jobs.extend(skill_jobs)
    if "modules" in stages:
        module_jobs, missing_modules = plan_modules(args.staging, *load_module_keys())
        jobs.extend(module_jobs)
        missing.extend(missing_modules)
    for published_name in NUMBERED_ICONS:
        if published_name in stages:
            jobs.extend(plan_numbered(args.staging, published_name))

    if "enemies" in stages:
        enemy_jobs, missing_enemies = plan_enemies(args.staging, load_enemy_ids())
        jobs.extend(enemy_jobs)
        if missing_enemies:
            print(f"enemies with no staged icon: {len(missing_enemies)}: {', '.join(missing_enemies[:10])}")

    to_encode = [job for job in jobs if needs_encode(job[0], job[1])]
    skipped["already_exists"] = len(jobs) - len(to_encode)

    if args.dry_run:
        for _input_path, _output_path, label, _kind in jobs:
            print(label)
        print_skip_summary(skipped)
        if missing:
            print(f"missing icons: {len(missing)}: {', '.join(missing[:10])}")
            sys.exit(1)
        return

    count, total_bytes = encode_all(to_encode)
    print(f"encoded {count} files, {format_bytes(total_bytes)}")
    print_skip_summary(skipped)
    if missing:
        print(f"missing icons: {len(missing)}: {', '.join(missing[:10])}")
        sys.exit(1)


if __name__ == "__main__":
    main()
