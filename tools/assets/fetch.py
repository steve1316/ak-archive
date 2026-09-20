"""
Fetch the raw material for the asset pipeline: operator art from one GitHub mirror, class icons from another.

The two fetches are unrelated and share nothing but this command line. `--only art` pulls `charpor` (portraits) and `charpack`
(illustrations) out of `fexli/ArknightsResource` with a sparse, blobless clone, so only the two wanted directories are checked out
of a repo that is 17.8 GB whole - this pulls about 6.5 GB. `--only icons` downloads the 8 class icons from `Aceship/Arknight-Images`,
a repo that is dead (last push 2024-05-01) but still serves; those icons never change, so this takes them once and stops depending
on it. Neither stage produces anything the site reads - later pipeline stages re-encode this staged tree to WebP and publish it.
See `PROJECT.md` for the mirror decisions behind both sources.

Usage:
    python3 -u tools/assets/fetch.py [--only {art,icons}]
"""

import argparse
import os
import shutil
import subprocess
import urllib.request


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
STAGING_DIR = os.path.join(TOOLS_DIR, ".staging")
UPSTREAM_DIR = os.path.join(STAGING_DIR, "upstream")
CLASSES_DIR = os.path.join(STAGING_DIR, "classes")

# Art mirror: a sparse, blobless clone of this repo, narrowed to the two directories the site needs.
CLONE_URL = "https://github.com/fexli/ArknightsResource.git"
ART_DIRS = ("charpor", "charpack")

# Icon mirror: dead but still serving, kept only for these 8 files.
ICON_BASE = "https://raw.githubusercontent.com/Aceship/Arknight-Images/main/classes"
ICON_CLASSES = ("caster", "defender", "guard", "medic", "sniper", "specialist", "supporter", "vanguard")

# GitHub rejects the Python default User-Agent on raw.githubusercontent.com requests.
USER_AGENT = "ak-archive-asset-fetch/1.0 (fan site asset pipeline; https://github.com/steve1316/ak-archive)"


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Helpers


def directory_stats(path):
    """
    Count files and total bytes under a directory tree.

    Args:
        path: Directory to walk.

    Returns:
        A `(file_count, total_bytes)` pair. `(0, 0)` when `path` does not exist.
    """
    if not os.path.isdir(path):
        return 0, 0
    count = 0
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            count += 1
            total += os.path.getsize(os.path.join(root, name))
    return count, total


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


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Art


def is_git_repo(path):
    """
    Whether `path` itself is the root of a usable git repository, not merely nested inside one.

    This deliberately does not shell out to `git rev-parse --git-dir`. Git's repository discovery walks upward from `path`
    until it finds a `.git`, so a plain, git-less directory does not have to contain one to pass - it only has to sit inside a
    repo somewhere. `<staging>/upstream` always sits inside ak-archive's own working tree, so a directory left by an interrupted
    clone before `.git` ever appeared would discover ak-archive's own `.git` and report success. That is a real trap: the caller
    would then run `git fetch` and a pathspec-less `git checkout -f` against ak-archive itself instead of the clone, and the
    checkout force-replaces the whole working tree. Checking for `path/.git` directly confirms `path` is a repo root, not just
    somewhere under one. This pipeline only ever creates its own plain clone at this path, never a worktree, so `.git` is always
    a directory here rather than the file a worktree would leave, and the simpler, subprocess-free check is enough.

    Args:
        path: Directory to check.

    Returns:
        True when `path` exists and holds its own `.git` directory, False otherwise.
    """
    return os.path.isdir(os.path.join(path, ".git"))


def remove_invalid_clone(path):
    """
    Delete a directory that failed the git-repo validity check, refusing to touch anything outside `STAGING_DIR`.

    Automatic deletion is normally not something this pipeline does unprompted, so the guard is asserted here rather than trusted
    to the caller: `path` must resolve to somewhere inside `STAGING_DIR`, never the staging directory itself and never anywhere
    outside it, or the function raises instead of removing anything.

    Args:
        path: Directory to remove.

    Raises:
        AssertionError: If `path` does not resolve inside `STAGING_DIR`.
    """
    real_path = os.path.realpath(path)
    real_staging = os.path.realpath(STAGING_DIR)
    assert real_path.startswith(real_staging + os.sep), f"refusing to remove {path}: not inside {STAGING_DIR}"
    shutil.rmtree(real_path)


