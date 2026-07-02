"""LLM assist: masking contract + disabled-by-default behavior.
(Live API calls are not tested — the privacy/masking layer is.)"""

import io

from fastapi.testclient import TestClient

from app.llm.masking import mask_cell, masked_samples
from app.main import app

client = TestClient(app)


def test_mask_cell_hides_pii():
    assert mask_cell("50100234567891") == "XXXXXXXXXX7891"
    assert "ramesh.k" not in mask_cell("UPI/DR/436512345678/ramesh.k@okaxis/pay")
    assert mask_cell("Ramesh Kumar") == "R. K."
    assert "5678" in mask_cell("436512345678")  # last-4 kept for structure


def test_masked_samples_keeps_header():
    grid = [["junk"], ["TRAN-DATE", "PARTICULARS", "WITHDRAWAL"],
            ["01-02-2025", "UPI/DR/436512345678/RAVI/YBL", "45000.00"]]
    out = masked_samples(grid, header_idx=1)
    assert out[0] == ["TRAN-DATE", "PARTICULARS", "WITHDRAWAL"]
    assert "436512345678" not in str(out[1])


def test_llm_endpoints_disabled_by_default():
    r = client.post("/cases", json={"fir_number": "LLM-0001/2026"})
    case_id = r.json()["id"]
    CSV = b"TRAN-DATE,PARTICULARS,WITHDRAWAL,DEPOSIT,BALANCE\n01-02-2025,UPI test,100.00,,900.00\n"
    up = client.post(f"/cases/{case_id}/uploads",
                     files={"file": ("x.csv", io.BytesIO(CSV), "text/csv")}).json()
    r = client.get(f"/documents/{up['document_id']}/suggest-mapping")
    assert r.status_code == 501  # off by default — the privacy stance
    r = client.get(f"/cases/{case_id}/report/narrative")
    assert r.status_code == 501
