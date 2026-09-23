"""Tests for how `encode.py` plans portrait jobs across its main source and the fallback."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from encode import plan_modules, plan_variant_kind

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


def test_modules_encode_only_referenced_art_matched_exactly(tmp_path):
    source = tmp_path / "icons-upstream" / "assets" / "dyn" / "arts" / "ui" / "uniequipimgsmall"
    touch(source / "uniequip_002_chen.png")
    touch(source / "uniequip_002_chen2.png")
    touch(source / "uniequip_002_other.png")

    jobs, missing = plan_modules(str(tmp_path), {"uniequip_002_chen", "uniequip_003_gone"}, set())

    assert [os.path.basename(job[1]) for job in jobs] == ["uniequip_002_chen.webp"]
    assert missing == ["uniequip_003_gone"]


def test_module_badges_match_case_insensitively_and_publish_lowercase(tmp_path):
    source = tmp_path / "icons-upstream" / "assets" / "dyn" / "arts" / "ui" / "uniequipdirection"
    touch(source / "WAH-Y.png")
    touch(source / "swo-x.png")

    jobs, missing = plan_modules(str(tmp_path), set(), {"wah-y", "swo-x"})

    assert sorted(os.path.relpath(job[1], tmp_path) for job in jobs) == [
        os.path.join("assets", "module-types", "swo-x.webp"),
        os.path.join("assets", "module-types", "wah-y.webp"),
    ]
    assert {job[3] for job in jobs} == {"module-types"}
    assert missing == []
