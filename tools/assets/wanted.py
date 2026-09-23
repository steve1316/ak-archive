"""
Work out which upstream files a refresh run must fetch: every file for an id the importer wrote, mapped to the path it would publish at, minus what
the committed manifest and rig indexes already record.

The mapping reuses the pipeline's own naming rules through their listing-based entry points, so a refresh publishes exactly the names a full local
run would. Planning from the full listing rather than from a diff is what makes the order of arrival irrelevant: art that landed before its operator
reached the game data is simply wanted on the day the data lands.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from encode import ICONS_ARTS_DIR, plan_module_names, plan_skill_names, plan_variant_names
from stage_enemy_spine import plan_enemy_rig_paths
from stage_spine import plan_rig_paths

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))

# The icon mirror's art root, as a repo path. `ICONS_ARTS_DIR` is the local staging path, which prefixes it with the clone's folder name.
ICONS_ARTS = "/".join(ICONS_ARTS_DIR.split(os.sep)[1:])

# Every source a refresh reads: its lock file, and each folder it lists by role.
SOURCES = {
    "art": {"lock": os.path.join(TOOLS_DIR, "upstream.lock.json"), "folders": {"charpor": "charpor", "charpack": "charpack", "spine": "spine"}},
    "enemies": {"lock": os.path.join(TOOLS_DIR, "enemies.lock.json"), "folders": {"enemy": "enemy"}},
    "icons": {
        "lock": os.path.join(TOOLS_DIR, "icons.lock.json"),
        "folders": {
            "skills": f"{ICONS_ARTS}/skills",
            "charportraits": f"{ICONS_ARTS}/charportraits",
            "modules": f"{ICONS_ARTS}/ui/uniequipimgsmall",
            "badges": f"{ICONS_ARTS}/ui/uniequipdirection",
        },
    },
    "enemy-spine": {"lock": os.path.join(TOOLS_DIR, "enemy-spine.lock.json"), "folders": {"rigs": "models_enemies"}},
}

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Published state


def published_state(manifest, spine_index, enemy_spine_index):
    """
    Collect every published path the committed data records, plus the rig folders the indexes name.

    Args:
        manifest: The committed `assets-manifest.json`.
        spine_index: The committed `spine-index.json`.
        enemy_spine_index: The committed `enemy-spine-index.json`.

    Returns:
        A dict with `files`, a set of published file paths, and `rig_dirs`, a set of published rig folders such as `spine/char_a/base/battle`.
    """
    files = set()
    for kind in ("portraits", "illustrations"):
        files.update(f"{kind}/{entry}.webp" for entry, present in manifest.get(kind, {}).items() if present)
        for entry, keys in manifest.get("variants", {}).get(kind, {}).items():
            files.update(f"{kind}/{entry}_{key}.webp" for key in keys)
    files.update(f"skills/{key}.webp" for key in manifest.get("skillIcons", []))
    files.update(f"modules/{key}.webp" for key in manifest.get("moduleArt", []))
    files.update(f"module-types/{key}.webp" for key in manifest.get("moduleTypes", []))
    files.update(f"enemies/{entry}.webp" for entry, present in manifest.get("enemies", {}).items() if present)
    rig_dirs = {f"spine/{operator}/{form}/{kind}" for operator, forms in spine_index.items() for form, kinds in forms.items() for kind in kinds}
    rig_dirs.update(f"spine-enemies/{enemy}" for enemy in enemy_spine_index)
    return {"files": files, "rig_dirs": rig_dirs}


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Planning


def want(source, role, entry, published, action):
    """
    Build one wanted file.

    Args:
        source: The source name, a key of `SOURCES`.
        role: The folder role the entry was listed under.
        entry: The listing entry.
        published: The path it publishes at.
        action: `encode` or `copy`.

    Returns:
        The want dict.
    """
    folder = SOURCES[source]["folders"][role]
    return {"source": source, "repo_path": f"{folder}/{entry['path']}", "published": published, "size": entry["size"], "sha": entry["sha"], "action": action}


def unique_rig_wants(source, role, entries_by_path, pairs, rig_dirs):
    """
    Turn rig pairs into wants for every readable rig folder not yet indexed, failing when two different upstream files would publish to one path.

    Args:
        source: The source name.
        role: The folder role.
        entries_by_path: Listing entries keyed by relative path.
        pairs: `(upstream_path, published_path)` pairs.
        rig_dirs: Published rig folders already indexed.

    Returns:
        A list of wants.

    Raises:
        ValueError: When two upstream files with different contents map to the same published path.
    """
    by_destination = {}
    for upstream, published in pairs:
        first = by_destination.setdefault(published, upstream)
        if first != upstream and entries_by_path[first]["sha"] != entries_by_path[upstream]["sha"]:
            raise ValueError(f"two different upstream files publish to {published}: {first} and {upstream}")
    # A folder with no skeleton or no atlas can never be indexed, since `build_spine_index.read_rig` needs both. Fetching it would only repeat
    # every run, so it is left out, the same as a local run would leave it unindexed.
    readable = set()
    for extension in (".skel", ".atlas"):
        folders = {published.rsplit("/", 1)[0] for published in by_destination if published.endswith(extension)}
        readable = folders if extension == ".skel" else readable & folders
    wants = []
    for published, upstream in sorted(by_destination.items()):
        folder = published.rsplit("/", 1)[0]
        if folder in readable and folder not in rig_dirs:
            wants.append(want(source, role, entries_by_path[upstream], published, "copy"))
    return wants


def plan_wanted(listings, ids, published):
    """
    Work out every upstream file to fetch.

    Args:
        listings: Listing entries keyed by `(source, role)`, as `list_folder` returns them.
        ids: A dict with `operators`, `skills`, `module_art`, `module_types` and `enemies` sets, from the importer's output.
        published: The dict `published_state` returns.

    Returns:
        A list of wants, sorted by published path.

    Raises:
        ValueError: When two different upstream rig files map to one published path.
    """
    files = published["files"]
    wants = []

    def by_name(key):
        """
        Index one flat folder's listing by file name, ignoring anything in a subfolder.

        Args:
            key: The `(source, role)` listing key.

        Returns:
            Listing entries keyed by file name.
        """
        return {entry["path"]: entry for entry in listings[key] if "/" not in entry["path"]}

    portraits, fallback, packs = by_name(("art", "charpor")), by_name(("icons", "charportraits")), by_name(("art", "charpack"))
    names, _skipped = plan_variant_names(list(portraits), list(fallback), ids["operators"])
    for source, name, out in names:
        entry, origin = (portraits[name], ("art", "charpor")) if source == "primary" else (fallback[name], ("icons", "charportraits"))
        wants.append(want(*origin, entry, f"portraits/{out}", "encode"))
    names, _skipped = plan_variant_names(list(packs), [], ids["operators"])
    wants.extend(want("art", "charpack", packs[name], f"illustrations/{out}", "encode") for _source, name, out in names)

    skills = by_name(("icons", "skills"))
    pairs, _missing = plan_skill_names(list(skills), ids["skills"])
    wants.extend(want("icons", "skills", skills[name], f"skills/{key}.webp", "encode") for name, key in pairs)

    art, badges = by_name(("icons", "modules")), by_name(("icons", "badges"))
    triples, _missing = plan_module_names(list(art), list(badges), ids["module_art"], ids["module_types"])
    for folder, name, path in triples:
        wants.append(want("icons", "modules", art[name], path, "encode") if folder == "uniequipimgsmall" else want("icons", "badges", badges[name], path, "encode"))

    enemy_icons = by_name(("enemies", "enemy"))
    for enemy in sorted(ids["enemies"]):
        if f"{enemy}.png" in enemy_icons:
            wants.append(want("enemies", "enemy", enemy_icons[f"{enemy}.png"], f"enemies/{enemy}.webp", "encode"))

    wants = [entry for entry in wants if entry["published"] not in files]

    spine = {entry["path"]: entry for entry in listings[("art", "spine")]}
    pairs, _skipped = plan_rig_paths(list(spine), ids["operators"])
    wants.extend(unique_rig_wants("art", "spine", spine, pairs, published["rig_dirs"]))
    rigs = {entry["path"]: entry for entry in listings[("enemy-spine", "rigs")]}
    pairs, _found, _skipped = plan_enemy_rig_paths(list(rigs), ids["enemies"])
    wants.extend(unique_rig_wants("enemy-spine", "rigs", rigs, pairs, published["rig_dirs"]))
    return sorted(wants, key=lambda entry: entry["published"])


def check_limits(wants, max_files, max_bytes):
    """
    Stop a run that wants more than a refresh should ever publish at once, which is what a mirror renaming a folder would look like.

    Args:
        wants: The planned wants.
        max_files: The most files allowed.
        max_bytes: The most bytes allowed.

    Raises:
        ValueError: When either limit is exceeded.
    """
    total = sum(entry["size"] for entry in wants)
    if len(wants) > max_files:
        raise ValueError(f"the plan wants {len(wants)} files, over the limit of {max_files}. Raise max_files on a manual run if this is real.")
    if total > max_bytes:
        raise ValueError(f"the plan wants {total / 1e6:.1f} MB, over the limit of {max_bytes / 1e6:.1f} MB")
