"""
Guards that stand between a mistake and the public assets repo.

Publishing is the one irreversible step in the asset pipeline: about 0.68 GB across 3502 files goes to a separate public repo,
`steve1316/ak-archive-assets`. These are pure functions with no git or network access, checked before that publish runs.
"""

import re

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


def redundant_crop_base(name, suffix, present):
    """
    The base filename a `suffix`-ending crop duplicates, if one sits beside it.

    Shared between the publish-time filter and the `remove` command, since both need to tell a genuine crop-variant duplicate (a `_2b` file
    that crops `_2`) from a filename that merely happens to end in the suffix (`char_487_bobb.webp`, where the operator's own id ends in "b").
    A crop's own numbered base sometimes has no literal file either, when that number doubles as the operator's canonical variant and so ships
    with no number at all (`char_002_amiya_1b.webp` duplicates plain `char_002_amiya.webp`) - that fallback is checked too.

    Args:
        name: A filename, such as `char_002_amiya_2b.webp`.
        suffix: The stem suffix that marks a crop, such as `"b"`.
        present: Every filename that sits beside `name` in the same directory.

    Returns:
        The base filename `name` duplicates, if `present` holds one, else None. A bare suffix stem (such as `"b.webp"`) never matches, since
        stripping it would leave an empty base to look for.
    """
    stem, dot, extension = name.rpartition(".")
    if not dot or not stem.endswith(suffix) or len(stem) == len(suffix):
        return None

    prefix = stem[: -len(suffix)]
    candidates = [prefix]
    omitted_number = re.match(r"^(.*)_\d+$", prefix)
    if omitted_number:
        # A numbered skin's base art sometimes omits its own number entirely (char_002_amiya_1b.webp duplicates plain char_002_amiya.webp).
        candidates.append(omitted_number.group(1))

    for candidate in candidates:
        base_name = f"{candidate}.{extension}"
        if base_name in present:
            return base_name
    return None


def plan_removals(files, predicate):
    """
    Select the files a removal run will delete.

    Kept separate from the deleting code so the selection rule can be tested without a clone. A removal is the one operation in this pipeline
    that destroys published work, so the rule that chooses what goes is worth testing on its own.

    Args:
        files: `(path, size)` pairs from the published tree.
        predicate: Called with a path, returns True when that path should be removed.

    Returns:
        The subset of `files` the predicate selected, in the order given.
    """
    return [(path, size) for path, size in files if predicate(path)]


def batch_message(new_count, changed_count, number, total):
    """
    Build the commit message for one publish batch.

    The message has to describe what the batch did, not what the bulk publish usually does. The first run added 3502 new files across four
    batches, so "Add asset batch 1 of 4 (638 files)" read correctly. The same template then produced "Add asset batch 1 of 1 (1 files)" for a
    one-file manifest update, which adds nothing, is not one of several batches, and is not grammatical.

    Args:
        new_count: Files in this batch that the repo does not have yet.
        changed_count: Files in this batch that the repo has and this run modifies.
        number: This batch's 1-based position.
        total: How many batches this publish has.

    Returns:
        A single-line commit message in the imperative, naming only what the batch actually carries. The batch position is appended only when
        there is more than one batch, since "batch 1 of 1" is noise.

    Raises:
        ValueError: If the batch carries no files, which means a caller planned an empty commit.
    """
    if new_count <= 0 and changed_count <= 0:
        raise ValueError("a publish batch must carry at least one file")

    parts = []
    if new_count > 0:
        parts.append(f"Add {new_count} {'file' if new_count == 1 else 'files'}")
    if changed_count > 0:
        word = "Update" if not parts else "update"
        parts.append(f"{word} {changed_count} {'file' if changed_count == 1 else 'files'}")

    message = " and ".join(parts)
    if total > 1:
        message += f" (batch {number} of {total})"
    return message
