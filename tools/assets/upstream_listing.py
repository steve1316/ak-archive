"""
List one folder of an upstream mirror at a pinned commit through the GitHub trees API, without cloning anything.

A refresh run plans from names and sizes alone, so one recursive tree call per folder replaces a multi-GB sparse clone. The API caps a recursive
tree at 100,000 entries and says so with `truncated`, and planning from a partial list would quietly miss files, so that fails instead. The
largest folder read, fexli's `spine`, is about 14,500 entries.
"""

import json
import os
import urllib.parse
import urllib.request

# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Constants

API_BASE = "https://api.github.com"
USER_AGENT = "ak-archive-refresh/1.0 (https://github.com/steve1316/ak-archive)"
REQUEST_TIMEOUT_SECONDS = 60


# //////////////////////////////////////////////////////////////////////////////////////////////////
# //////////////////////////////////////////////////////////////////////////////////////////////////
# Listing


def list_folder(repo, sha, folder, token=None):
    """
    List every file under one folder of a repo at a commit.

    Args:
        repo: The `owner/name` of the repo.
        sha: The commit sha.
        folder: The folder path, such as `assets/dyn/arts/skills`.
        token: A GitHub token for a higher rate limit, or None. `GITHUB_TOKEN` is read when this is None.

    Returns:
        A list of `{path, sha, size}` dicts, one per file, the path relative to `folder` with forward slashes.

    Raises:
        RuntimeError: When the API reports the listing as truncated.
        urllib.error.HTTPError: When the request fails.
    """
    ref = urllib.parse.quote(f"{sha}:{folder}", safe="")
    request = urllib.request.Request(f"{API_BASE}/repos/{repo}/git/trees/{ref}?recursive=1", headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"})
    token = token or os.environ.get("GITHUB_TOKEN")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        body = json.load(response)
    if body.get("truncated"):
        raise RuntimeError(f"the listing of {repo}:{folder} at {sha[:10]} came back truncated, so planning from it would miss files")
    return [{"path": item["path"], "sha": item["sha"], "size": item.get("size", 0)} for item in body["tree"] if item["type"] == "blob"]
