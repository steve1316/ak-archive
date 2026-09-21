"""Tests for the per-kind variant record. The site resolves every form to a file through it, and a raw host is case-sensitive."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from build_manifest import build_manifest


def touch(root, kind, name):
	"""
	Create an empty encoded file.

	Args:
		root: The staging root.
		kind: `portraits` or `illustrations`.
		name: The file name, such as `char_x_2.webp`.
	"""
	folder = os.path.join(root, "assets", kind)
	os.makedirs(folder, exist_ok=True)
	open(os.path.join(folder, name), "wb").close()


def test_variants_keep_each_kinds_own_spelling(tmp_path):
	for kind in ("portraits", "illustrations"):
		touch(tmp_path, kind, "char_x.webp")
		touch(tmp_path, kind, "char_x_2.webp")
	touch(tmp_path, "portraits", "char_x_ambiencesynesthesia_4.webp")
	touch(tmp_path, "illustrations", "char_x_ambienceSynesthesia_4.webp")

	variants = build_manifest(str(tmp_path), {"char_x"})["variants"]

	assert variants["portraits"]["char_x"] == ["2", "ambiencesynesthesia_4"]
	assert variants["illustrations"]["char_x"] == ["2", "ambienceSynesthesia_4"]


def test_variants_record_an_illustration_only_form(tmp_path):
	touch(tmp_path, "portraits", "char_x.webp")
	touch(tmp_path, "illustrations", "char_x.webp")
	touch(tmp_path, "illustrations", "char_x_summer_4.webp")

	variants = build_manifest(str(tmp_path), {"char_x"})["variants"]

	assert "char_x" not in variants["portraits"]
	assert variants["illustrations"]["char_x"] == ["summer_4"]


def test_existing_sections_are_unchanged(tmp_path):
	touch(tmp_path, "portraits", "char_x.webp")
	touch(tmp_path, "illustrations", "char_x.webp")

	manifest = build_manifest(str(tmp_path), {"char_x"})

	assert manifest["portraits"] == {"char_x": True}
	assert manifest["illustrations"] == {"char_x": True}
