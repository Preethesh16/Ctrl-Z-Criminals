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
        f"/cases/{case_id}/documents",
        files={"file": ("stmt.csv", io.BytesIO(CSV), "text/csv")},
    )
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]

    # TestClient runs BackgroundTasks synchronously — job is done by now.
    r = client.get(f"/jobs/{job_id}")
    assert r.json()["status"] == "done", r.json()

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
