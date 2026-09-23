"""Tests for listing a mirror folder through the trees API."""

import io
import json
import os
import sys
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import upstream_listing


def test_list_folder_retries_a_server_error_then_returns_the_listing(monkeypatch):
    calls = []

    def fake_urlopen(request, timeout):
        calls.append(request.full_url)
        if len(calls) == 1:
            raise urllib.error.HTTPError(request.full_url, 500, "Internal Server Error", {}, io.BytesIO(b""))
        return io.BytesIO(json.dumps({"truncated": False, "tree": [{"path": "a.png", "type": "blob", "sha": "s", "size": 3}]}).encode())

    monkeypatch.setattr(upstream_listing.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(upstream_listing, "RETRY_DELAY_SECONDS", 0)
    assert upstream_listing.list_folder("o/r", "sha", "assets/x", token="t") == [{"path": "a.png", "sha": "s", "size": 3}]
    assert len(calls) == 2


def test_list_folder_does_not_retry_a_not_found(monkeypatch):
    calls = []

    def fake_urlopen(request, timeout):
        calls.append(1)
        raise urllib.error.HTTPError(request.full_url, 404, "Not Found", {}, io.BytesIO(b""))

    monkeypatch.setattr(upstream_listing.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(upstream_listing, "RETRY_DELAY_SECONDS", 0)
    try:
        upstream_listing.list_folder("o/r", "sha", "assets/x", token="t")
    except urllib.error.HTTPError as error:
        assert error.code == 404
    assert len(calls) == 1
