"""Tests for the enemy rig index: one flat rig per enemy, read from the staged tree."""

import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from build_spine_index import build_enemy_index

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build_spine_index.py")
COMMITTED_ENEMY_INDEX = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "src", "data", "enemy-spine-index.json")


def touch(root, enemy_id, name):
    """
    Create an empty staged rig file.

    Args:
        root: The staging root.
        enemy_id: The enemy id folder.
        name: The file name.
    """
    folder = os.path.join(root, "assets", "spine-enemies", enemy_id)
    os.makedirs(folder, exist_ok=True)
    open(os.path.join(folder, name), "wb").close()


def test_indexes_known_enemies_by_basename(tmp_path):
    for name in ("enemy_1526_sfsui.skel", "enemy_1526_sfsui.atlas", "enemy_1526_sfsui.png"):
        touch(tmp_path, "enemy_15068_dqsui", name)
    touch(tmp_path, "enemy_9999_nope", "enemy_9999_nope.skel")
    touch(tmp_path, "enemy_9999_nope", "enemy_9999_nope.atlas")

    index = build_enemy_index(str(tmp_path), {"enemy_15068_dqsui"})

    assert index == {"enemy_15068_dqsui": {"skel": "enemy_1526_sfsui", "atlas": "enemy_1526_sfsui", "anims": []}}


def test_skips_a_rig_without_an_atlas(tmp_path):
    touch(tmp_path, "enemy_1007_slime", "enemy_1007_slime.skel")

    assert build_enemy_index(str(tmp_path), {"enemy_1007_slime"}) == {}


def test_index_writes_the_enemy_index_where_asked_and_leaves_the_committed_one_alone(tmp_path):
    touch(tmp_path, "enemy_1007_slime", "enemy_1007_slime.skel")
    touch(tmp_path, "enemy_1007_slime", "enemy_1007_slime.atlas")
    out = tmp_path / "partial" / "enemy-spine.json"
    before = os.path.getmtime(COMMITTED_ENEMY_INDEX)

    subprocess.run(["python3", SCRIPT, "--staging", str(tmp_path), "--enemies", "--index", str(out)], check=True, capture_output=True)

    assert json.loads(out.read_text()) == {"enemy_1007_slime": {"skel": "enemy_1007_slime", "atlas": "enemy_1007_slime", "anims": []}}
    assert os.path.getmtime(COMMITTED_ENEMY_INDEX) == before
