"""
Turning upstream art filenames into the names the site asks for.

Upstream names per variant: `char_002_amiya_1.png`, `_1+`, `_2`, `_epoque_4`. The site's `portraitUrl(id)` asks for exactly one file per
operator, so one variant has to be chosen as canonical and the rest keep a suffix. This module owns that decision and nothing else, which is
why it is the only part of the pipeline with tests behind it - it decides 3502 filenames and a mistake means re-publishing.
"""

import re

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Variant rules

# A base variant is a plain number, optionally with a trailing `+`. `1` is the default art, `2` the elite-2 art, and `1+` the same costume
# re-rendered with different lighting. Anything else - `epoque_4`, `winter_1`, `2b` - is a skin.
BASE_VARIANT = re.compile(r"^\d+\+?$")


def parse_asset(stem, operator_ids):
    """
    Split an upstream filename stem into the operator it belongs to and its variant key.

    Matches the longest operator id that prefixes the stem, because ids nest: `char_1001_amiya2_2` belongs to `char_1001_amiya2`, not to
    some shorter id plus leftover text.

    Args:
        stem: The filename without its extension, such as `char_002_amiya_1`.
        operator_ids: Every known operator id.

    Returns:
        A `(operator_id, variant_key)` pair, or None when the stem belongs to no known operator.
    """
    best = None
    for candidate in operator_ids:
        if stem.startswith(candidate + "_") and (best is None or len(candidate) > len(best)):
            best = candidate
    if best is None:
        return None
    return best, stem[len(best) + 1 :]


def is_test_variant(key):
    """
    Whether a variant is an upstream test asset that must never be published.

    Args:
        key: The variant key.

    Returns:
        True when the key names a test asset.
    """
    return "test" in key.lower()


def is_base_variant(key):
    """
    Whether a variant is the operator's own art rather than a skin.

    Args:
        key: The variant key.

    Returns:
        True for a plain number, optionally with a trailing `+`.
    """
    return BASE_VARIANT.match(key) is not None


def is_redundant_crop(key, keys):
    """
    Whether a variant is a redundant crop of another variant the same operator already has.

    Upstream ships a "b" twin of many keys: the same artwork, at a different crop and about half the resolution. Comparing char_172_svrash's
    `_2` against `_2b` confirmed this - same art, no content of its own. 1005 of these were published before this rule existed, at 171.8 MB.

    Args:
        key: The variant key to check.
        keys: Every variant key the same operator has.

    Returns:
        True when `key` ends in "b" and the same operator also has the key with that "b" stripped. A bare "b" key never matches, since
        stripping it would leave an empty base to look for.
    """
    return len(key) > 1 and key.endswith("b") and key[:-1] in keys


def normalise_key(key):
    """
    Make a variant key safe to put in a URL path.

    `+` is the only character upstream uses that a raw URL handles badly, so it becomes `plus`. The manifest records the normalised key, so
    nothing downstream has to redo this mapping.

    Args:
        key: The variant key.

    Returns:
        The key with `+` replaced.
    """
    return key.replace("+", "plus")


def canonical_key(keys):
    """
    Pick the variant that publishes without a suffix.

    `1` wins when it exists. When it does not, the lowest plain number wins instead - `char_1001_amiya2` and `char_1037_amiya3` exist only at
    elite 2 and ship no `_1`, and without this fallback they would publish no canonical art despite having art. `+` variants are never
    canonical: they are the same costume re-lit, not the base.

    `src/lib/forms.ts` mirrors this rule by hand to find each operator's bare-published form - change one, update the other too.

    Args:
        keys: Every variant key an operator has.

    Returns:
        The canonical key, or None when the operator has only skins.
    """
    numbers = [key for key in keys if is_base_variant(key) and "+" not in key]
    if not numbers:
        return None
    if "1" in numbers:
        return "1"
    return min(numbers, key=int)


def output_name(operator_id, key, canonical):
    """
    The published filename for one upstream variant.

    Args:
        operator_id: The operator the file belongs to.
        key: The variant key.
        canonical: The operator's canonical key, from `canonical_key`.

    Returns:
        The `.webp` filename the site will ask for.
    """
    if key == canonical:
        return f"{operator_id}.webp"
    return f"{operator_id}_{normalise_key(key)}.webp"
