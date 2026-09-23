"""
The asset half of a scheduled refresh: plan the upstream files the site does not have yet, fetch just those, and encode or copy them into a fresh
tree the existing builders can index.

    plan   list every source folder at its pinned sha, subtract what src/data records, check the limits, and write <staging>/plan.json
    fetch  download every planned file over raw.githubusercontent.com into <staging>/upstream-refresh/<source>/<repo path>
    build  encode art to <staging>/assets/<published path> with encode.py's own encoder, and copy rigs there unchanged

The naming rules are the pipeline's own, through `wanted.py`, so a refresh publishes exactly the names a full local run would.

Usage:
    python3 -u tools/assets/refresh_assets.py plan --staging DIR [--max-files N]
    python3 -u tools/assets/refresh_assets.py fetch --staging DIR
    python3 -u tools/assets/refresh_assets.py build --staging DIR
"""

import argparse
import json
import os
import shutil
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from encode import encode_all, load_enemy_ids, load_module_keys, load_operator_ids, load_skill_icon_keys
from upstream_listing import list_folder
from wanted import SOURCES, check_limits, plan_wanted, published_state

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(TOOLS_DIR)), "src", "data")
LEDGER_PATH = os.path.join(os.path.dirname(os.path.dirname(TOOLS_DIR)), "tools", "data", "asset-gaps.json")
MAX_BYTES = 200_000_000
DEFAULT_MAX_FILES = 300
USER_AGENT = "ak-archive-refresh/1.0 (https://github.com/steve1316/ak-archive)"
REQUEST_TIMEOUT_SECONDS = 120
DEFAULT_FETCH_WORKERS = 8

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Helpers


def read_json(path):
    """
    Read a JSON file.

    Args:
        path: The file.

    Returns:
        The parsed value.
    """
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def raw_url(repo, sha, repo_path):
    """
    Build the raw URL for one file, escaping each path segment, since upstream names carry `[`, `]`, `#` and `+`.

    Args:
        repo: The `owner/name` of the repo.
        sha: The commit sha.
        repo_path: The file's path in the repo.

    Returns:
        The URL.
    """
    return f"https://raw.githubusercontent.com/{repo}/{sha}/" + "/".join(urllib.parse.quote(part) for part in repo_path.split("/"))


def build_jobs(wants, staging_dir):
    """
    Turn planned wants into encode jobs and copy jobs over the fetched tree.

    Args:
        wants: The planned wants.
        staging_dir: The refresh run's staging root.

    Returns:
        An `(encode_jobs, copy_jobs)` pair. Encode jobs are `(input, output, label, kind)` quadruples for `encode.encode_all`, the kind being the
        published folder, which is how `encode_one` knows to save badges losslessly. Copy jobs are `(source, destination)` pairs.
    """
    encode_jobs = []
    copy_jobs = []
    for entry in wants:
        source = os.path.join(staging_dir, "upstream-refresh", entry["source"], *entry["repo_path"].split("/"))
        destination = os.path.join(staging_dir, "assets", *entry["published"].split("/"))
        if entry["action"] == "encode":
            label = f"{'/'.join(entry['repo_path'].split('/')[-2:])} -> {entry['published']}"
            encode_jobs.append((source, destination, label, entry["published"].split("/")[0]))
        else:
            copy_jobs.append((source, destination))
    return encode_jobs, copy_jobs


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Commands


def run_plan(args):
    """
    List every source, plan the wants, check the limits and write the plan.

    Args:
        args: Parsed arguments carrying `staging` and `max_files`.

    Returns:
        0 on success, 1 when the limits are exceeded.
    """
    listings = {}
    for source, spec in SOURCES.items():
        lock = read_json(spec["lock"])
        for role, folder in spec["folders"].items():
            listings[(source, role)] = list_folder(lock["repo"], lock["sha"], folder)
            print(f"listed {source}/{role}: {len(listings[(source, role)])} files")
    art_keys, type_keys = load_module_keys()
    ids = {"operators": load_operator_ids(), "skills": load_skill_icon_keys(), "module_art": art_keys, "module_types": type_keys, "enemies": load_enemy_ids()}
    published = published_state(
        read_json(os.path.join(DATA_DIR, "assets-manifest.json")),
        read_json(os.path.join(DATA_DIR, "spine-index.json")),
        read_json(os.path.join(DATA_DIR, "enemy-spine-index.json")),
    )
    ledger = read_json(LEDGER_PATH)
    wants = plan_wanted(listings, ids, published, set(ledger.get("skip", {})))
    for entry in wants:
        entry["repo"] = read_json(SOURCES[entry["source"]]["lock"])["repo"]
        entry["commit"] = read_json(SOURCES[entry["source"]]["lock"])["sha"]
    try:
        check_limits(wants, args.max_files, MAX_BYTES)
    except ValueError as error:
        print(f"refusing to fetch: {error}")
        return 1
    os.makedirs(args.staging, exist_ok=True)
    with open(os.path.join(args.staging, "plan.json"), "w", encoding="utf-8") as handle:
        json.dump(wants, handle, indent="\t")
    print(f"planned {len(wants)} files, {sum(entry['size'] for entry in wants) / 1e6:.1f} MB")
    for entry in wants:
        print(f"  {entry['published']}")
    return 0


