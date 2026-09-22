"""
Copy the fetched enemy chibi rigs into the publish tree.

Each upstream folder `models_enemies/<slug>/` is the rig for enemy `enemy_<slug>`, and it lands at `spine-enemies/enemy_<slug>/` with its
file names unchanged. Every `.skel`, `.atlas` and `.png` is copied, since a large rig spreads its atlas over numbered pages such as
`enemy_1526_sfsui2.png`. Files whose name carries a `$` are upstream duplicates and are skipped. Only enemies the importer wrote are staged,
and the ones with no upstream folder are listed so a gap is visible.

Rigs are copied, not re-encoded, for the reason `stage_spine.py` gives. Resumable the same way.

Usage:
    python3 -u tools/assets/stage_enemy_spine.py [--staging PATH] [--dry-run]
"""

import argparse
import os
import shutil

from build_manifest import load_enemy_ids
from stage_spine import PROGRESS_EVERY, RIG_EXTENSIONS, needs_copy, print_skip_summary


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_STAGING_DIR = os.path.join(TOOLS_DIR, ".staging")

# Where `fetch.py --only enemy-spine` puts the rigs, relative to the staging root.
UPSTREAM_DIR = os.path.join("enemy-spine-upstream", "models_enemies")

# The published folder, relative to the staging root's `assets`.
PUBLISHED_DIR = "spine-enemies"

# The prefix an enemy id carries and an upstream folder name drops.
ENEMY_PREFIX = "enemy_"


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Planning


def plan_enemy_copies(staging_dir, enemy_ids):
	"""
	Pair every enemy rig file with where it will be published.

	Args:
		staging_dir: Root of the staged tree.
		enemy_ids: Every enemy variant id the importer wrote.

	Returns:
		A `(jobs, missing, skipped)` triple. `jobs` is a sorted list of `(source_path, destination_path)` pairs. `missing` is the sorted
		enemy ids with no upstream folder. `skipped` counts `unknown_enemy` folders, `duplicate` files carrying a `$` and `other_file`
		files that are not part of a rig.
	"""
	source_root = os.path.join(staging_dir, UPSTREAM_DIR)
	output_root = os.path.join(staging_dir, "assets", PUBLISHED_DIR)
	skipped = {"unknown_enemy": 0, "duplicate": 0, "other_file": 0}
	jobs = []
	found = set()
	if os.path.isdir(source_root):
		for slug in sorted(os.listdir(source_root)):
			folder = os.path.join(source_root, slug)
			if not os.path.isdir(folder):
				continue
			enemy_id = ENEMY_PREFIX + slug
			if enemy_id not in enemy_ids:
				skipped["unknown_enemy"] += 1
				continue
			found.add(enemy_id)
			for name in sorted(os.listdir(folder)):
				if not name.endswith(RIG_EXTENSIONS):
					skipped["other_file"] += 1
				elif "$" in name:
					skipped["duplicate"] += 1
				else:
					jobs.append((os.path.join(folder, name), os.path.join(output_root, enemy_id, name)))
	return sorted(jobs), sorted(enemy_ids - found), skipped


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Entry point


def main():
	"""Parse arguments, plan the copies, and run them unless this is a dry run."""
	parser = argparse.ArgumentParser(description="Copy fetched enemy rigs into the publish tree.")
	parser.add_argument("--staging", default=DEFAULT_STAGING_DIR, help="Root of the staged tree. Defaults to tools/assets/.staging.")
	parser.add_argument("--dry-run", action="store_true", help="Report what would be copied without writing anything.")
	args = parser.parse_args()

	jobs, missing, skipped = plan_enemy_copies(args.staging, load_enemy_ids())
	pending = [job for job in jobs if needs_copy(*job)]
	skipped["already_copied"] = len(jobs) - len(pending)

	total = sum(os.path.getsize(source) for source, _destination in jobs)
	print(f"rig files   {len(jobs)}")
	print(f"to copy     {len(pending)}")
	print(f"bytes       {total / 1e6:.1f} MB")
	print(f"no rig      {len(missing)}: {', '.join(missing[:20])}")
	print_skip_summary(skipped)

	if args.dry_run:
		print("--dry-run: nothing was written")
		return 0

	for index, (source, destination) in enumerate(pending, start=1):
		os.makedirs(os.path.dirname(destination), exist_ok=True)
		shutil.copy2(source, destination)
		if index % PROGRESS_EVERY == 0:
			print(f"copied {index} of {len(pending)}")
	print(f"copied {len(pending)} files")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
