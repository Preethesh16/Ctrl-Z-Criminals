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


def test_stats_columns_and_template_flow():
    r = client.post("/cases", json={"fir_number": "TEST-0003/2026"})
    case_id = r.json()["id"]
    up = client.post(f"/cases/{case_id}/uploads",
                     files={"file": ("s3.csv", io.BytesIO(CSV), "text/csv")}).json()

    # stats in B's CaseStats shape
    stats = client.get(f"/cases/{case_id}/stats").json()
    assert stats["transactions_count"] == 2
    assert stats["documents_count"] == 1
    assert set(stats["cleaning"]) == {"duplicates_flagged", "reversals_detected", "balance_breaks"}

    # columns for the mapping UI
    cols = client.get(f"/documents/{up['document_id']}/columns").json()
    headers = [c["header"] for c in cols["columns"]]
    assert "TRAN-DATE" in headers and "BALANCE" in headers
    assert any(c["samples"] for c in cols["columns"])

    # apply an officer template (B's index->field shape) → re-parse
    r = client.post(f"/documents/{up['document_id']}/template", json={
        "bank_name": "Finacle Generic",
        "mapping": {"0": "txn_date", "1": "narration", "3": "debit", "4": "credit", "5": "balance"},
    })
    assert r.status_code == 200, r.text
    job = client.get(f"/jobs/{r.json()['id']}").json()
    assert job["status"] == "done", job
    assert job["transactions_found"] == 2
    assert any(t["name"] == "Finacle Generic" for t in client.get("/templates").json())


def test_review_nested_corrections_shape():
    r = client.post("/cases", json={"fir_number": "TEST-0004/2026"})
    case_id = r.json()["id"]
    client.post(f"/cases/{case_id}/uploads",
                files={"file": ("s4.csv", io.BytesIO(CSV), "text/csv")})
    txn = client.get(f"/cases/{case_id}/transactions").json()["items"][0]
    r = client.post(f"/transactions/{txn['id']}/review",
                    json={"action": "correct", "corrections": {"direction": "DEBIT"}})
    assert r.status_code == 200, r.text
    assert r.json()["direction"] == "DEBIT"


def test_template_save_and_upsert():
    body = {"name": "PNB ledger", "bank": "PNB",
            "header_signature": "trans dt|particulars|debit|credit|balance",
            "mapping": {"date": 0, "narration": 1, "debit": 2, "credit": 3, "balance": 4}}
    r = client.post("/templates", json=body)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]

    # same signature → update, not duplicate
    body["name"] = "PNB ledger v2"
    r = client.post("/templates", json=body)
    assert r.json()["id"] == tid
    assert r.json()["name"] == "PNB ledger v2"

    names = [t["name"] for t in client.get("/templates").json()]
    assert names.count("PNB ledger v2") == 1


def test_upload_hardening():
    r = client.post("/cases", json={"fir_number": "HARD-0001/2026"})
    case_id = r.json()["id"]

    # empty file rejected
    r = client.post(f"/cases/{case_id}/uploads",
                    files={"file": ("empty.csv", io.BytesIO(b""), "text/csv")})
    assert r.status_code == 422

    # path traversal neutralized: stored under case dir with basename only
    r = client.post(f"/cases/{case_id}/uploads",
                    files={"file": ("../../evil.csv", io.BytesIO(CSV), "text/csv")})
    assert r.status_code == 200
    assert r.json()["filename"] == "evil.csv"