def fetch_one(entry, staging):
    """
    Download one planned file and check it against the size the listing gave.

    Args:
        entry: One planned want, carrying `source`, `repo`, `commit`, `repo_path` and `size`.
        staging: The run's staging root.

    Returns:
        The downloaded file's path.

    Raises:
        RuntimeError: When the download's size does not match the listing.
    """
    target = os.path.join(staging, "upstream-refresh", entry["source"], *entry["repo_path"].split("/"))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    request = urllib.request.Request(raw_url(entry["repo"], entry["commit"], entry["repo_path"]), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response, open(target, "wb") as handle:
        shutil.copyfileobj(response, handle)
    if os.path.getsize(target) != entry["size"]:
        raise RuntimeError(f"{entry['repo_path']} downloaded {os.path.getsize(target)} bytes, the listing said {entry['size']}")
    return target


def already_fetched(entry, staging):
    """
    Whether a planned file is already on disk at the size the listing gave.

    Args:
        entry: One planned want.
        staging: The run's staging root.

    Returns:
        True when the file exists at the listed size.
    """
    target = os.path.join(staging, "upstream-refresh", entry["source"], *entry["repo_path"].split("/"))
    return os.path.exists(target) and os.path.getsize(target) == entry["size"]


def run_fetch(args):
    """
    Download every planned file, several at a time, checking each against the size the listing gave. A file already downloaded at the right size
    is kept, so a re-run after a failure resumes rather than starting over.

    Args:
        args: Parsed arguments carrying `staging` and `workers`.

    Returns:
        0 on success.

    Raises:
        RuntimeError: When a download's size does not match the listing.
    """
    wants = read_json(os.path.join(args.staging, "plan.json"))
    pending = [entry for entry in wants if not already_fetched(entry, args.staging)]
    done = len(wants) - len(pending)
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        for _path in executor.map(lambda entry: fetch_one(entry, args.staging), pending):
            done += 1
            if done % 200 == 0:
                print(f"fetched {done} of {len(wants)}")
    print(f"fetched {len(wants)} files ({len(wants) - len(pending)} already on disk)")
    return 0


def run_build(args):
    """
    Encode the fetched art and copy the fetched rigs into the run's asset tree.

    Args:
        args: Parsed arguments carrying `staging`.

    Returns:
        0 on success.
    """
    encode_jobs, copy_jobs = build_jobs(read_json(os.path.join(args.staging, "plan.json")), args.staging)
    count, total = encode_all(encode_jobs) if encode_jobs else (0, 0)
    for source, destination in copy_jobs:
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copy2(source, destination)
    print(f"encoded {count} files ({total / 1e6:.1f} MB), copied {len(copy_jobs)} rig files")
    return 0


def main():
    """Parse arguments and run one command."""
    parser = argparse.ArgumentParser(description="Plan, fetch and build only the assets the site does not have yet.")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "fetch", "build"):
        command = commands.add_parser(name)
        command.add_argument("--staging", required=True, help="The refresh run's staging root, such as $RUNNER_TEMP/staging.")
        if name == "plan":
            command.add_argument("--max-files", type=int, default=DEFAULT_MAX_FILES, help=f"The most files one run may fetch. Defaults to {DEFAULT_MAX_FILES}.")
        if name == "fetch":
            command.add_argument("--workers", type=int, default=DEFAULT_FETCH_WORKERS, help=f"How many downloads run at once. Defaults to {DEFAULT_FETCH_WORKERS}.")
    args = parser.parse_args()
    return {"plan": run_plan, "fetch": run_fetch, "build": run_build}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
