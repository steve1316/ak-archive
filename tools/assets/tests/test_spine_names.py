"""Tests for the Spine rig naming rules. These decide roughly 3000 published paths."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from spine_names import parse_rig, published_dir

IDS = {"char_002_amiya", "char_1001_amiya2", "char_172_svrash"}


def test_parse_rig_reads_a_base_dorm_rig():
    assert parse_rig("char_002_amiya/build_char_002_amiya/Spine", IDS) == ("char_002_amiya", "base", "dorm")


def test_parse_rig_reads_a_base_battle_rig():
    assert parse_rig("char_002_amiya/char_002_amiya/Front", IDS) == ("char_002_amiya", "base", "battle")


def test_parse_rig_reads_a_base_back_rig():
    assert parse_rig("char_002_amiya/char_002_amiya/Back", IDS) == ("char_002_amiya", "base", "back")


def test_parse_rig_reads_a_skin_dorm_rig():
    assert parse_rig("char_002_amiya/build_char_002_amiya_winter_1/Spine", IDS) == ("char_002_amiya", "winter_1", "dorm")


def test_parse_rig_reads_a_skin_battle_rig():
    assert parse_rig("char_002_amiya/char_002_amiya_winter_1/Front", IDS) == ("char_002_amiya", "winter_1", "battle")


def test_parse_rig_prefers_the_longest_matching_id():
    # char_1001_amiya2 must not be read as char_002_amiya with leftover text.
    assert parse_rig("char_1001_amiya2/build_char_1001_amiya2/Spine", IDS) == ("char_1001_amiya2", "base", "dorm")


def test_parse_rig_skips_a_test_rig():
    assert parse_rig("char_002_amiya/build_char_002_amiya_test_1/Spine", IDS) is None


def test_parse_rig_skips_an_unknown_operator():
    assert parse_rig("char_999_nobody/build_char_999_nobody/Spine", IDS) is None


def test_parse_rig_gives_front_and_back_different_published_paths():
    # Front and Back are two distinct rigs with the same filenames, so they must never publish to the same path.
    front = parse_rig("char_002_amiya/char_002_amiya/Front", IDS)
    back = parse_rig("char_002_amiya/char_002_amiya/Back", IDS)
    assert published_dir(*front) != published_dir(*back)


def test_published_dir_keeps_the_key_verbatim():
    assert published_dir("char_002_amiya", "1plus", "battle") == "spine/char_002_amiya/1plus/battle"


def test_published_dir_lowercases_the_kind_only():
    # Variant keys keep upstream's spelling, since the manifest records them verbatim.
    assert published_dir("char_002_amiya", "ambienceSynesthesia_4", "dorm") == "spine/char_002_amiya/ambienceSynesthesia_4/dorm"
