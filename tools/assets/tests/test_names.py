"""Tests for the upstream-to-published filename rules."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from names import canonical_key, is_base_variant, is_test_variant, normalise_key, output_name, parse_asset

IDS = {"char_002_amiya", "char_1001_amiya2", "char_1037_amiya3", "char_010_chen"}


def test_parse_asset_splits_id_from_variant():
    assert parse_asset("char_002_amiya_1", IDS) == ("char_002_amiya", "1")
    assert parse_asset("char_002_amiya_epoque_4", IDS) == ("char_002_amiya", "epoque_4")


def test_parse_asset_prefers_the_longest_matching_id():
    # `char_1001_amiya2` must not be read as `char_002_amiya` plus junk, and must win over any shorter prefix.
    assert parse_asset("char_1001_amiya2_2", IDS) == ("char_1001_amiya2", "2")


def test_parse_asset_returns_none_for_a_non_operator():
    assert parse_asset("token_10020_transmitter_1", IDS) is None


def test_test_variants_are_recognised():
    assert is_test_variant("test_1") is True
    assert is_test_variant("TEST_1") is True
    assert is_test_variant("epoque_4") is False


def test_base_variants_are_plain_numbers_optionally_plus():
    assert is_base_variant("1") is True
    assert is_base_variant("2") is True
    assert is_base_variant("1+") is True
    assert is_base_variant("2b") is False
    assert is_base_variant("epoque_4") is False


def test_plus_normalises_for_url_safety():
    assert normalise_key("1+") == "1plus"
    assert normalise_key("epoque_4") == "epoque_4"


def test_canonical_prefers_one():
    assert canonical_key(["1", "1+", "2", "epoque_4"]) == "1"


def test_canonical_falls_back_to_the_lowest_number_when_there_is_no_one():
    # char_1001_amiya2 exists only at elite 2, so it ships no `_1`. Without this fallback it would publish no
    # canonical art at all and render a placeholder forever despite having art.
    assert canonical_key(["2", "2b", "casc_1", "sale_16"]) == "2"


def test_canonical_ignores_plus_variants():
    # `1+` is the same costume re-lit, not the base, so it must never become the canonical file.
    assert canonical_key(["1+", "2"]) == "2"


def test_canonical_is_none_when_there_is_no_numeric_variant():
    assert canonical_key(["epoque_4", "winter_1"]) is None


def test_output_name_drops_the_key_for_the_canonical_variant():
    assert output_name("char_002_amiya", "1", "1") == "char_002_amiya.webp"


def test_output_name_keeps_the_key_for_every_other_variant():
    assert output_name("char_002_amiya", "2", "1") == "char_002_amiya_2.webp"
    assert output_name("char_002_amiya", "1+", "1") == "char_002_amiya_1plus.webp"
    assert output_name("char_002_amiya", "epoque_4", "1") == "char_002_amiya_epoque_4.webp"


def test_output_name_for_an_operator_whose_canonical_is_two():
    assert output_name("char_1001_amiya2", "2", "2") == "char_1001_amiya2.webp"
    assert output_name("char_1001_amiya2", "casc_1", "2") == "char_1001_amiya2_casc_1.webp"
