import io

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

CSV = b"""TRAN-DATE,TRAN_PARTICULAR,CHQ-NUM,WITHDRAWAL,DEPOSIT,BALANCE
01-02-2025,UPI/CR/436512345678/RAVI/YBL/ravi@ybl/pay,,,50000.00,55000.00
02-02-2025,ATM WDL 02:14 MG ROAD,,40000.00,,15000.00
"""


def test_upload_flow():
    r = client.post("/cases", json={"fir_number": "TEST-0001/2026", "complainant": "Test"})
    assert r.status_code == 200, r.text
    case_id = r.json()["id"]

    r = client.post(
        f"/cases/{case_id}/uploads",  # frontend-client alias path
        files={"file": ("stmt.csv", io.BytesIO(CSV), "text/csv")},
    )
    assert r.status_code == 200, r.text
    up = r.json()
    assert set(up) == {"document_id", "job_id", "filename", "sha256"}

    # TestClient runs BackgroundTasks synchronously — job is done by now.
    r = client.get(f"/jobs/{up['job_id']}")
    body = r.json()
    assert body["status"] == "done", body
    assert body["transactions_found"] == 2
    assert body["document_id"] == up["document_id"]

    r = client.get(f"/cases/{case_id}/transactions")
    body = r.json()
    assert body["total"] == 2
    dirs = {t["direction"] for t in body["items"]}
    assert dirs == {"DEBIT", "CREDIT"}
    assert body["items"][0]["amount_inr"] == "50000.00"

    # duplicate upload rejected by sha256
    r = client.post(
        f"/cases/{case_id}/documents",
        files={"file": ("stmt-copy.csv", io.BytesIO(CSV), "text/csv")},
    )
    assert r.status_code == 409


def test_review_flow():
    r = client.post("/cases", json={"fir_number": "TEST-0002/2026"})
    case_id = r.json()["id"]
    r = client.post(f"/cases/{case_id}/uploads",
                    files={"file": ("s2.csv", io.BytesIO(CSV), "text/csv")})
    assert r.status_code == 200
    r = client.get(f"/cases/{case_id}/transactions")
    txn = r.json()["items"][0]

    # correct the amount
    r = client.post(f"/transactions/{txn['id']}/review",
                    json={"action": "correct", "amount_inr": "51000.00"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["amount_inr"] == "51000.00"
    assert body["needs_review"] is False
    assert body["extraction_confidence"] == 1.0

    # exclude another row
    txn2 = client.get(f"/cases/{case_id}/transactions").json()["items"][1]
    r = client.post(f"/transactions/{txn2['id']}/review", json={"action": "exclude"})
    assert r.json()["excluded"] is True

    # cleaning endpoint runs and reports a summary
    r = client.post(f"/cases/{case_id}/clean")
    assert r.status_code == 200
    assert set(r.json()) == {"transactions", "balance_breaks", "duplicate_pairs", "reversal_pairs"}
