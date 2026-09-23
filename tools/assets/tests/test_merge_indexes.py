"""Tests for merging a refresh run's partial manifest and rig indexes into the committed ones."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from merge_indexes import merge_enemy_spine_index, merge_manifest, merge_spine_index

COMMITTED = {
    "portraits": {"char_a": True, "char_b": False},
    "illustrations": {"char_a": True},
    "skins": {"char_a": ["summer_1"]},
    "variants": {"portraits": {"char_a": ["2"]}, "illustrations": {"char_a": ["2", "summer_1"]}},
    "skillIcons": ["skcom_a"],
    "enemies": {"enemy_1": True},
    "moduleArt": ["uniequip_002_a"],
    "moduleTypes": ["swo-x"],
}


def test_a_partial_false_never_overwrites_a_committed_true():
    partial = {"portraits": {"char_a": False, "char_b": True, "char_new": False}, "illustrations": {"char_a": False, "char_new": True}}

    merged = merge_manifest(COMMITTED, partial)

    assert merged["portraits"] == {"char_a": True, "char_b": True, "char_new": False}
    assert merged["illustrations"] == {"char_a": True, "char_new": True}


def test_lists_and_variant_maps_are_unioned_and_sorted():
    partial = {"skins": {"char_a": ["winter_2"]}, "variants": {"portraits": {}, "illustrations": {"char_a": ["winter_2"]}}, "skillIcons": ["skcom_0"], "moduleTypes": ["def-y"]}

    merged = merge_manifest(COMMITTED, partial)

    assert merged["skins"]["char_a"] == ["summer_1", "winter_2"]
    assert merged["variants"]["illustrations"]["char_a"] == ["2", "summer_1", "winter_2"]
    assert merged["skillIcons"] == ["skcom_0", "skcom_a"]
    assert merged["moduleTypes"] == ["def-y", "swo-x"]


def test_merging_an_empty_partial_changes_nothing_and_keeps_section_order():
    merged = merge_manifest(COMMITTED, {})

    assert merged == COMMITTED
    assert list(merged) == list(COMMITTED)


def test_spine_index_merges_new_forms_and_kinds_without_dropping_old_ones():
    committed = {"char_a": {"base": {"battle": {"skel": "a", "atlas": "a", "anims": ["Idle"], "stage": 3}}}}
    partial = {"char_a": {"summer_1": {"battle": {"skel": "b", "atlas": "b", "anims": [], "stage": 3}}}, "char_new": {"base": {"dorm": {"skel": "c", "atlas": "c", "anims": [], "stage": 2}}}}

    merged = merge_spine_index(committed, partial)

    assert set(merged["char_a"]) == {"base", "summer_1"}
    assert merged["char_a"]["base"]["battle"]["anims"] == ["Idle"]
    assert "char_new" in merged


def test_enemy_spine_index_adds_new_enemies():
    merged = merge_enemy_spine_index({"enemy_1": {"skel": "a"}}, {"enemy_2": {"skel": "b"}})

    assert merged == {"enemy_1": {"skel": "a"}, "enemy_2": {"skel": "b"}}
