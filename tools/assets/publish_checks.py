"""
Guards that stand between a mistake and the public assets repo.

Publishing is the one irreversible step in the asset pipeline: about 0.68 GB across 3502 files goes to a separate public repo,
`steve1316/ak-archive-assets`. These are pure functions with no git or network access, checked before that publish runs.
"""

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Size limits

BYTES_PER_MB = 1000 * 1000

# Our own warn and refuse lines, under GitHub's 5 GB repo recommendation. Decimal megabytes keep the check on the strict side.
REFUSE_TOTAL_BYTES = 5000 * BYTES_PER_MB
WARN_TOTAL_BYTES = 4000 * BYTES_PER_MB

# GitHub warns above 50 MB per file and rejects above 100 MB.
MAX_FILE_BYTES = 50 * BYTES_PER_MB

# Bytes of new files one publish commit carries at most. About 0.68 GB goes out in total, which is slow and all-or-nothing as a single push,
# so it goes out in batches instead and an interrupted publish resumes.
BATCH_BYTES = 200 * BYTES_PER_MB


def check_sizes(files):
    """
    Check a set of files against the per-file and total size ceilings.

    A total over `WARN_TOTAL_BYTES` but under `REFUSE_TOTAL_BYTES` is not a problem - the caller should still print it, since it is
    distinguishable from the problems this returns only by checking the total against `WARN_TOTAL_BYTES` itself.

    Args:
        files: `(path, size)` pairs, sizes in bytes.

    Returns:
        A list of human-readable problems, one per file over `MAX_FILE_BYTES` plus one if the total is over `REFUSE_TOTAL_BYTES`. An
        empty list means the tree is publishable.
    """
    problems = []
    total = 0
    for path, size in files:
        total += size
        if size > MAX_FILE_BYTES:
            problems.append(f"{path} is {size} bytes, over the {MAX_FILE_BYTES} byte per-file ceiling")
    if total > REFUSE_TOTAL_BYTES:
        problems.append(f"total is {total} bytes, over the {REFUSE_TOTAL_BYTES} byte refuse line")
    return problems


def plan_batches(files, cap):
    """
    Greedily pack files into batches whose sizes stay under a cap.

    A single file larger than `cap` still goes out, alone, rather than being dropped - omitting an asset silently would be worse
    than a batch that ignores the cap for one file.

    Args:
        files: `(path, size)` pairs, sizes in bytes.
        cap: The maximum total size of a batch, in bytes.

    Returns:
        A list of batches, each a list of `(path, size)` pairs.
    """
    batches = []
    current = []
    current_size = 0
    for path, size in files:
        if size > cap:
            batches.append([(path, size)])
            continue
        if current and current_size + size > cap:
            batches.append(current)
            current = []
            current_size = 0
        current.append((path, size))
        current_size += size
    if current:
        batches.append(current)
    return batches


def compare_manifests(regenerated, committed):
    """
    Compare a freshly regenerated manifest against the one already committed.

    Args:
        regenerated: The manifest built from the files about to be published.
        committed: The manifest currently checked into the repo.

    Returns:
        A list of human-readable problems, one per key whose value differs between the two, so a publish cannot ship a manifest
        that disagrees with the files beside it.
    """
    problems = []
    keys = set(regenerated) | set(committed)
    for key in sorted(keys, key=str):
        if regenerated.get(key) != committed.get(key):
            problems.append(f"{key} differs between the regenerated and committed manifest")
    return problems
