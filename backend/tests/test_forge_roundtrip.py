"""Golden test: every statement-forge format parses through our extractor.

This is the public, committed counterpart of the confidential-dataset
validation — same pipeline, synthetic data.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from app.ingest.router import extract_rows

FORGE = Path(__file__).resolve().parents[2] / "tools" / "statement-forge"
OUT = FORGE / "out"


@pytest.fixture(scope="module", autouse=True)
def forge_output():
    subprocess.run([sys.executable, str(FORGE / "forge.py"), str(OUT)], check=True)
    return json.loads((OUT / "case_manifest.json").read_text())


def _ocr_ready() -> bool:
    from app.ingest.ocr import tesseract_available

    try:
        import paddleocr  # noqa: F401

        return True
    except ImportError:
        return tesseract_available()


def statement_files(include_scanned: bool = None):
    if include_scanned is None:
        include_scanned = _ocr_ready()
    files = sorted(p for p in OUT.glob("*") if p.suffix in (".pdf", ".csv", ".xlsx", ".xls", ".txt", ".docx"))
    if not include_scanned:
        files = [f for f in files if "scanned" not in f.name]
    return files


def test_all_formats_extract(forge_output):
    manifest = forge_output
    expected_by_file = {v["file"]: v["rows"] for v in manifest["accounts"].values()}
    parsed_total = 0
    for f in statement_files():
        txns, info = extract_rows(f)
        expected = expected_by_file[f.name]
        assert txns, f"{f.name}: zero rows extracted ({info})"
        min_ratio = 0.7 if "scanned" in f.name else 0.9  # OCR loses some rows
        assert len(txns) >= expected * min_ratio, (
            f"{f.name}: {len(txns)}/{expected} rows ({info.get('extraction_mode', info.get('file_kind'))})"
        )
        parsed_total += len(txns)
    assert parsed_total >= 40


def test_planted_smurfing_references_survive(forge_output):
    """The smurfing RRNs must appear on BOTH sides (victim debit, mule credit)."""
    refs = set(forge_output["planted"]["smurfing"]["refs"])
    seen: dict[str, int] = {}
    for f in statement_files():
        txns, _ = extract_rows(f)
        for t in txns:
            if t.reference_id in refs:
                seen[t.reference_id] = seen.get(t.reference_id, 0) + 1
    assert set(seen) == refs, f"missing refs: {refs - set(seen)}"
    assert all(count == 2 for count in seen.values()), seen  # both legs found


def test_directions_and_balances(forge_output):
    """Every parsed statement must reconcile its running balance."""
    from app.cleaning.balance_check import check_balance_consistency

    for f in statement_files(include_scanned=False):  # OCR digit misreads exempt
        txns, _ = extract_rows(f)

        class R:  # adapt RawTxn → balance_check row shape
            def __init__(self, t):
                self.row_index = t.row_index
                self.amount_inr = t.amount
                self.direction = t.direction
                self.balance_after = t.balance

        breaks, _ = check_balance_consistency([R(t) for t in txns])
        assert not breaks, f"{f.name}: {len(breaks)} balance breaks"
