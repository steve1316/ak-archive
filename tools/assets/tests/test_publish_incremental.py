"""Tests for the incremental publish path a scheduled refresh uses."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from publish import SSH_URL, claims_against, sparse_patterns


def test_sparse_patterns_anchor_every_path_and_include_the_manifest():
    assert sparse_patterns(["modules/uniequip_002_chen.webp", "spine/char_a/base/battle/a.skel"]) == [
        "/assets-manifest.json",
        "/modules/uniequip_002_chen.webp",
        "/spine/char_a/base/battle/a.skel",
    ]


def test_claims_cover_what_the_repo_has_plus_what_this_run_adds():
    files = claims_against({"portraits/char_a.webp"}, [("portraits/char_b.webp", 10)])

    assert sorted(path for path, _size in files) == ["portraits/char_a.webp", "portraits/char_b.webp"]


def test_the_ssh_remote_names_the_assets_repo():
    assert SSH_URL == "git@github.com:steve1316/ak-archive-assets.git"
