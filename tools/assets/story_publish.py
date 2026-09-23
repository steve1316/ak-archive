"""
Publish the story asset tree to `steve1316/ak-archive-story`.

This is the story side's one irreversible step, so `add` is a dry run by default: it clones, checks sizes, copies the tree in and says what would
go out. Only `--confirm` reaches `publish.publish_batches`, which holds the push. The clone is always blobless and sparse - the story repo runs to
gigabytes and a run only ever adds files - and the helpers are `publish.py`'s own, so both publishers batch, resume and refuse the same way.

Git LFS is never configured: raw.githubusercontent.com serves an LFS pointer rather than the file.

Usage:
    python3 -u tools/assets/story_publish.py add [--confirm] [--staging DIR] [--remote URL]
    python3 -u tools/assets/story_publish.py wait-live [--staging DIR] [--sample N]
"""

import argparse
import os
import random
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from publish import clone_sparse, format_bytes, pending_changes, publish_batches, url_is_live, with_sizes
from publish_checks import BATCH_BYTES, WARN_TOTAL_BYTES, check_sizes, plan_batches

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_STAGING_DIR = os.path.join(TOOLS_DIR, ".staging-story")
REPO = "steve1316/ak-archive-story"
HTTPS_URL = f"https://github.com/{REPO}.git"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/main"

# How long `wait-live` polls, how often, and how many paths it samples.
LIVE_TIMEOUT_SECONDS = 20 * 60
LIVE_INTERVAL_SECONDS = 30
DEFAULT_SAMPLE = 5

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Publishing


def staged_files(assets_dir):
    """
    Every file in the built story tree.

    Args:
        assets_dir: The run's `assets` folder.

    Returns:
        Sorted `(path, size)` pairs, each path relative to `assets_dir` with forward slashes. Empty when the folder does not exist.
    """
    files = []
    for root, _dirs, names in os.walk(assets_dir):
        for name in names:
            full = os.path.join(root, name)
            files.append((os.path.relpath(full, assets_dir).replace(os.sep, "/"), os.path.getsize(full)))
    return sorted(files)


def run_add(args):
    """
    Clone, check sizes, copy the tree in, summarise, and publish only with `--confirm`.

    Args:
        args: Parsed arguments carrying `staging`, `remote` and `confirm`.

    Returns:
        0 when the run finished, 1 when a size check failed or a push failed.

    Raises:
        RuntimeError: When the clone folder already exists.
        subprocess.CalledProcessError: When a git command fails.
    """
    assets_dir = os.path.join(args.staging, "assets")
    publish_dir = os.path.join(args.staging, "publish")
    files = staged_files(assets_dir)
    if not files:
        print("nothing built, nothing to publish")
        return 0
    problems = check_sizes(files)
    if problems:
        print("refusing to publish, nothing was written:")
        for problem in problems:
            print(f"  {problem}")
        return 1
    total = sum(size for _path, size in files)
    if total > WARN_TOTAL_BYTES:
        print(f"warning: {format_bytes(total)} is past the {format_bytes(WARN_TOTAL_BYTES)} warn line, still under the refuse line")
    if os.path.exists(publish_dir):
        shutil.rmtree(publish_dir)
    clone_sparse(publish_dir, args.remote, [path for path, _size in files])
    for path, _size in files:
        destination = os.path.join(publish_dir, *path.split("/"))
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copy2(os.path.join(assets_dir, *path.split("/")), destination)
    new, changed, _ignored = pending_changes(publish_dir)
    pending = with_sizes(publish_dir, sorted(new + changed))
    batches = plan_batches(pending, BATCH_BYTES)
    print(f"target   {REPO} on main")
    print(f"built    {len(files)} files, {format_bytes(total)}")
    print(f"pending  {len(new)} new, {len(changed)} changed, {format_bytes(sum(size for _path, size in pending))}")
    print(f"batches  {len(batches)}, at most {format_bytes(BATCH_BYTES)} each")
    if not args.confirm:
        print("--confirm was not passed: nothing was written to the remote.")
        return 0
    return publish_batches(publish_dir, batches, set(new), confirm=True)


def run_wait_live(args):
    """
    Poll a sample of the built paths until the asset host serves them.

    Args:
        args: Parsed arguments carrying `staging` and `sample`.

    Returns:
        0 when every sampled path is live, 1 on timeout.
    """
    files = [path for path, _size in staged_files(os.path.join(args.staging, "assets"))]
    remaining = random.sample(files, min(args.sample, len(files)))
    deadline = time.time() + LIVE_TIMEOUT_SECONDS
    while remaining:
        remaining = [path for path in remaining if not url_is_live(f"{RAW_BASE}/{path}")]
        if not remaining:
            break
        if time.time() > deadline:
            print(f"still not live after {LIVE_TIMEOUT_SECONDS // 60} minutes: {', '.join(remaining)}")
            return 1
        time.sleep(LIVE_INTERVAL_SECONDS)
    print("sampled story assets are live")
    return 0


def main():
    """Parse arguments and run one command."""
    parser = argparse.ArgumentParser(description="Publish the story asset tree to the story asset repo.")
    commands = parser.add_subparsers(dest="command", required=True)
    add_command = commands.add_parser("add")
    add_command.add_argument("--confirm", action="store_true", help="Actually commit and push. Without it this is a dry run.")
    add_command.add_argument("--staging", default=DEFAULT_STAGING_DIR, help="The run's staging root. Defaults to tools/assets/.staging-story.")
    add_command.add_argument("--remote", default=HTTPS_URL, help="Clone and push over this URL. Defaults to the HTTPS remote; the refresh passes SSH.")
    live_command = commands.add_parser("wait-live")
    live_command.add_argument("--staging", default=DEFAULT_STAGING_DIR, help="The run's staging root.")
    live_command.add_argument("--sample", type=int, default=DEFAULT_SAMPLE, help=f"How many paths to poll. Defaults to {DEFAULT_SAMPLE}.")
    args = parser.parse_args()
    return {"add": run_add, "wait-live": run_wait_live}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
