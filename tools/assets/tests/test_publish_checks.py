"""Tests for the publish guards. These are what stand between a mistake and a public repo."""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from publish_checks import MAX_FILE_BYTES, REFUSE_TOTAL_BYTES, batch_message, check_sizes, compare_manifests, plan_batches, plan_removals, redundant_crop_base


def test_check_sizes_passes_a_normal_tree():
    assert check_sizes([("a.webp", 1000), ("b.webp", 2000)]) == []


def test_check_sizes_refuses_a_file_over_the_per_file_ceiling():
    problems = check_sizes([("huge.webp", MAX_FILE_BYTES + 1)])
    assert len(problems) == 1
    assert "huge.webp" in problems[0]


def test_check_sizes_refuses_a_tree_over_the_repo_ceiling():
    problems = check_sizes([("a.webp", REFUSE_TOTAL_BYTES + 1)])
    assert any("total" in p for p in problems)


def test_plan_batches_keeps_each_batch_under_the_cap():
    files = [(f"{i}.webp", 60) for i in range(10)]
    batches = plan_batches(files, cap=100)
    assert all(sum(size for _, size in batch) <= 100 or len(batch) == 1 for batch in batches)
    assert sum(len(b) for b in batches) == 10


def test_plan_batches_never_drops_a_file_larger_than_the_cap():
    # A single file over the cap still has to go out, alone.
    batches = plan_batches([("big.webp", 500)], cap=100)
    assert batches == [[("big.webp", 500)]]


def test_compare_manifests_is_quiet_when_they_match():
    same = {"portraits": {"char_002_amiya": True}}
    assert compare_manifests(same, same) == []


def test_compare_manifests_reports_a_drift():
    problems = compare_manifests({"portraits": {"a": True}}, {"portraits": {"a": True, "b": True}})
    assert len(problems) == 1


def test_batch_message_names_the_batch_only_when_there_is_more_than_one():
    assert batch_message(638, 0, 1, 4) == "Add 638 files (batch 1 of 4)"
    assert batch_message(638, 0, 1, 1) == "Add 638 files"


def test_batch_message_says_update_when_nothing_is_new():
    # The case that produced "Add asset batch 1 of 1 (1 files)": a one-file manifest republish adds nothing.
    assert batch_message(0, 1, 1, 1) == "Update 1 file"


def test_batch_message_agrees_with_its_count():
    assert batch_message(1, 0, 1, 1) == "Add 1 file"
    assert batch_message(0, 3, 1, 1) == "Update 3 files"


def test_batch_message_covers_a_mixed_batch():
    assert batch_message(5, 2, 1, 1) == "Add 5 files and update 2 files"


def test_batch_message_refuses_an_empty_batch():
    with pytest.raises(ValueError):
        batch_message(0, 0, 1, 1)


def test_plan_removals_selects_only_matching_paths():
    files = [("illustrations/a.webp", 10), ("illustrations/ab.webp", 20), ("portraits/cb.webp", 30)]
    removals = plan_removals(files, lambda path: path.rsplit("/", 1)[-1].removesuffix(".webp").endswith("b"))
    assert removals == [("illustrations/ab.webp", 20), ("portraits/cb.webp", 30)]


def test_plan_removals_is_empty_when_nothing_matches():
    files = [("illustrations/a.webp", 10)]
    assert plan_removals(files, lambda path: False) == []


def test_redundant_crop_base_finds_the_direct_base():
    present = {"char_002_amiya_2.webp", "char_002_amiya_2b.webp"}
    assert redundant_crop_base("char_002_amiya_2b.webp", "b", present) == "char_002_amiya_2.webp"


def test_redundant_crop_base_falls_back_to_the_omitted_number_base():
    # The base skin's file drops its own number, so char_002_amiya_1b.webp has to be checked against the plain file instead.
    present = {"char_002_amiya.webp", "char_002_amiya_1b.webp"}
    assert redundant_crop_base("char_002_amiya_1b.webp", "b", present) == "char_002_amiya.webp"


def test_redundant_crop_base_is_none_for_an_id_that_only_looks_like_a_crop():
    # Bobbing's own id is "bobb" - it ends in "b" on its own, and "char_487_bob.webp" never existed.
    present = {"char_487_bobb.webp"}
    assert redundant_crop_base("char_487_bobb.webp", "b", present) is None


def test_redundant_crop_base_is_none_when_no_base_matches():
    present = {"char_002_amiya_epoque_4b.webp"}
    assert redundant_crop_base("char_002_amiya_epoque_4b.webp", "b", present) is None


def test_redundant_crop_base_handles_a_bare_suffix_without_crashing():
    assert redundant_crop_base("b.webp", "b", {"b.webp"}) is None
