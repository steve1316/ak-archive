"""
Publish the encoded asset tree to the public assets repo, `steve1316/ak-archive-assets`.

This is the one irreversible step in the pipeline: about 0.68 GB across 3502 files goes to a public repo that the live site reads over raw GitHub
links. So `add` is a dry run by default - it clones, checks sizes, copies the tree in, prints what would go out, and stops. Only `--confirm` reaches
`publish_batches`, which holds the single `git push` in this file and refuses to run without it. Write access comes from the `gh` HTTPS credentials
already on this machine, so nothing here reads, prompts for or stores a credential. A `--confirm` run also refuses outright when the site's manifest
has not been built, because the assets and the manifest are one atomic thing - `run_add` carries the reasoning.

Git LFS is never configured. `raw.githubusercontent.com` serves an LFS pointer file rather than the image, which would break every picture on the
site while looking perfectly correct in the GitHub repo browser.

Usage:
    python3 -u tools/assets/publish.py add [--confirm] [--staging PATH]
    python3 -u tools/assets/publish.py remove [--confirm] [--staging PATH]
    python3 -u tools/assets/publish.py wait-live [PATH ...] [--sample N] [--staging PATH]
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from publish_checks import BATCH_BYTES, WARN_TOTAL_BYTES, batch_message, check_sizes, compare_manifests, plan_batches, plan_removals, redundant_crop_base


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(TOOLS_DIR))
DATA_DIR = os.path.join(REPO_ROOT, "src", "data")
DEFAULT_STAGING_DIR = os.path.join(TOOLS_DIR, ".staging")

# The manifest keeps the same name on both sides: the site reads it from `src/data`, the asset repo serves it from its root.
MANIFEST_NAME = "assets-manifest.json"
MANIFEST_PATH = os.path.join(DATA_DIR, MANIFEST_NAME)

REPO = "steve1316/ak-archive-assets"
CLONE_URL = f"https://github.com/{REPO}.git"
BRANCH = "main"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}"

# How long `wait-live` polls for new asset URLs, and how often. raw.githubusercontent.com does not serve a new file instantly.
LIVE_TIMEOUT_SECONDS = 20 * 60
LIVE_INTERVAL_SECONDS = 30

# How many published paths `wait-live` samples when none are named, and how long a single poll waits for an answer.
DEFAULT_SAMPLE = 5
REQUEST_TIMEOUT_SECONDS = 30

# How many stale manifest claims to name before summarising the rest. A manifest built against the wrong tree can be wrong about all 3502 files.
STALE_CLAIMS_SHOWN = 10

# A removal that takes more than this share of the published tree is a mistaken pattern, not an intention.
MAX_REMOVAL_SHARE = 0.4

# The stem suffix that marks a redundant crop, the one convention names.py and encode.py already enforce upstream. This is the single
# definition both `run_remove` and `publishable_files` read, so a removal and the next publish can never disagree about what counts as redundant.
REDUNDANT_CROP_SUFFIX = "b"

# GitHub rejects the Python default User-Agent on raw.githubusercontent.com requests.
USER_AGENT = "ak-archive-asset-publish/1.0 (fan site asset pipeline; https://github.com/steve1316/ak-archive)"


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Helpers


def format_bytes(count):
    """
    Render a byte count as a human-readable size, in decimal units.

    Divides by 1000 rather than 1024 on purpose. Every threshold this script prints comes from `publish_checks`, which defines them decimally to stay
    on the strict side, so a binary divisor would print `BATCH_BYTES` - literally `200 * BYTES_PER_MB` - as `190.7 MB`. These are the numbers a human
    reads before releasing 0.68 GB to a public repo, so they have to match the constants they came from.

    Args:
        count: Number of bytes.

    Returns:
        A string such as `6.5 GB` or `234 KB`, scaling up through B, KB, MB, GB.
    """
    value = float(count)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1000 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1000


def load_manifest(path):
    """
    Read a manifest file, treating a missing one as empty.

    Args:
        path: The manifest file to read.

    Returns:
        The parsed manifest, or an empty dict when `path` does not exist.

    Raises:
        json.JSONDecodeError: If the file exists but holds invalid JSON.
    """
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def is_git_repo(path):
    """
    Whether `path` itself is the root of a git repository, not merely a directory nested inside one.

    Checks for `path/.git` directly rather than shelling out to git, for the same reason `fetch.py` does: git's repository discovery walks upward
    until it finds a `.git`, so a directory left behind by an interrupted clone would discover ak-archive's own repository and report success.

    Args:
        path: Directory to check.

    Returns:
        True when `path` exists and holds its own `.git` directory, False otherwise.
    """
    return os.path.isdir(os.path.join(path, ".git"))


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# The clone


def assert_assets_clone(publish_dir, action):
    """
    Refuse to touch `publish_dir` unless it is a git repository root whose `origin` is the assets repo.

    Every destructive git command in this file runs through this first. A mistyped `--staging` that aimed one of them at ak-archive's own working
    tree would otherwise discard uncommitted work, and `git rev-parse` would not catch it because it walks upward into the enclosing repo.
    `is_git_repo` checks for `.git` in this exact directory for that reason.

    Args:
        publish_dir: The directory a caller is about to write to.
        action: What the caller is about to do, used in the error message.

    Raises:
        RuntimeError: If `publish_dir` is not a git repository root, or its `origin` remote is not the assets repo.
    """
    if not is_git_repo(publish_dir):
        raise RuntimeError(f"refusing to {action} {publish_dir}: it is not a git repository root")

    result = subprocess.run(["git", "-C", publish_dir, "remote", "get-url", "origin"], check=False, capture_output=True, text=True)
    origin = result.stdout.strip()
    if result.returncode != 0 or origin != CLONE_URL:
        raise RuntimeError(f"refusing to {action} {publish_dir}: its origin is {origin or 'unset'}, not {CLONE_URL}")


def clean_untracked(publish_dir):
    """
    Delete every untracked file in the clone, so its working tree only ever holds what this run copies in.

    The encoded tree is the source of truth and the clone is scratch. `checkout -f` leaves untracked files alone and `copy_into_clone` only adds, so
    without this a file an earlier run copied in but never published would sit there forever and keep being reported as new. That is a real path,
    not a hypothetical: fix a rule in `names.py`, re-run `encode.py`, and the old wrongly-named files would go public beside the corrected ones.
    `names.py` decides 3502 filenames.

    This deletes, so it goes through `assert_assets_clone` first. `-x` is deliberately not passed, so an ignored file is left alone.

    Args:
        publish_dir: The clone of the assets repo.

    Raises:
        RuntimeError: If `publish_dir` is not a git repository root, or its `origin` remote is not the assets repo.
        subprocess.CalledProcessError: If `git clean` fails.
    """
    assert_assets_clone(publish_dir, "clean")

    subprocess.run(["git", "-C", publish_dir, "clean", "-fd"], check=True)


def clone_or_refresh(publish_dir):
    """
    Put a clean clone of the assets repo at `publish_dir`, cloning it the first time and hard-resetting it on every run after that.

    Authentication is whatever HTTPS credential helper `gh` already installed on this machine - nothing here reads, prompts for or stores a
    credential. The reset discards any local commit that a previous run made but failed to push. That is the resume path, not a loss: those files
    are copied back in from the encoded tree a moment later and go out again in the next batch. The reset only covers tracked files, so
    `clean_untracked` finishes the job on both paths and leaves a working tree that holds nothing but what origin has.

    Args:
        publish_dir: Where the clone lives, `<staging>/publish`.

    Raises:
        RuntimeError: If `publish_dir` exists but holds no `.git`, which is what an interrupted clone leaves behind. This refuses to delete it - a
            publisher should never remove a directory on its own. Also if it is some other repo - the `checkout -f` below discards tracked changes,
            so `assert_assets_clone` has to run before it rather than after.
        subprocess.CalledProcessError: If any `git` command fails.
    """
    if os.path.isdir(publish_dir):
        if not is_git_repo(publish_dir):
            raise RuntimeError(f"{publish_dir} exists but holds no .git - a previous clone was likely interrupted. Remove it by hand and re-run.")
        assert_assets_clone(publish_dir, "reset")
        subprocess.run(["git", "-C", publish_dir, "fetch", "--prune", "--progress", "origin"], check=True)
        subprocess.run(["git", "-C", publish_dir, "checkout", "-f", "-B", BRANCH, f"origin/{BRANCH}"], check=True)
    else:
        os.makedirs(os.path.dirname(publish_dir), exist_ok=True)
        subprocess.run(["git", "clone", "--progress", "--branch", BRANCH, CLONE_URL, publish_dir], check=True)

    clean_untracked(publish_dir)


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Planning


def walk_encoded(encoded_dir):
    """
    Walk the encoded tree and collect every file with its size.

    Args:
        encoded_dir: Root of the encoded output, `<staging>/assets`.

    Returns:
        A sorted list of `(path, size)` pairs, where `path` is relative to `encoded_dir` with forward slashes - exactly the path the site appends
        to the asset base URL. Empty when `encoded_dir` does not exist yet.
    """
    files = []
    if not os.path.isdir(encoded_dir):
        print(f"{encoded_dir} does not exist - there is nothing encoded to publish")
        return files

    for root, _dirs, names in os.walk(encoded_dir):
        for name in names:
            full_path = os.path.join(root, name)
            relative = os.path.relpath(full_path, encoded_dir).replace(os.sep, "/")
            files.append((relative, os.path.getsize(full_path)))
    return sorted(files)


def publishable_files(encoded_dir, suffix=REDUNDANT_CROP_SUFFIX):
    """
    The files the encoded tree actually publishes, once redundant crops are filtered out.

    This is the one place that decides what gets pushed, so every caller that needs to describe, size, check or copy the tree reads from here
    instead of `walk_encoded` directly - `run_add`'s size and manifest checks, its summary line, its copy into the clone, and `wait-live`'s
    sample all end up describing the exact same set this way. The encoded tree can still hold a redundant crop from before names.py and
    encode.py started refusing to produce them, since nothing in this pipeline deletes a stale file - this is what keeps one from leaking back
    out even so.

    Args:
        encoded_dir: Root of the encoded output, `<staging>/assets`.
        suffix: The stem suffix a redundant crop carries. Defaults to `REDUNDANT_CROP_SUFFIX`.

    Returns:
        `(path, size)` pairs from `walk_encoded`, minus any file `redundant_crop_base` finds a base for among its own siblings.
    """
    files = walk_encoded(encoded_dir)

    by_directory = {}
    for path, _size in files:
        directory, _slash, name = path.rpartition("/")
        by_directory.setdefault(directory, set()).add(name)

    def is_redundant(path):
        directory, _slash, name = path.rpartition("/")
        return redundant_crop_base(name, suffix, by_directory[directory]) is not None

    return [(path, size) for path, size in files if not is_redundant(path)]


def check_manifest_against_tree(manifest, files):
    """
    Cross-check what the manifest claims against the files actually about to be published.

    `compare_manifests` compares two manifests against each other, so it cannot see a manifest that is simply stale: build the manifest, then re-run
    or interrupt `encode.py`, and it still matches the committed copy while claiming art the push no longer carries. The site trusts the manifest
    absolutely - `hasPortrait` tests `=== true` and never asks the asset host whether a file is there - so a claim with no file behind it is a
    permanent placeholder on a page that says the art exists.

    Only this direction is checked. A file present that the manifest does not mention is normal and harmless: the class icons are deliberately
    outside the manifest, variants are recorded under `skins` rather than as presence, and an unclaimed file merely renders a placeholder, which is
    the failing-closed behaviour the site already has. Checking that direction would also mean restating `build_manifest.py`'s rules here, a second
    copy to keep in sync.

    Args:
        manifest: The manifest about to be published.
        files: `(path, size)` pairs from the encoded tree.

    Returns:
        A list of human-readable problems, one per claim with no file behind it. Empty when every claim is backed by a real file.
    """
    present = {path for path, _size in files}
    problems = []

    for kind in ("portraits", "illustrations"):
        for operator_id, claimed in sorted(manifest.get(kind, {}).items()):
            if claimed is True and f"{kind}/{operator_id}.webp" not in present:
                problems.append(f"the manifest claims {kind}/{operator_id}.webp, which the encoded tree does not have")

    # `build_manifest.py` collects a skin key from either art kind, so one file of either kind is enough to back the claim.
    for operator_id, keys in sorted(manifest.get("skins", {}).items()):
        for key in keys:
            if not any(f"{kind}/{operator_id}_{key}.webp" in present for kind in ("portraits", "illustrations")):
                problems.append(f"the manifest claims skin {key} for {operator_id}, which the encoded tree has in neither portraits nor illustrations")

    for enemy_id, claimed in sorted(manifest.get("enemies", {}).items()):
        if claimed is True and f"enemies/{enemy_id}.webp" not in present:
            problems.append(f"the manifest claims enemies/{enemy_id}.webp, which the encoded tree does not have")
    return problems


def copy_into_clone(encoded_dir, publish_dir, files):
    """
    Copy exactly `files` from the encoded tree into the clone, and the site's manifest in beside it.

    Copies one file at a time from `files` rather than a whole-tree `shutil.copytree`, so the clone only ever receives what `run_add` already
    checked and counted as publishable - the same list `check_sizes`, `check_manifest_against_tree` and the summary line describe. That is
    what keeps a `remove` run durable: a redundant crop `publishable_files` already filtered out never has a path to copy back in.

    A file whose bytes have not changed copies back identical, so git reports it as unmodified and it is not re-published. That is what keeps a
    re-run cheap. The timestamps `copy2` preserves have nothing to do with it - git re-hashes a file whenever its mtime moves.

    Args:
        encoded_dir: Root of the encoded output.
        publish_dir: The clone of the assets repo.
        files: `(path, size)` pairs to copy in, as `publishable_files` returns them.

    Returns:
        True when the site's manifest was copied in, False when it has not been built yet.

    Raises:
        OSError: If a file cannot be read or written.
    """
    for path, _size in files:
        source = os.path.join(encoded_dir, path)
        destination = os.path.join(publish_dir, path)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copy2(source, destination)
    if not os.path.exists(MANIFEST_PATH):
        return False
    shutil.copy2(MANIFEST_PATH, os.path.join(publish_dir, MANIFEST_NAME))
    return True


def pending_changes(publish_dir):
    """
    Ask git which files in the clone are new or changed against the branch.

    Reading `git status` rather than diffing the trees by hand is what makes a publish resumable: a file an earlier run already committed and pushed
    is simply absent from this result. Deletions are left out on purpose. This publisher only ever adds or updates assets, and a file that vanished
    from the encoded tree is not a reason to take it off the live site.

    Args:
        publish_dir: The clone of the assets repo.

    Returns:
        A `(new, changed, ignored)` triple of path lists, each path relative to `publish_dir`. `ignored` holds anything that is neither untracked nor
        modified, such as a deletion, so nothing is dropped silently.

    Raises:
        subprocess.CalledProcessError: If `git status` fails.
    """
    command = ["git", "-C", publish_dir, "status", "--porcelain", "--untracked-files=all", "-z"]
    result = subprocess.run(command, check=True, capture_output=True, text=True)

    new = []
    changed = []
    ignored = []
    for record in result.stdout.split("\0"):
        if not record:
            continue
        status, path = record[:2], record[3:]
        if status == "??":
            new.append(path)
        elif "M" in status:
            changed.append(path)
        else:
            ignored.append(path)
    return new, changed, ignored


def with_sizes(publish_dir, paths):
    """
    Attach each path's on-disk size, in the shape `check_sizes` and `plan_batches` take.

    Args:
        publish_dir: The clone of the assets repo.
        paths: Paths relative to `publish_dir`.

    Returns:
        A list of `(path, size)` pairs in the order given.

    Raises:
        OSError: If a path cannot be stat'd.
    """
    return [(path, os.path.getsize(os.path.join(publish_dir, path))) for path in paths]


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Publishing


def publish_batches(publish_dir, batches, new_paths, confirm):
    """
    Commit and push each batch. This is the only function in this file that writes to the remote, and it holds the only `git push`.

    Paths go to `git add` through stdin rather than the command line, since a 200 MB batch can carry a few thousand of them.

    Args:
        publish_dir: The clone of the assets repo.
        batches: Batches of `(path, size)` pairs, as `plan_batches` returns them.
        new_paths: The paths the repo does not have yet, used to describe each batch as adding or updating rather than always adding.
        confirm: Must be True. `main` already checks `--confirm`, and this second gate keeps the push unreachable even if a future caller forgets to.

    Returns:
        0 when every batch pushed, 1 when a push failed - re-running `add --confirm` resumes, since the files that did go out are no longer new.

    Raises:
        RuntimeError: If `confirm` is not True.
        subprocess.CalledProcessError: If a `git add` or `git commit` fails.
    """
    if confirm is not True:
        raise RuntimeError("publish_batches refuses to run without --confirm - this is the guard that keeps a publish deliberate")

    for number, batch in enumerate(batches, start=1):
        paths = [path for path, _size in batch]
        add_command = ["git", "-C", publish_dir, "add", "--pathspec-from-file=-", "--pathspec-file-nul"]
        subprocess.run(add_command, input="\0".join(paths), text=True, check=True)

        added = sum(1 for path in paths if path in new_paths)
        message = batch_message(added, len(paths) - added, number, len(batches))
        subprocess.run(["git", "-C", publish_dir, "commit", "-m", message], check=True)

        result = subprocess.run(["git", "-C", publish_dir, "push", "origin", BRANCH], check=False)
        if result.returncode != 0:
            print(f"push failed on batch {number} of {len(batches)} - re-run `publish.py add --confirm` to resume from the files still unpublished")
            return 1
        print(f"pushed batch {number} of {len(batches)}, {len(paths)} files")
    return 0


def run_remove(args):
    """
    Run the `remove` flow: clone, select the redundant crop files, summarise, and delete them only with `--confirm`.

    This is the only flow in this file that deletes published work, so it refuses to select everything: a run that would remove more than
    `MAX_REMOVAL_SHARE` of the tree is treated as a mistaken pattern rather than an intention. It always targets `REDUNDANT_CROP_SUFFIX` - there
    is no way to pass a different suffix on the command line. A general delete-by-arbitrary-suffix would be a footgun on a command that
    permanently deletes from a public repo, and `publishable_files` only ever knows how to filter this one convention, so an arbitrary suffix
    here could never be kept consistent with what the next `add` republishes anyway. A future need to purge a different suffix is a one-line
    code change, which is the right amount of friction for an irreversible public deletion.

    A file only matches when a base file backs it up, not merely because its own name ends in the suffix. Some operator ids end in "b" on
    their own (Bobbing is `bobb`, Gracebearer is `graceb`), and their plain art file would otherwise look identical to a crop-variant name.
    Deleting one of those would destroy the operator's only art rather than a duplicate, so the match requires the base file to exist too.

    Args:
        args: Parsed `remove` arguments, carrying `staging` and `confirm`.

    Returns:
        0 on success or on a dry run, 1 when the run was refused or a push failed.

    Raises:
        subprocess.CalledProcessError: If a `git` command fails.
    """
    publish_dir = os.path.join(args.staging, "publish")
    clone_or_refresh(publish_dir)

    # walk_encoded does not prune .git. Its other caller, run_add, walks the encoded tree, which has no .git, so pruning belongs here rather
    # than in the shared helper. Left uncounted, hundreds of git internals would inflate this denominator and weaken the MAX_REMOVAL_SHARE guard.
    published = [(path, size) for path, size in walk_encoded(publish_dir) if not path.startswith(".git/")]

    by_directory = {}
    for path, _size in published:
        directory, _slash, name = path.rpartition("/")
        by_directory.setdefault(directory, set()).add(name)

    def matches(path):
        directory, _slash, name = path.rpartition("/")
        return redundant_crop_base(name, REDUNDANT_CROP_SUFFIX, by_directory[directory]) is not None

    removals = plan_removals(published, matches)
    removal_bytes = sum(size for _path, size in removals)
    share = len(removals) / len(published) if published else 0

    print(f"target   {REPO} on {BRANCH}")
    print(f"tree     {len(published)} files")
    print(f"matching {len(removals)} files, {format_bytes(removal_bytes)}, {share * 100:.1f}% of the tree")

    if not removals:
        print("nothing matched, nothing was written to the remote")
        return 0

    if share > MAX_REMOVAL_SHARE:
        print(f"refusing to remove {share * 100:.1f}% of the tree, over the {MAX_REMOVAL_SHARE * 100:.0f}% ceiling - the redundant-crop predicate may be matching more than intended")
        return 1

    if not args.confirm:
        print("--confirm was not passed: nothing was written to the remote. Re-run `publish.py remove --confirm` to delete.")
        return 0

    paths = [path for path, _size in removals]
    remove_command = ["git", "-C", publish_dir, "rm", "--quiet", "--pathspec-from-file=-", "--pathspec-file-nul"]
    subprocess.run(remove_command, input="\0".join(paths), text=True, check=True)
    subprocess.run(["git", "-C", publish_dir, "commit", "-m", f"Remove {len(paths)} redundant {REDUNDANT_CROP_SUFFIX} variant files"], check=True)

    result = subprocess.run(["git", "-C", publish_dir, "push", "origin", BRANCH], check=False)
    if result.returncode != 0:
        print("push failed - re-run `publish.py remove --confirm` to resume")
        return 1
    print(f"removed {len(paths)} files, {format_bytes(removal_bytes)}")
    return 0


def run_add(args):
    """
    Run the `add` flow: clone, check sizes, copy in, compare manifests, summarise, and publish only when `--confirm` was passed.

    Args:
        args: Parsed `add` arguments, carrying `staging` and `confirm`.

    Returns:
        0 when the run finished, whether or not it published, and 1 when a size check failed, a `--confirm` run had a missing or stale manifest, or
        a push failed.

    Raises:
        RuntimeError: If the clone directory exists but is not a git repository, or is not the one this script may clean.
        subprocess.CalledProcessError: If a `git` command fails.
        OSError: If the encoded tree cannot be read or copied.
    """
    encoded_dir = os.path.join(args.staging, "assets")
    publish_dir = os.path.join(args.staging, "publish")

    clone_or_refresh(publish_dir)

    files = publishable_files(encoded_dir)
    problems = check_sizes(files)
    if problems:
        print("refusing to publish, nothing was written:")
        for problem in problems:
            print(f"  {problem}")
        return 1

    # The files and the manifest are one atomic thing, and half of it is not a publish. The site never asks the asset host whether a file exists - it
    # reads `src/data/assets-manifest.json` and tests `=== true`, so `hasPortrait` and `hasIllustration` fail closed. Pushing 3502 files with no
    # manifest beside them would land 0.68 GB in a public repo and leave the site looking exactly as it did before, every card still a placeholder,
    # which reads as a failed publish and invites someone to run it again. A stale manifest is worse, since it claims art that is not there. So a real
    # publish refuses here, before anything is copied in, and a dry run is still free to walk an incomplete tree.
    if args.confirm and not os.path.exists(MANIFEST_PATH):
        print(f"refusing to publish, nothing was written: no manifest at {MANIFEST_PATH}")
        print("  The site reads that manifest to decide which operators have art, so without it the assets would land but every card would stay a placeholder.")
        print("  Run `python3 -u tools/assets/build_manifest.py` first, then re-run this command.")
        return 1

    # The stale half of the same problem: a manifest that exists and matches the committed copy, but claims art this encoded tree does not hold.
    regenerated_manifest = load_manifest(MANIFEST_PATH)
    stale_claims = check_manifest_against_tree(regenerated_manifest, files)
    if stale_claims:
        print(f"the manifest claims {len(stale_claims)} file(s) the encoded tree does not have:")
        for problem in stale_claims[:STALE_CLAIMS_SHOWN]:
            print(f"  {problem}")
        if len(stale_claims) > STALE_CLAIMS_SHOWN:
            print(f"  ... and {len(stale_claims) - STALE_CLAIMS_SHOWN} more")
        if args.confirm:
            print("refusing to publish, nothing was copied in. Re-run build_manifest.py against this encoded tree, then re-run this command.")
            return 1

    # `check_sizes` deliberately leaves the warn line to its caller, since a total between the two lines is not a problem, only worth saying out loud.
    total_bytes = sum(size for _path, size in files)
    if total_bytes > WARN_TOTAL_BYTES:
        print(f"warning: {format_bytes(total_bytes)} is past the {format_bytes(WARN_TOTAL_BYTES)} warn line, still under the refuse line")

    # Read what the asset repo already has before the copy overwrites it, so the comparison is against the committed manifest rather than our own.
    committed_manifest = load_manifest(os.path.join(publish_dir, MANIFEST_NAME))

    if not copy_into_clone(encoded_dir, publish_dir, files):
        print(f"no manifest at {MANIFEST_PATH} - a dry run is fine without one, a `--confirm` run is refused above until build_manifest.py has run")
    for problem in compare_manifests(regenerated_manifest, committed_manifest):
        print(f"manifest drift: {problem}")

    new, changed, ignored = pending_changes(publish_dir)
    if ignored:
        print(f"ignoring {len(ignored)} path(s) that are neither new nor modified, such as a deletion: {', '.join(ignored)}")

    pending = with_sizes(publish_dir, sorted(new + changed))
    pending_bytes = sum(size for _path, size in pending)
    batches = plan_batches(pending, BATCH_BYTES)

    print(f"target   {REPO} on {BRANCH}")
    print(f"encoded  {len(files)} files, {format_bytes(total_bytes)}")
    print(f"pending  {len(new)} new, {len(changed)} changed, {format_bytes(pending_bytes)}")
    print(f"batches  {len(batches)}, at most {format_bytes(BATCH_BYTES)} each")

    if not args.confirm:
        print("--confirm was not passed: nothing was written to the remote. Re-run `publish.py add --confirm` to publish.")
        return 0

    return publish_batches(publish_dir, batches, set(new), confirm=args.confirm)


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Waiting for the asset host


def sample_paths(files, count):
    """
    Pick an evenly spread sample of published paths to poll.

    Args:
        files: `(path, size)` pairs from the publishable tree, as `publishable_files` returns them.
        count: How many paths to pick.

    Returns:
        A list of at most `count` paths, spread across the sorted tree rather than taken off the front, so the sample covers every published
        directory instead of only the first one alphabetically.
    """
    if count <= 0 or not files:
        return []
    paths = [path for path, _size in files]
    if len(paths) <= count:
        return paths
    step = len(paths) / count
    return [paths[int(index * step)] for index in range(count)]


def url_is_live(url):
    """
    Whether the asset host already serves a URL.

    Args:
        url: The raw GitHub URL to check.

    Returns:
        True on a 200, False on anything else. A 404 here means "not published yet" rather than a failure, and `HTTPError` and `URLError` are both
        `OSError` subclasses, so every network outcome lands in the same not-live-yet answer.
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return response.status == 200
    except OSError:
        return False


