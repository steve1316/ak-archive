"""Tests for the story publisher's file walk."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from story_publish import staged_files


def test_staged_files_lists_every_asset_with_forward_slashes_and_sizes(tmp_path):
    (tmp_path / "sprites").mkdir()
    (tmp_path / "audio" / "sound_beta_2").mkdir(parents=True)
    (tmp_path / "sprites" / "char_1-2.webp").write_bytes(b"abc")
    (tmp_path / "audio" / "sound_beta_2" / "m.mp3").write_bytes(b"de")
    assert staged_files(str(tmp_path)) == [("audio/sound_beta_2/m.mp3", 2), ("sprites/char_1-2.webp", 3)]


def test_staged_files_is_empty_when_nothing_was_built(tmp_path):
    assert staged_files(str(tmp_path / "missing")) == []
