"""
The story asset pipeline: plan which files the stories reference that the story asset repo does not have yet, then record what was published.

    plan      list the mirror folders at their pinned shas, resolve every reference in src/data/story-asset-refs.json and every group's cover and map
              art, subtract what src/data/story-assets.json records, check the limits, and write <staging>/plan.json and <staging>/unavailable.json
    manifest  merge what this run built into src/data/story-assets.json, with this run's list of references the mirror does not have

Assets no mirror has can be added by hand to the story asset repo and recorded in tools/assets/story-overrides.json, with where each came from.
The manifest claims them, and the plan never lists a published asset as unavailable.

`plan.json` has the shape `refresh_assets.py` already reads, so its `fetch` and `build` commands do the downloading and encoding:

    python3 -u tools/assets/story_assets.py plan --staging DIR [--max-files N] [--max-bytes N]
    python3 -u tools/assets/refresh_assets.py fetch --staging DIR
    python3 -u tools/assets/refresh_assets.py build --staging DIR
    python3 -u tools/assets/story_assets.py manifest --staging DIR
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from story_names import MANIFEST_KINDS, REFERENCE_KINDS, cover_entry, index_by_name, index_by_path, manifest_key, manifest_kind, map_entry, published_path, resolve
from upstream_listing import list_folder
from wanted import check_limits

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(TOOLS_DIR)), "src", "data")
REFS_PATH = os.path.join(DATA_DIR, "story-asset-refs.json")
STORY_INDEX_PATH = os.path.join(DATA_DIR, "story", "story-index.json")
MANIFEST_PATH = os.path.join(DATA_DIR, "story-assets.json")

# Assets added to the story asset repo by hand because no mirror has them, by manifest kind, each with its source.
OVERRIDES_PATH = os.path.join(TOOLS_DIR, "story-overrides.json")

# Story art shares the icons pin: the same repo and branch. Audio has its own pin on the `voice` branch.
SOURCE_LOCKS = {"art": os.path.join(TOOLS_DIR, "icons.lock.json"), "audio": os.path.join(TOOLS_DIR, "story-audio.lock.json")}

# The mirror folders read for each index, and whether files are found by name or by path under the folder.
ART_FOLDERS = {
    "backgrounds": ("assets/dyn/avg/backgrounds", index_by_name),
    "images": ("assets/dyn/avg/images", index_by_name),
    "items": ("assets/dyn/avg/items", index_by_name),
    "characters": ("assets/dyn/avg/characters", index_by_path),
    "mainmission": ("assets/dyn/arts/ui/mainmission", index_by_name),
    "hubs": ("assets/dyn/arts/ui/storyreview/hubs", index_by_name),
    "zonemaps": ("assets/dyn/ui/zonemaps", index_by_name),
}

# The audio folders stories reference, listed one at a time: the whole `sound_beta_2` tree includes every voice line and is too large to list.
AUDIO_ROOT = "assets/dyn/audio"
AUDIO_FOLDERS = ("music", "avg", "ambience", "battle", "beta1leaveover", "dialog", "enemy", "general", "player")

# Daily refresh limits. A first publish passes much larger ones on the command line.
DEFAULT_MAX_FILES = 600
DEFAULT_MAX_BYTES = 400_000_000

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Planning


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


def manifest_paths(manifest):
    """
    Every published path a story asset manifest records.

    Args:
        manifest: The manifest, holding one key list per manifest kind.

    Returns:
        The set of published paths.
    """
    return {published_path(kind, key) for kind in MANIFEST_KINDS for key in manifest.get(kind, [])}


def plan_story(indexes, refs, story_index, published):
    """
    Plan the story assets to fetch.

    Args:
        indexes: Listing indexes by role, each entry carrying `repo_path` and `source`.
        refs: The reference lists by kind, from `story-asset-refs.json`.
        story_index: The story index, whose `main`, `events` and `side` groups need covers, and main episodes map art.
        published: Published paths the story asset repo already has.

    Returns:
        A `(wants, unavailable)` pair. Wants are unique by published path. Unavailable lists each reference or group id the mirror lacks and the
        story asset repo does not already have, by manifest kind.
    """
    wants = []
    seen = set(published)
    unavailable = {kind: set() for kind in MANIFEST_KINDS}

    def add(kind, key, item):
        path = published_path(kind, key)
        if path in seen:
            return
        seen.add(path)
        wants.append(
            {
                "kind": manifest_kind(kind),
                "key": manifest_key(kind, key),
                "source": item["source"],
                "repo_path": item["repo_path"],
                "size": item["size"],
                "published": path,
                "action": "copy" if path.endswith(".mp3") else "encode",
            }
        )

    for kind in REFERENCE_KINDS:
        for key in refs.get(kind, []):
            item = resolve(kind, key, indexes)
            if item is not None:
                add(kind, key, item)
            elif published_path(kind, key) not in published:
                unavailable[manifest_kind(kind)].add(key)
    for tab in ("main", "events", "side"):
        for group in story_index.get(tab, []):
            cover = cover_entry(tab, group, indexes)
            if cover is not None:
                add("covers", group["id"], cover)
            elif published_path("covers", group["id"]) not in published:
                unavailable["covers"].add(group["id"])
            art = map_entry(group["id"], indexes) if tab == "main" else None
            if art is not None:
                add("maps", group["id"], art)
    return wants, {kind: sorted(keys) for kind, keys in unavailable.items()}


def list_indexes():
    """
    List every mirror folder the story assets come from, at the pinned shas, and index each.

    Returns:
        Listing indexes by role, each entry carrying `repo_path` and `source`.

    Raises:
        RuntimeError: When a listing comes back truncated.
        urllib.error.HTTPError: When a listing request fails.
    """
    art = read_json(SOURCE_LOCKS["art"])
    audio = read_json(SOURCE_LOCKS["audio"])
    indexes = {}
    for role, (folder, index) in ART_FOLDERS.items():
        files = [{**item, "repo_path": f"{folder}/{item['path']}", "source": "art"} for item in list_folder(art["repo"], art["sha"], folder)]
        print(f"listed {role}: {len(files)} files")
        indexes[role] = index(files)
    audio_files = []
    for name in AUDIO_FOLDERS:
        folder = f"{AUDIO_ROOT}/sound_beta_2/{name}"
        listed = list_folder(audio["repo"], audio["sha"], folder)
        print(f"listed audio/{name}: {len(listed)} files")
        audio_files += [{**item, "path": f"sound_beta_2/{name}/{item['path']}", "repo_path": f"{folder}/{item['path']}", "source": "audio"} for item in listed]
    indexes["audio"] = index_by_path(audio_files)
    return indexes


def run_plan(args):
    """
    List, resolve, subtract, check the limits and write the plan.

    Args:
        args: Parsed arguments carrying `staging`, `max_files` and `max_bytes`.

    Returns:
        0 on success, 1 when the limits are exceeded.
    """
    manifest = read_json(MANIFEST_PATH) if os.path.exists(MANIFEST_PATH) else {}
    wants, unavailable = plan_story(list_indexes(), read_json(REFS_PATH), read_json(STORY_INDEX_PATH), manifest_paths(manifest))
    locks = {source: read_json(path) for source, path in SOURCE_LOCKS.items()}
    for want in wants:
        want["repo"] = locks[want["source"]]["repo"]
        want["commit"] = locks[want["source"]]["sha"]
    try:
        check_limits(wants, args.max_files, args.max_bytes)
    except ValueError as error:
        print(f"refusing to fetch: {error}")
        return 1
    os.makedirs(args.staging, exist_ok=True)
    with open(os.path.join(args.staging, "plan.json"), "w", encoding="utf-8") as handle:
        json.dump(wants, handle, indent="\t")
    with open(os.path.join(args.staging, "unavailable.json"), "w", encoding="utf-8") as handle:
        json.dump(unavailable, handle, indent="\t")
    by_kind = {}
    for want in wants:
        by_kind[want["kind"]] = by_kind.get(want["kind"], 0) + 1
    print(f"planned {len(wants)} files, {sum(want['size'] for want in wants) / 1e6:.1f} MB raw: {json.dumps(by_kind)}")
    print(f"unavailable: {json.dumps({kind: len(keys) for kind, keys in unavailable.items()})}")
    return 0


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Manifest


def build_manifest(existing, wants, unavailable, built, overrides=None):
    """
    Merge this run's published assets into the manifest. Only wants whose output was actually built are claimed, so a failed encode is planned
    again next run rather than claimed as published. Hand-added overrides are claimed as they are, and never listed as unavailable.

    Args:
        existing: The committed manifest, or an empty dict before the first run.
        wants: This run's plan.
        unavailable: This run's references the mirror lacks, by manifest kind.
        built: Published paths present under the run's `assets` folder.
        overrides: Keys added to the story asset repo by hand, by manifest kind.

    Returns:
        The manifest: one sorted key list per manifest kind, plus `unavailable`.
    """
    overrides = overrides or {}
    keys = {kind: set(existing.get(kind, [])) | set(overrides.get(kind, [])) for kind in MANIFEST_KINDS}
    for want in wants:
        if want["published"] in built:
            keys[want["kind"]].add(want["key"])
    manifest = {kind: sorted(values) for kind, values in keys.items()}
    missing = {kind: sorted(set(names) - set(overrides.get(kind, []))) for kind, names in unavailable.items()}
    manifest["unavailable"] = {kind: names for kind, names in missing.items() if names}
    return manifest


def run_manifest(args):
    """
    Write `src/data/story-assets.json` from this run's plan and built tree.

    Args:
        args: Parsed arguments carrying `staging`.

    Returns:
        0 on success.
    """
    wants = read_json(os.path.join(args.staging, "plan.json"))
    unavailable = read_json(os.path.join(args.staging, "unavailable.json"))
    assets_dir = os.path.join(args.staging, "assets")
    built = {want["published"] for want in wants if os.path.exists(os.path.join(assets_dir, *want["published"].split("/")))}
    existing = read_json(MANIFEST_PATH) if os.path.exists(MANIFEST_PATH) else {}
    overrides = read_json(OVERRIDES_PATH) if os.path.exists(OVERRIDES_PATH) else {}
    manifest = build_manifest(existing, wants, unavailable, built, {kind: list(entries) for kind, entries in overrides.items()})
    with open(MANIFEST_PATH, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, separators=(",", ":"))
        handle.write("\n")
    print(f"manifest: {json.dumps({kind: len(manifest[kind]) for kind in MANIFEST_KINDS})}, {len(built)} of {len(wants)} planned files built")
    return 0


def main():
    """Parse arguments and run one command."""
    parser = argparse.ArgumentParser(description="Plan and record the story assets the site does not have yet.")
    commands = parser.add_subparsers(dest="command", required=True)
    plan_command = commands.add_parser("plan")
    plan_command.add_argument("--staging", required=True, help="The run's staging root, such as tools/assets/.staging-story.")
    plan_command.add_argument("--max-files", type=int, default=DEFAULT_MAX_FILES, help=f"The most files one run may fetch. Defaults to {DEFAULT_MAX_FILES}.")
    plan_command.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES, help=f"The most raw bytes one run may fetch. Defaults to {DEFAULT_MAX_BYTES}.")
    manifest_command = commands.add_parser("manifest")
    manifest_command.add_argument("--staging", required=True, help="The run's staging root.")
    args = parser.parse_args()
    return {"plan": run_plan, "manifest": run_manifest}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
