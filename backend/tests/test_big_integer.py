"""Lossless big-integer transport tests (beyond JS Number.MAX_SAFE_INTEGER).

Delays and window endpoints are unrestricted integers; the value
9007199254740993 (2^53 + 1) is legal and must survive both the request body
and the response body verbatim. These tests send/assert RAW JSON text so a
Python-side int coercion could never mask a wire-level regression.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

BIG = 9007199254740993
BIG_TEXT = str(BIG)
ROUNDED = "9007199254740992"  # what an IEEE-754 double would silently show

RAW_BATCH = f"""{{
  "nodes": ["R", "L1", "L2"],
  "edges": [
    {{"id": "e1", "source": "R", "target": "L1", "delay": {BIG_TEXT}, "cap": 0}},
    {{"id": "e2", "source": "R", "target": "L2", "delay": 0, "cap": 0}}
  ],
  "windows": [
    {{"node": "L1", "lo": {BIG_TEXT}, "hi": {BIG_TEXT}}},
    {{"node": "L2", "lo": 0, "hi": 0}}
  ]
}}"""


def test_big_integer_batch_round_trips_losslessly():
    r = client.post(
        "/api/v1/solve",
        content=RAW_BATCH,
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 200, r.text

    # Raw wire direction: the exact decimal must appear, never its rounded
    # double neighbor.
    assert BIG_TEXT in r.text
    assert ROUNDED not in r.text

    body = json.loads(r.content)
    assert body["status"] == "feasible"

    leaves = {x["node"]: x for x in body["leaves"]}
    assert leaves["L1"]["arrival"] == BIG
    assert leaves["L1"]["lo"] == BIG and leaves["L1"]["hi"] == BIG
    assert leaves["L1"]["reachable_low"] == BIG
    assert leaves["L1"]["reachable_high"] == BIG  # cap 0 -> base + 0
    assert leaves["L2"]["arrival"] == 0

    tree = {x["node"]: x for x in body["tree"]["rows"]}
    assert tree["L1"]["edge_delay"] == BIG
    assert tree["L1"]["arrival"] == BIG
    assert tree["L1"]["window"] == {"lo": BIG, "hi": BIG}

    edges = {x["id"]: x for x in body["edges"]}
    assert edges["e1"]["delay"] == BIG
    # No compensation is needed, so objective figures stay small integers.
    assert body["objectives"]["positive_edges"] == 0
    assert body["objectives"]["total_compensation"] == 0
    assert body["objectives"]["vector"] == [0, 0]


def test_non_integer_float_endpoint_is_still_rejected():
    bad = RAW_BATCH.replace(f'"lo": {BIG_TEXT}', '"lo": 9007199254740993.5')
    r = client.post(
        "/api/v1/solve",
        content=bad,
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 422
