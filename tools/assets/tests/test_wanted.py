"""Tests for working out which upstream files a refresh run must fetch."""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from wanted import check_limits, plan_wanted, published_state

IDS = {"operators": {"char_a", "char_new"}, "skills": set(), "module_art": set(), "module_types": set(), "enemies": set()}


def entry(path, size=10, sha=None):
    """
    Build one listing entry.

    Args:
        path: The path relative to the listed folder.
        size: The blob size.
        sha: The blob sha, defaulting to one derived from the path.

    Returns:
        A listing entry dict.
    """
    return {"path": path, "size": size, "sha": sha or f"sha-{path}"}


def empty_listings():
    """
    Build listings with every folder present and empty.

    Returns:
        A dict of `(source, role)` to an empty list.
    """
    roles = [("art", "charpor"), ("art", "charpack"), ("art", "spine"), ("enemies", "enemy"), ("icons", "skills"), ("icons", "charportraits"), ("icons", "modules"), ("icons", "badges"), ("enemy-spine", "rigs")]
    return {role: [] for role in roles}


def test_a_new_outfit_publishes_with_a_suffix_and_the_base_is_not_refetched():
    listings = empty_listings()
    listings[("art", "charpack")] = [entry("char_a_1.png"), entry("char_a_summer_9.png")]
    published = published_state({"illustrations": {"char_a": True}, "portraits": {}, "variants": {"portraits": {}, "illustrations": {}}}, {}, {})

    wants = plan_wanted(listings, IDS, published)

    assert [want["published"] for want in wants] == ["illustrations/char_a_summer_9.webp"]


def test_art_for_an_operator_not_yet_in_the_data_is_skipped():
    listings = empty_listings()
    listings[("art", "charpor")] = [entry("char_future_1.png")]

    assert plan_wanted(listings, IDS, published_state({}, {}, {})) == []


def test_a_new_rig_form_is_wanted_as_a_whole_folder():
    listings = empty_listings()
    folder = "char_a/char_a_summer_9/Front"
    listings[("art", "spine")] = [entry(f"{folder}/char_a_summer_9.skel"), entry(f"{folder}/char_a_summer_9.atlas"), entry(f"{folder}/char_a_summer_9.png")]
    published = published_state({}, {"char_a": {"base": {"battle": {}}}}, {})

    wants = plan_wanted(listings, IDS, published)

    assert sorted(want["published"] for want in wants) == [f"spine/char_a/summer_9/battle/char_a_summer_9.{extension}" for extension in ("atlas", "png", "skel")]
    assert {want["action"] for want in wants} == {"copy"}


def test_two_different_upstream_copies_of_one_rig_file_fail():
    listings = empty_listings()
    listings[("art", "spine")] = [entry("char_a/char_a/Front/x.skel", sha="one"), entry("char_new/char_a/Front/x.skel", sha="two")]

    with pytest.raises(ValueError, match="two different upstream files"):
        plan_wanted(listings, IDS, published_state({}, {}, {}))


def test_limits_stop_an_oversized_run():
    wants = [{"size": 150_000_000}, {"size": 60_000_000}]

    with pytest.raises(ValueError, match="200.0 MB"):
        check_limits(wants, 300, 200_000_000)
    with pytest.raises(ValueError, match="2 files"):
        check_limits(wants, 1, 10**12)


def test_a_rig_folder_the_index_could_never_read_is_not_wanted():
    listings = empty_listings()
    listings[("art", "spine")] = [entry("char_a/build_char_a/Spine/build_char_a.atlas"), entry("char_a/build_char_a/Spine/build_char_a.png")]
    listings[("enemy-spine", "rigs")] = [entry("1571_mirbst/enemy_1571_mirbst.atlas"), entry("1571_mirbst/enemy_1571_mirbst.png")]
    ids = {**IDS, "enemies": {"enemy_1571_mirbst"}}

    assert plan_wanted(listings, ids, published_state({}, {}, {})) == []


def test_a_rig_folder_on_the_skip_list_is_never_wanted():
    listings = empty_listings()
    folder = "char_a/char_a_summer_9/Front"
    listings[("art", "spine")] = [entry(f"{folder}/char_a_summer_9.skel"), entry(f"{folder}/char_a_summer_9.atlas")]

    wants = plan_wanted(listings, IDS, published_state({}, {}, {}), skipped_rig_dirs={"spine/char_a/summer_9/battle"})

    assert wants == []
