"""
Fetch the raw material for the asset pipeline: operator art from one GitHub mirror, skill/potential/elite/class icons from another.

The two fetches are unrelated and share nothing but this command line and the sparse-clone machinery. `--only art` pulls `charpor` (portraits),
`charpack` (illustrations), and `spine` (chibi rigs) out of `fexli/ArknightsResource` with a sparse, blobless clone, so only the three wanted
directories are checked out of a repo that is 17.8 GB whole - this pulls about 9.2 GB. `--only icons` pulls `skills`, `potential_hub`, `elite_hub`,
`profession_large_hub`, `charportraits` and the module art and badges under `ui/` out of `ArknightsAssets/ArknightsAssets2` the same way. `charportraits` stands in for the operators
whose portrait `charpor` stopped carrying after October 2025. Its `en` branch is refreshed hourly by the repo's own GitHub Actions
job, so it stays current on its own and the 8 class icons no longer depend on the dead `Aceship/Arknight-Images` mirror. `--only enemies` pulls just `enemy`
(the 158x158 handbook icons) out of `fexli/ArknightsResource` into a clone of its own, pinned by its own lock, so refreshing enemy icons never
moves the sha the operator art was taken from. `--only enemy-spine` pulls `models_enemies` (enemy chibi rigs)
out of `isHarryh/Ark-Models` into its own clone and lock. No stage produces anything the site reads - later
pipeline stages re-encode this staged tree to WebP and publish it.
See `PROJECT.md` for the mirror decisions behind both sources.

Usage:
    python3 -u tools/assets/fetch.py [--only {art,icons,enemies,enemy-spine}]
"""

import argparse
import json
import os
import shutil
import subprocess


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
STAGING_DIR = os.path.join(TOOLS_DIR, ".staging")
UPSTREAM_DIR = os.path.join(STAGING_DIR, "upstream")
CLASSES_DIR = os.path.join(STAGING_DIR, "classes")

# Art mirror: a sparse, blobless clone of this repo, narrowed to the three directories the site needs.
CLONE_URL = "https://github.com/fexli/ArknightsResource.git"
ART_BRANCH = "main"
ART_DIRS = ("charpor", "charpack", "spine")
LOCK_PATH = os.path.join(TOOLS_DIR, "upstream.lock.json")

# Enemy icons: the same mirror as the art, in a separate clone narrowed to one directory and pinned by its own lock.
ENEMIES_DIR = os.path.join(STAGING_DIR, "enemies-upstream")
ENEMY_DIRS = ("enemy",)
ENEMIES_LOCK_PATH = os.path.join(TOOLS_DIR, "enemies.lock.json")

# Enemy chibi rigs: a sparse clone of this repo narrowed to its enemy folder, pinned by its own lock. fexli, the operator rig source, has none.
ENEMY_SPINE_CLONE_URL = "https://github.com/isHarryh/Ark-Models.git"
ENEMY_SPINE_REPO = "isHarryh/Ark-Models"
ENEMY_SPINE_BRANCH = "main"
ENEMY_SPINE_DIR = os.path.join(STAGING_DIR, "enemy-spine-upstream")
ENEMY_SPINE_DIRS = ("models_enemies",)
ENEMY_SPINE_LOCK_PATH = os.path.join(TOOLS_DIR, "enemy-spine.lock.json")

# Icon mirror: `en` is refreshed by the repo's own hourly GitHub Actions job from each new EN client, so it stays current on its own.
ICONS_CLONE_URL = "https://github.com/ArknightsAssets/ArknightsAssets2.git"
ICONS_REPO = "ArknightsAssets/ArknightsAssets2"
ICONS_BRANCH = "en"
ICONS_DIR = os.path.join(STAGING_DIR, "icons-upstream")
ICONS_ARTS = "assets/dyn/arts"
ICON_DIRS = tuple(f"{ICONS_ARTS}/{name}" for name in ("skills", "potential_hub", "elite_hub", "profession_large_hub", "charportraits", "ui/uniequipimgsmall", "ui/uniequipdirection"))
ICONS_LOCK_PATH = os.path.join(TOOLS_DIR, "icons.lock.json")

# Upstream's `profession_large_hub/icon_profession_<stem>_large.png` stem, mapped to the class name the site already publishes under `classes/`.
CLASS_FILES = {"caster": "caster", "medic": "medic", "pioneer": "vanguard", "sniper": "sniper", "special": "specialist", "support": "supporter", "tank": "defender", "warrior": "guard"}


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