def wait_live(paths, timeout, interval):
    """
    Poll the asset host until every sampled path is served, or the timeout runs out.

    Args:
        paths: Published paths to poll, relative to `RAW_BASE`.
        timeout: How many seconds to keep polling.
        interval: How many seconds to wait between rounds.

    Returns:
        0 once every path answers 200, 1 on timeout or when there was nothing to poll.
    """
    if not paths:
        print("no paths to poll - name some, or encode the tree first")
        return 1

    deadline = time.monotonic() + timeout
    remaining = list(paths)
    while True:
        remaining = [path for path in remaining if not url_is_live(f"{RAW_BASE}/{path}")]
        if not remaining:
            print(f"all {len(paths)} sampled paths are live")
            return 0
        if time.monotonic() >= deadline:
            print(f"timed out after {timeout}s with {len(remaining)} of {len(paths)} sampled paths still not live:")
            for path in remaining:
                print(f"  {path}")
            return 1
        print(f"{len(paths) - len(remaining)}/{len(paths)} live, polling again in {interval}s")
        time.sleep(interval)


def run_wait_live(args):
    """
    Run the `wait-live` flow, polling either the paths named on the command line or a sample of the publishable tree.

    Samples `publishable_files`, not `walk_encoded` directly - a redundant crop is never copied into the clone, so polling one would always
    time out.

    Args:
        args: Parsed `wait-live` arguments, carrying `paths`, `sample` and `staging`.

    Returns:
        0 once every sampled path is served, 1 on timeout or when there was nothing to poll.
    """
    paths = args.paths or sample_paths(publishable_files(os.path.join(args.staging, "assets")), args.sample)
    print(f"polling {len(paths)} path(s) under {RAW_BASE}")
    return wait_live(paths, LIVE_TIMEOUT_SECONDS, LIVE_INTERVAL_SECONDS)


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Entry point


