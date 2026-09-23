"""Tests for the story asset planner and manifest."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from story_assets import build_manifest, manifest_paths, plan_story
from story_names import index_by_name, index_by_path


def entry(path, source="art", folder="assets/dyn/avg/backgrounds", size=10):
    return {"path": path, "sha": "s", "size": size, "repo_path": f"{folder}/{path}", "source": source}


INDEXES = {
    "backgrounds": index_by_name([entry("bg_a.png")]),
    "images": index_by_name([entry("avg_1.png", folder="assets/dyn/avg/images")]),
    "items": index_by_name([]),
    "characters": index_by_path([entry("char_1/char_1.png", folder="assets/dyn/avg/characters"), entry("char_1/char_2.png", folder="assets/dyn/avg/characters")]),
    "audio": index_by_path([entry("sound_beta_2/music/m_a.mp3", source="audio", folder="assets/dyn/audio")]),
    "mainmission": index_by_name([entry("main_0.png", folder="assets/dyn/arts/ui/mainmission")]),
    "hubs": index_by_name([]),
    "zonemaps": index_by_name([entry("zone_map_main_1/zone_map_0_up.png", folder="assets/dyn/ui/zonemaps")]),
}

REFS = {
    "backgrounds": ["bg_a", "BG_A", "bg_missing"],
    "images": ["avg_1"],
    "items": [],
    "sprites": ["char_1#2", "char_1#1"],
    "music": ["Sound_Beta_2/Music/m_a"],
    "sounds": ["$unresolved"],
}

STORY_INDEX = {"main": [{"id": "main_0", "cover": None}, {"id": "main_1", "cover": None}], "events": [{"id": "act1", "cover": "storyEntryPic_act1"}], "side": []}


def test_plan_resolves_every_kind_once_and_lists_what_it_cannot_find():
    wants, unavailable = plan_story(INDEXES, REFS, STORY_INDEX, set())
    assert sorted(want["published"] for want in wants) == [
        "audio/sound_beta_2/music/m_a.mp3",
        "backgrounds/bg_a.webp",
        "covers/main_0.webp",
        "images/avg_1.webp",
        "maps/main_0.webp",
        "sprites/char_1-1.webp",
        "sprites/char_1-2.webp",
    ]
    assert unavailable["backgrounds"] == ["bg_missing"]
    assert unavailable["audio"] == ["$unresolved"]
    assert unavailable["covers"] == ["act1", "main_1"]
    audio = next(want for want in wants if want["kind"] == "audio")
    assert audio == {"kind": "audio", "key": "sound_beta_2/music/m_a", "source": "audio", "repo_path": "assets/dyn/audio/sound_beta_2/music/m_a.mp3", "size": 10, "published": "audio/sound_beta_2/music/m_a.mp3", "action": "copy"}
    sprite = next(want for want in wants if want["published"] == "sprites/char_1-2.webp")
    assert sprite["action"] == "encode" and sprite["repo_path"] == "assets/dyn/avg/characters/char_1/char_2.png" and sprite["key"] == "char_1-2"


def test_plan_skips_published_paths():
    wants, _unavailable = plan_story(INDEXES, REFS, STORY_INDEX, {"backgrounds/bg_a.webp", "sprites/char_1-2.webp"})
    published = {want["published"] for want in wants}
    assert "backgrounds/bg_a.webp" not in published
    assert "sprites/char_1-2.webp" not in published
    assert "sprites/char_1-1.webp" in published


def test_manifest_paths_turn_manifest_keys_back_into_published_paths():
    manifest = {"backgrounds": ["bg_a"], "images": [], "items": [], "sprites": ["char_1-2"], "audio": ["sound_beta_2/music/m_a"], "covers": ["main_0"], "maps": [], "unavailable": {}}
    assert manifest_paths(manifest) == {"backgrounds/bg_a.webp", "sprites/char_1-2.webp", "audio/sound_beta_2/music/m_a.mp3", "covers/main_0.webp"}


def test_manifest_claims_only_built_outputs():
    existing = {"backgrounds": ["bg_old"], "images": [], "items": [], "sprites": [], "audio": [], "covers": [], "maps": [], "unavailable": {"backgrounds": ["bg_gone"]}}
    wants = [
        {"kind": "backgrounds", "key": "bg_new", "published": "backgrounds/bg_new.webp"},
        {"kind": "sprites", "key": "char_1-2", "published": "sprites/char_1-2.webp"},
    ]
    unavailable = {"backgrounds": ["bg_missing"], "audio": ["$x"]}
    manifest = build_manifest(existing, wants, unavailable, {"backgrounds/bg_new.webp"})
    assert manifest["backgrounds"] == ["bg_new", "bg_old"]
    assert manifest["sprites"] == []
    assert manifest["unavailable"] == {"backgrounds": ["bg_missing"], "audio": ["$x"]}
    assert set(manifest) == {"backgrounds", "images", "items", "sprites", "audio", "covers", "maps", "unavailable"}


def test_plan_does_not_list_a_published_asset_as_unavailable():
    _wants, unavailable = plan_story(INDEXES, REFS, STORY_INDEX, {"covers/act1.webp", "backgrounds/bg_missing.webp"})
    assert "act1" not in unavailable["covers"]
    assert "bg_missing" not in unavailable["backgrounds"]


def test_manifest_claims_hand_added_overrides_and_drops_them_from_unavailable():
    existing = {"covers": ["main_0"], "unavailable": {}}
    unavailable = {"covers": ["act36side", "act99"]}
    manifest = build_manifest(existing, [], unavailable, set(), {"covers": ["act36side"]})
    assert manifest["covers"] == ["act36side", "main_0"]
    assert manifest["unavailable"] == {"covers": ["act99"]}
