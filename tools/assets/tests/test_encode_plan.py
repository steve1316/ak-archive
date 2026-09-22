"""Tests for how `encode.py` plans portrait jobs across its main source and the fallback."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from encode import plan_variant_kind

IDS = {"char_002_amiya", "char_1047_halo2"}


def touch(path):
    """
    Create an empty file, making its parent directories.

    Args:
        path: The file to create.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "wb").close()


def test_fallback_fills_only_operators_the_main_source_lacks(tmp_path):
    touch(tmp_path / "upstream" / "charpor" / "char_002_amiya_1.png")
    touch(tmp_path / "fallback" / "char_002_amiya_1.png")
    touch(tmp_path / "fallback" / "char_1047_halo2_1.png")
    touch(tmp_path / "fallback" / "char_1047_halo2_2.png")

    jobs, _skipped = plan_variant_kind(str(tmp_path), "charpor", "portraits", IDS, "fallback")
    sources = sorted(os.path.relpath(job[0], tmp_path) for job in jobs)

    assert sources == [
        os.path.join("fallback", "char_1047_halo2_1.png"),
        os.path.join("fallback", "char_1047_halo2_2.png"),
        os.path.join("upstream", "charpor", "char_002_amiya_1.png"),
    ]


def test_fallback_publishes_under_the_same_names(tmp_path):
    touch(tmp_path / "upstream" / "charpor" / "char_002_amiya_1.png")
    touch(tmp_path / "fallback" / "char_1047_halo2_1.png")
    touch(tmp_path / "fallback" / "char_1047_halo2_2.png")

    jobs, _skipped = plan_variant_kind(str(tmp_path), "charpor", "portraits", IDS, "fallback")
    outputs = sorted(os.path.basename(job[1]) for job in jobs)

    assert outputs == ["char_002_amiya.webp", "char_1047_halo2.webp", "char_1047_halo2_2.webp"]


def test_no_fallback_keeps_the_old_behaviour(tmp_path):
    touch(tmp_path / "upstream" / "charpor" / "char_002_amiya_1.png")
    touch(tmp_path / "fallback" / "char_1047_halo2_1.png")

    jobs, _skipped = plan_variant_kind(str(tmp_path), "charpor", "portraits", IDS)

    assert [os.path.basename(job[1]) for job in jobs] == ["char_002_amiya.webp"]