def clone_or_refresh_sparse(path, url, branch, dirs):
    """
    Materialise `dirs` from a sparse mirror at `path`.

    A blobless, sparse clone pulls the whole ref list but skips file content until checkout, and sparse-checkout then narrows the
    checkout to the wanted directories, so a large repo costs a fraction of the whole tree. When the clone already exists,
    this re-applies the sparse-checkout cone before fetching and hard-checking-out the latest commit, instead of cloning again,
    so a re-run refreshes rather than failing on an existing directory.

    The refresh branch sets the cone before `checkout -f`, not after. `checkout -f` force-replaces the working tree to match
    the *current* sparse-checkout cone, deleting anything outside it - so if `dirs` has grown since the clone was made, the
    old cone is still what `checkout -f` enforces unless the cone is widened first. Setting it first means the force-checkout
    materialises the newly-added directories instead of wiping out a partial fetch of them from a prior interrupted run.

    A large transfer is exactly the kind that gets interrupted - SIGINT, a dropped connection, an OOM kill - which leaves
    `path` present but without a complete `.git`. Presence alone would send the next run down the refresh branch,
    where `git fetch` fails on a non-repo and the script stays wedged until someone manually removes the directory. So presence
    is checked with `is_git_repo` first: an invalid directory is reported and removed, then cloned fresh, rather than left to
    block every future run. `--progress` is passed to `clone` and `fetch` so a run redirected to a log file - the way this
    pipeline is normally run - still shows the transfer moving instead of going silent, since git only emits its live meter
    when stderr is a tty. `gc.auto` is disabled on the clone right after it is created or refreshed, since this is a gitignored
    scratch clone that gains nothing from git's automatic maintenance, and a large fetch otherwise triggers a multi-minute
    cruft repack that roughly doubles `.git` on disk.

    Args:
        path: Directory to clone into, or refresh if it already holds a clone.
        url: Git URL of the mirror to clone.
        branch: Branch to clone or fetch.
        dirs: Directories to narrow the sparse-checkout cone to.

    Raises:
        subprocess.CalledProcessError: If any `git` command fails.
        AssertionError: If recovering from an invalid clone would remove a path outside `STAGING_DIR`.
    """
    if os.path.isdir(path) and not is_git_repo(path):
        print(f"{path} exists but is not a valid git repository - a previous clone was likely interrupted, removing it")
        remove_invalid_clone(path)

    if os.path.isdir(path):
        subprocess.run(["git", "-C", path, "config", "gc.auto", "0"], check=True)
        subprocess.run(["git", "-C", path, "sparse-checkout", "set", *dirs], check=True)
        subprocess.run(["git", "-C", path, "fetch", "--progress", "--depth", "1", "origin", branch], check=True)
        subprocess.run(["git", "-C", path, "checkout", "-f", f"origin/{branch}"], check=True)
    else:
        os.makedirs(STAGING_DIR, exist_ok=True)
        subprocess.run(["git", "clone", "--filter=blob:none", "--sparse", "--progress", "--depth", "1", "--branch", branch, url, path], check=True)
        subprocess.run(["git", "-C", path, "config", "gc.auto", "0"], check=True)
        subprocess.run(["git", "-C", path, "sparse-checkout", "set", *dirs], check=True)


def write_lock(path, repo, branch, lock_path):
    """
    Record the commit a mirror was taken from, mirroring `tools/data/upstream.lock.json`.

    Without this the published art has no provenance. The mirror is a moving branch with no releases, so once the staging clone is deleted there is
    no way to answer which upstream commit a given file came from, or to reproduce the encode. The lock is small and committed, unlike the clone.

    Args:
        path: Directory holding the clone to read the current commit from.
        repo: The `owner/name` of the mirror, recorded for provenance.
        branch: The branch the clone tracks, recorded for provenance.
        lock_path: File to write the lock JSON to.

    Returns:
        The recorded sha.

    Raises:
        subprocess.CalledProcessError: If `git rev-parse` fails.
    """
    result = subprocess.run(["git", "-C", path, "rev-parse", "HEAD"], check=True, capture_output=True, text=True)
    sha = result.stdout.strip()
    lock = {"repo": repo, "branch": branch, "sha": sha}
    with open(lock_path, "w") as handle:
        json.dump(lock, handle, indent="\t")
        handle.write("\n")
    return sha


