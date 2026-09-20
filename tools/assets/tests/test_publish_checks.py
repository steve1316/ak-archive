"""Tests for the publish guards. These are what stand between a mistake and a public repo."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from publish_checks import MAX_FILE_BYTES, REFUSE_TOTAL_BYTES, check_sizes, compare_manifests, plan_batches


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
