"""Tests for naming operator rig files from a listing of upstream paths."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stage_spine import plan_rig_paths

IDS = {"char_002_amiya", "char_1012_skadi2"}


def test_rig_paths_publish_dorm_battle_and_back():
    paths = [
        "char_002_amiya/build_char_002_amiya/Spine/build_char_002_amiya.skel",
        "char_002_amiya/char_002_amiya/Front/char_002_amiya.skel",
        "char_002_amiya/char_002_amiya/Back/char_002_amiya.atlas",
        "char_002_amiya/char_002_amiya/Front/readme.txt",
    ]

    pairs, skipped = plan_rig_paths(paths, IDS)

    assert sorted(published for _upstream, published in pairs) == [
        "spine/char_002_amiya/base/back/char_002_amiya.atlas",
        "spine/char_002_amiya/base/battle/char_002_amiya.skel",
        "spine/char_002_amiya/base/dorm/build_char_002_amiya.skel",
    ]
    assert skipped["other_file"] == 1


def test_a_plain_spine_folder_beside_a_build_dorm_is_the_battle_rig():
    paths = ["char_1012_skadi2/build_char_1012_skadi2/Spine/a.skel", "char_1012_skadi2/char_1012_skadi2/Spine/b.skel"]

    pairs, _skipped = plan_rig_paths(paths, IDS)

    assert sorted(published for _upstream, published in pairs) == ["spine/char_1012_skadi2/base/battle/b.skel", "spine/char_1012_skadi2/base/dorm/a.skel"]