def fetch_art():
    """
    Clone or refresh the art mirror, record its sha, then print file count and total bytes for each staged directory.

    Raises:
        subprocess.CalledProcessError: If any `git` command fails.
        AssertionError: If recovering from an invalid clone would remove a path outside `STAGING_DIR`.
    """
    clone_or_refresh_sparse(UPSTREAM_DIR, CLONE_URL, ART_BRANCH, ART_DIRS)
    print(f"art/sha: {write_lock(UPSTREAM_DIR, 'fexli/ArknightsResource', ART_BRANCH, LOCK_PATH)}")
    for name in ART_DIRS:
        count, total = directory_stats(os.path.join(UPSTREAM_DIR, name))
        print(f"art/{name}: {count} files, {format_bytes(total)}")


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Icons


def fetch_icons():
    """
    Clone or refresh the icon mirror, record its sha, copy the 8 class icons into `<staging>/classes`, then print what was staged.

    The class icons used to come from `Aceship/Arknight-Images`, which stopped updating in 2024. They are copied into the same place under the
    same names, so `encode.py` and the published `classes/` paths do not change.

    Raises:
        subprocess.CalledProcessError: If any `git` command fails.
        AssertionError: If recovering from an invalid clone would remove a path outside `STAGING_DIR`.
        FileNotFoundError: If upstream no longer has one of the 8 class icons.
    """
    clone_or_refresh_sparse(ICONS_DIR, ICONS_CLONE_URL, ICONS_BRANCH, ICON_DIRS)
    print(f"icons/sha: {write_lock(ICONS_DIR, ICONS_REPO, ICONS_BRANCH, ICONS_LOCK_PATH)}")
    os.makedirs(CLASSES_DIR, exist_ok=True)
    source = os.path.join(ICONS_DIR, ICONS_ARTS, "profession_large_hub")
    for stem, name in CLASS_FILES.items():
        shutil.copyfile(os.path.join(source, f"icon_profession_{stem}_large.png"), os.path.join(CLASSES_DIR, f"{name}.png"))
    for directory in ICON_DIRS:
        count, total = directory_stats(os.path.join(ICONS_DIR, directory))
        print(f"icons/{directory.rsplit('/', 1)[-1]}: {count} files, {format_bytes(total)}")


def fetch_enemies():
    """
    Clone or refresh the enemy icon clone, record its sha, then print what was staged.

    Raises:
        subprocess.CalledProcessError: If any `git` command fails.
        AssertionError: If recovering from an invalid clone would remove a path outside `STAGING_DIR`.
    """
    clone_or_refresh_sparse(ENEMIES_DIR, CLONE_URL, ART_BRANCH, ENEMY_DIRS)
    print(f"enemies/sha: {write_lock(ENEMIES_DIR, 'fexli/ArknightsResource', ART_BRANCH, ENEMIES_LOCK_PATH)}")
    count, total = directory_stats(os.path.join(ENEMIES_DIR, "enemy"))
    print(f"enemies/enemy: {count} files, {format_bytes(total)}")


def fetch_enemy_spine():
    """
    Clone or refresh the enemy rig clone, record its sha, then print what was staged.

    Raises:
        subprocess.CalledProcessError: If any `git` command fails.
        AssertionError: If recovering from an invalid clone would remove a path outside `STAGING_DIR`.
    """
    clone_or_refresh_sparse(ENEMY_SPINE_DIR, ENEMY_SPINE_CLONE_URL, ENEMY_SPINE_BRANCH, ENEMY_SPINE_DIRS)
    print(f"enemy-spine/sha: {write_lock(ENEMY_SPINE_DIR, ENEMY_SPINE_REPO, ENEMY_SPINE_BRANCH, ENEMY_SPINE_LOCK_PATH)}")
    count, total = directory_stats(os.path.join(ENEMY_SPINE_DIR, "models_enemies"))
    print(f"enemy-spine/models_enemies: {count} files, {format_bytes(total)}")


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Entry point


def main():
    """Parse arguments and run the requested fetch stage, or every stage when `--only` is omitted."""
    parser = argparse.ArgumentParser(description="Fetch operator art, class icons, enemy icons and enemy chibi rigs for the asset pipeline.")
    parser.add_argument("--only", choices=("art", "icons", "enemies", "enemy-spine"), help="Fetch only this stage. Defaults to all four.")
    args = parser.parse_args()

    stages = (args.only,) if args.only else ("art", "icons", "enemies", "enemy-spine")
    if "art" in stages:
        fetch_art()
    if "icons" in stages:
        fetch_icons()
    if "enemies" in stages:
        fetch_enemies()
    if "enemy-spine" in stages:
        fetch_enemy_spine()


if __name__ == "__main__":
    main()
