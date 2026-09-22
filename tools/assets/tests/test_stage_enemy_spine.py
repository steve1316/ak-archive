"""Tests for staging enemy rigs: which upstream files are copied, and where they land."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stage_enemy_spine import plan_enemy_copies


def touch(root, slug, name):
    """
    Create an empty upstream rig file.

    Args:
        root: The staging root.
        slug: The upstream folder, such as `1007_slime`.
        name: The file name.
    """
    folder = os.path.join(root, "enemy-spine-upstream", "models_enemies", slug)
    os.makedirs(folder, exist_ok=True)
    open(os.path.join(folder, name), "wb").close()


def destinations(jobs, root):
    """
    The planned destinations, relative to the publish tree.

    Args:
        jobs: `(source, destination)` pairs.
        root: The staging root.

    Returns:
        The destinations as sorted forward-slash paths under `assets/`.
    """
    base = os.path.join(root, "assets")
    return sorted(os.path.relpath(destination, base).replace(os.sep, "/") for _source, destination in jobs)


def test_copies_skel_atlas_and_every_page(tmp_path):
    for name in ("enemy_1526_sfsui.skel", "enemy_1526_sfsui.atlas", "enemy_1526_sfsui.png", "enemy_1526_sfsui2.png"):
        touch(tmp_path, "1526_sfsui", name)

    jobs, missing, _skipped = plan_enemy_copies(str(tmp_path), {"enemy_1526_sfsui"})

    assert destinations(jobs, tmp_path) == [
        "spine-enemies/enemy_1526_sfsui/enemy_1526_sfsui.atlas",
        "spine-enemies/enemy_1526_sfsui/enemy_1526_sfsui.png",
        "spine-enemies/enemy_1526_sfsui/enemy_1526_sfsui.skel",
        "spine-enemies/enemy_1526_sfsui/enemy_1526_sfsui2.png",
    ]
    assert missing == []


def test_skips_dollar_duplicates_and_other_files(tmp_path):
    for name in ("enemy_1286_dumcy.skel", "enemy_1286_dumcy.atlas", "enemy_1286_dumcy.png", "enemy_1286_dumcy$0.skel", "enemy_1286_dumcy$0.png", "notes.txt"):
        touch(tmp_path, "1286_dumcy", name)

    jobs, _missing, skipped = plan_enemy_copies(str(tmp_path), {"enemy_1286_dumcy"})

    assert len(jobs) == 3
    assert skipped["duplicate"] == 2
    assert skipped["other_file"] == 1


def test_only_known_enemies_and_missing_reported(tmp_path):
    touch(tmp_path, "1007_slime", "enemy_1007_slime.skel")
    touch(tmp_path, "9999_nope", "enemy_9999_nope.skel")

    jobs, missing, skipped = plan_enemy_copies(str(tmp_path), {"enemy_1007_slime", "enemy_1300_ymmir"})

    assert destinations(jobs, tmp_path) == ["spine-enemies/enemy_1007_slime/enemy_1007_slime.skel"]
    assert missing == ["enemy_1300_ymmir"]
    assert skipped["unknown_enemy"] == 1


def test_no_upstream_means_no_jobs(tmp_path):
    jobs, missing, _skipped = plan_enemy_copies(str(tmp_path), {"enemy_1007_slime"})

    assert jobs == []
    assert missing == ["enemy_1007_slime"]
