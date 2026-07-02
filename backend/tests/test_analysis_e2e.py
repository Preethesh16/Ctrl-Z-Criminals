"""Golden end-to-end: the full statement-forge fraud case through the API —
upload all 9 statements, analyze, and verify every planted pattern:
smurfing, the time-ordered round trip, ~40% cash-out, the reversal, and
the common-identifier correlation.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

FORGE = Path(__file__).resolve().parents[2] / "tools" / "statement-forge"
OUT = FORGE / "out"

client = TestClient(app)


@pytest.fixture(scope="module")
def analyzed_case():
    subprocess.run([sys.executable, str(FORGE / "forge.py"), str(OUT)], check=True)
    manifest = json.loads((OUT / "case_manifest.json").read_text())

    from app.ingest.ocr import tesseract_available

    r = client.post("/cases", json={"fir_number": "GOLDEN-0001/2026", "complainant": "Suresh Patil"})
    case_id = r.json()["id"]
    for f in sorted(OUT.glob("*")):
        if f.suffix == ".json":
            continue
        if "scanned" in f.name and not tesseract_available():
            continue
        with f.open("rb") as fh:
            r = client.post(f"/cases/{case_id}/uploads", files={"file": (f.name, fh)})
        assert r.status_code == 200, f"{f.name}: {r.text}"

    summary = client.post(f"/cases/{case_id}/analyze").json()
    return case_id, manifest, summary


def test_summary_counts(analyzed_case):
    _, _, summary = analyzed_case
    assert summary["transactions"] >= 40
    assert summary["flagged"] > 0
    assert summary["round_trips"] >= 1
    assert summary["cleaning"]["reversal_pairs"] == 1


def test_round_trip_planted_loop_found(analyzed_case):
    case_id, manifest, _ = analyzed_case
    loops = client.get(f"/cases/{case_id}/round-trips").json()
    assert loops, "no round trips detected"
    planted = manifest["planted"]["round_trip"]["path"]  # [m3, m4, m5, m1] account numbers
    planted_last4 = {p[-12:] for p in planted}
    best = loops[0]
    # every planted account appears in the best loop's path (node ids are
    # account_refs = last-12 of account number)
    path_nodes = set(best["path"])
    assert planted_last4 <= path_nodes, f"planted {planted_last4} vs found {path_nodes}"


def test_disposition_cash_heavy(analyzed_case):
    case_id, manifest, _ = analyzed_case
    d = client.get(f"/cases/{case_id}/disposition").json()
    cash_pct = d["buckets"]["cash"]["pct"]
    redirected_pct = d["buckets"]["redirected"]["pct"]
    assert cash_pct > 10, d  # planted ~40% of mule outflow as ATM
    assert redirected_pct > 30, d


def test_smurfing_flagged(analyzed_case):
    case_id, _, _ = analyzed_case
    page = client.get(f"/cases/{case_id}/transactions", params={"limit": 500}).json()
    smurf = [t for t in page["items"]
             if any(f.get("rule") == "FD-04-SMURFING" for f in t["flags"])]
    assert len(smurf) >= 6  # 6 planted sub-50k credits (and their debit legs may flag too)


def test_correlation_and_graph(analyzed_case):
    case_id, _, _ = analyzed_case
    graph = client.get(f"/cases/{case_id}/graph").json()
    assert len(graph["nodes"]) >= 9
    assert any(e["data"]["tier"] == "confirmed" for e in graph["edges"])
    suspicions = {n["data"]["suspicion"] for n in graph["nodes"]}
    assert "high" in suspicions


def test_fifo_trail_endpoint(analyzed_case):
    case_id, _, _ = analyzed_case
    page = client.get(f"/cases/{case_id}/transactions",
                      params={"limit": 500}).json()
    credits = [t for t in page["items"]
               if t["direction"] == "CREDIT" and not t["excluded"]
               and float(t["amount_inr"]) > 100000]
    assert credits
    trail = client.get(f"/cases/{case_id}/trail/{credits[0]['id']}").json()
    assert trail["credit_txn_id"] == credits[0]["id"]
    assert float(trail["spent"]) + float(trail["resting"]) == float(trail["credit_amount"])
