"""Tests for the story asset naming rules."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from story_names import cover_entry, index_by_name, index_by_path, manifest_key, map_entry, published_path, resolve, sprite_candidates, sprite_key


def entry(path):
    return {"path": path, "sha": "s", "size": 1}


def test_sprite_key_matches_the_site_rule():
    assert sprite_key("char_002_amiya_1#7") == "char_002_amiya_1-7"
    assert sprite_key("avg_npc_484_1#5$1") == "avg_npc_484_1-5-1"
    assert sprite_key("Avg_NPC_061") == "avg_npc_061"


def test_sprite_candidates_cover_the_three_layouts():
    characters = index_by_path(
        [
            entry("avg_npc_484_1/avg_npc_484_1#5$1.png"),
            entry("char_002_amiya_1/char_002_amiya_1.png"),
            entry("char_002_amiya_1/char_002_amiya_7.png"),
            entry("avg_npc_061/avg_npc_061.png"),
            entry("avg_npc_061/avg_npc_061_3.png"),
            entry("char_130_doberm_ex/char_130_doberm_ex.png"),
            entry("avg_npc_070.png"),
        ]
    )
    indexes = {"characters": characters}
    assert resolve("sprites", "avg_npc_484_1#5$1", indexes)["path"] == "avg_npc_484_1/avg_npc_484_1#5$1.png"
    assert resolve("sprites", "char_002_amiya_1#7", indexes)["path"] == "char_002_amiya_1/char_002_amiya_7.png"
    assert resolve("sprites", "char_002_amiya_1#1", indexes)["path"] == "char_002_amiya_1/char_002_amiya_1.png"
    assert resolve("sprites", "avg_npc_061#3", indexes)["path"] == "avg_npc_061/avg_npc_061_3.png"
    assert resolve("sprites", "avg_npc_061#1", indexes)["path"] == "avg_npc_061/avg_npc_061.png"
    assert resolve("sprites", "char_130_doberm_ex", indexes)["path"] == "char_130_doberm_ex/char_130_doberm_ex.png"
    assert resolve("sprites", "avg_npc_070", indexes)["path"] == "avg_npc_070.png"
    assert resolve("sprites", "avg_npc_061#9", indexes) is None


def test_sprite_candidates_are_unique_and_try_the_exact_name_first():
    candidates = sprite_candidates("char_002_amiya_1#1")
    assert candidates[0] == "char_002_amiya_1/char_002_amiya_1#1.png"
    assert len(candidates) == len(set(candidates))


def test_images_and_audio_resolve_ignoring_case():
    indexes = {
        "backgrounds": index_by_name([entry("bg_cher_1.png")]),
        "images": index_by_name([entry("avg_2_2.png")]),
        "items": index_by_name([]),
        "audio": index_by_path([entry("sound_beta_2/music/beta2_180603/m_dia_escape_intro.mp3")]),
    }
    assert resolve("backgrounds", "Bg_Cher_1", indexes)["path"] == "bg_cher_1.png"
    assert resolve("images", "avg_2_2", indexes)["path"] == "avg_2_2.png"
    assert resolve("items", "item_x", indexes) is None
    assert resolve("music", "Sound_Beta_2/Music/beta2_180603/m_dia_escape_intro", indexes)["path"] == "sound_beta_2/music/beta2_180603/m_dia_escape_intro.mp3"
    assert resolve("sounds", "$p_atk_smg_n", indexes) is None


def test_published_paths_and_manifest_keys():
    assert published_path("backgrounds", "Bg_Cher_1") == "backgrounds/bg_cher_1.webp"
    assert published_path("sprites", "avg_npc_484_1#5$1") == "sprites/avg_npc_484_1-5-1.webp"
    assert published_path("music", "Sound_Beta_2/Music/m_a") == "audio/sound_beta_2/music/m_a.mp3"
    assert published_path("covers", "main_0") == "covers/main_0.webp"
    assert manifest_key("sprites", "char_002_amiya_1#7") == "char_002_amiya_1-7"
    assert manifest_key("sounds", "Sound_Beta_2/AVG/d_a") == "sound_beta_2/avg/d_a"


def test_covers_and_maps():
    indexes = {
        "mainmission": index_by_name([entry("main_0.png")]),
        "hubs": index_by_name([entry("activity/storyentrypic_act1d0.png")]),
        "zonemaps": index_by_name([entry("zone_map_main_1/zone_map_0_up.png"), entry("zone_map_main_14/zone_map_14_1.png"), entry("zone_map_main_11/main_11_up.png")]),
    }
    assert cover_entry("main", {"id": "main_0", "cover": None}, indexes)["path"] == "main_0.png"
    assert cover_entry("events", {"id": "1stact", "cover": "storyEntryPic_act1d0"}, indexes)["path"] == "activity/storyentrypic_act1d0.png"
    assert cover_entry("side", {"id": "x", "cover": None}, indexes) is None
    assert map_entry("main_0", indexes)["path"] == "zone_map_main_1/zone_map_0_up.png"
    assert map_entry("main_11", indexes)["path"] == "zone_map_main_11/main_11_up.png"
    assert map_entry("main_14", indexes)["path"] == "zone_map_main_14/zone_map_14_1.png"
    assert map_entry("main_3", indexes) is None
