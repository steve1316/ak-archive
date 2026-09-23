"""Tests for the refresh run's fetch URLs and build jobs."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from refresh_assets import build_jobs, raw_url


def test_raw_urls_escape_each_path_segment():
    url = raw_url("ArknightsAssets/ArknightsAssets2", "abc", "assets/dyn/arts/skills/skill_icon_skcom_powerstrike[3].png")

    assert url == "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/abc/assets/dyn/arts/skills/skill_icon_skcom_powerstrike%5B3%5D.png"


def test_build_jobs_encode_art_and_copy_rigs(tmp_path):
    wants = [
        {"source": "art", "repo_path": "charpack/char_a_1.png", "published": "illustrations/char_a.webp", "action": "encode", "size": 1, "sha": "s"},
        {"source": "art", "repo_path": "spine/char_a/char_a/Front/a.skel", "published": "spine/char_a/base/battle/a.skel", "action": "copy", "size": 1, "sha": "t"},
    ]

    encode_jobs, copy_jobs = build_jobs(wants, str(tmp_path))

    assert encode_jobs == [(str(tmp_path / "upstream-refresh" / "art" / "charpack" / "char_a_1.png"), str(tmp_path / "assets" / "illustrations" / "char_a.webp"), "charpack/char_a_1.png -> illustrations/char_a.webp", "illustrations")]
    assert copy_jobs == [(str(tmp_path / "upstream-refresh" / "art" / "spine" / "char_a" / "char_a" / "Front" / "a.skel"), str(tmp_path / "assets" / "spine" / "char_a" / "base" / "battle" / "a.skel"))]