def clone_or_refresh_art():
    """
    Materialise `charpor` and `charpack` from the upstream art mirror at `<staging>/upstream`.

    A blobless, sparse clone pulls the whole ref list but skips file content until checkout, and sparse-checkout then narrows the
    checkout to the two wanted directories, so the ~17.8 GB repo costs about 6.5 GB instead of the whole tree. When the clone
    already exists, this fetches and hard-checks-out the latest commit instead of cloning again, so a re-run refreshes rather
    than failing on an existing directory.

    A 6.5 GB transfer is exactly the kind that gets interrupted - SIGINT, a dropped connection, an OOM kill - which leaves
    `<staging>/upstream` present but without a complete `.git`. Presence alone would send the next run down the refresh branch,
    where `git fetch` fails on a non-repo and the script stays wedged until someone manually removes the directory. So presence
    is checked with `is_git_repo` first: an invalid directory is reported and removed, then cloned fresh, rather than left to
    block every future run. `--progress` is passed to `clone` and `fetch` so a run redirected to a log file - the way this
    pipeline is normally run - still shows the transfer moving instead of going silent, since git only emits its live meter
    when stderr is a tty.

    Raises:
        subprocess.CalledProcessError: If any `git` command fails.
        AssertionError: If recovering from an invalid clone would remove a path outside `STAGING_DIR`.
    """
    if os.path.isdir(UPSTREAM_DIR) and not is_git_repo(UPSTREAM_DIR):
        print(f"{UPSTREAM_DIR} exists but is not a valid git repository - a previous clone was likely interrupted, removing it")
        remove_invalid_clone(UPSTREAM_DIR)

    if os.path.isdir(UPSTREAM_DIR):
        subprocess.run(["git", "-C", UPSTREAM_DIR, "fetch", "--progress", "--depth", "1", "origin", "main"], check=True)
        subprocess.run(["git", "-C", UPSTREAM_DIR, "checkout", "-f", "origin/main"], check=True)
    else:
        os.makedirs(STAGING_DIR, exist_ok=True)
        subprocess.run(["git", "clone", "--filter=blob:none", "--sparse", "--progress", "--depth", "1", CLONE_URL, UPSTREAM_DIR], check=True)
        subprocess.run(["git", "-C", UPSTREAM_DIR, "sparse-checkout", "set", *ART_DIRS], check=True)


def fetch_art():
    """
    Clone or refresh the art mirror, then print file count and total bytes for each staged directory.

    Raises:
        subprocess.CalledProcessError: If any `git` command fails.
        AssertionError: If recovering from an invalid clone would remove a path outside `STAGING_DIR`.
    """
    clone_or_refresh_art()
    for name in ART_DIRS:
        count, total = directory_stats(os.path.join(UPSTREAM_DIR, name))
        print(f"art/{name}: {count} files, {format_bytes(total)}")


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Icons


def download_icon(name):
    """
    Download one class icon to `<staging>/classes/<name>.png`, skipping it if already staged.

    Args:
        name: The class name, e.g. `caster`.

    Raises:
        urllib.error.URLError: If the request fails outright.
        urllib.error.HTTPError: If GitHub returns a non-2xx status.
    """
    dest = os.path.join(CLASSES_DIR, f"{name}.png")
    if os.path.exists(dest):
        return
    url = f"{ICON_BASE}/class_{name}.png"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request) as response:
        data = response.read()
    with open(dest, "wb") as handle:
        handle.write(data)


def fetch_icons():
    """
    Download the 8 class icons, then print the file count and total bytes staged.

    Raises:
        urllib.error.URLError: If a download fails outright.
        urllib.error.HTTPError: If GitHub returns a non-2xx status.
    """
    os.makedirs(CLASSES_DIR, exist_ok=True)
    for name in ICON_CLASSES:
        download_icon(name)
    count, total = directory_stats(CLASSES_DIR)
    print(f"icons: {count} files, {format_bytes(total)}")


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Entry point


def main():
    """Parse arguments and run the requested fetch stage, or both when `--only` is omitted."""
    parser = argparse.ArgumentParser(description="Fetch operator art and class icons for the asset pipeline.")
    parser.add_argument("--only", choices=("art", "icons"), help="Fetch only this stage. Defaults to both.")
    args = parser.parse_args()

    stages = (args.only,) if args.only else ("art", "icons")
    if "art" in stages:
        fetch_art()
    if "icons" in stages:
        fetch_icons()


if __name__ == "__main__":
    main()