def main():
    """
    Parse arguments and run the requested subcommand.

    Returns:
        The process exit code: 0 on success, 1 when a check fails, a push fails or `wait-live` times out.
    """
    parser = argparse.ArgumentParser(description="Publish the encoded asset tree to the public assets repo.")
    subcommands = parser.add_subparsers(dest="command", required=True)

    add_command = subcommands.add_parser("add", help="Stage the encoded tree into a clone of the assets repo, and publish it only with --confirm.")
    add_command.add_argument("--confirm", action="store_true", help="Actually commit and push. Without it the run stops after the summary and writes nothing to the remote.")
    add_command.add_argument("--staging", default=DEFAULT_STAGING_DIR, help="Root of the staged tree. Defaults to tools/assets/.staging.")

    remove_command = subcommands.add_parser("remove", help="Delete published redundant-crop files, only with --confirm.")
    remove_command.add_argument("--staging", default=DEFAULT_STAGING_DIR, help="Root of the staged tree. Defaults to tools/assets/.staging.")
    remove_command.add_argument("--confirm", action="store_true", help="Actually delete and push. Without it this is a dry run.")

    live_command = subcommands.add_parser("wait-live", help="Poll the asset host until published files are served.")
    live_command.add_argument("paths", nargs="*", help="Published paths to poll, such as classes/guard.webp. Defaults to a sample of the encoded tree.")
    live_command.add_argument("--sample", type=int, default=DEFAULT_SAMPLE, help=f"How many paths to sample when none are named. Defaults to {DEFAULT_SAMPLE}.")
    live_command.add_argument("--staging", default=DEFAULT_STAGING_DIR, help="Root of the staged tree. Defaults to tools/assets/.staging.")

    args = parser.parse_args()
    if args.command == "add":
        return run_add(args)
    if args.command == "remove":
        return run_remove(args)
    return run_wait_live(args)


if __name__ == "__main__":
    sys.exit(main())
