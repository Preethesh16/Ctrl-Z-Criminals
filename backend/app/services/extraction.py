"""Document processing service: stored upload → parsed transactions in DB."""

import hashlib
from datetime import time
from pathlib import Path

from sqlalchemy.orm import Session

from ..config import get_settings
from ..ingest.router import UnsupportedFormat, extract_rows
from ..models import AuditLog, Document, Job, Transaction

PARSER_VERSION = "p1.0"


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def process_document(db: Session, document_id: str, stored_path: str, job_id: str) -> None:
    """Background task: parse one uploaded statement into canonical transactions."""
    settings = get_settings()
    doc = db.get(Document, document_id)
    job = db.get(Job, job_id)
    if doc is None or job is None:
        return

    job.status, job.progress = "running", 10
    doc.status = "parsing"
    db.commit()

    try:
        txns, info = extract_rows(stored_path)
    except UnsupportedFormat as e:
        doc.status, doc.error = "failed", str(e)
        job.status, job.detail = "failed", str(e)
        db.add(AuditLog(case_id=doc.case_id, action="parse_failed",
                        detail={"document": doc.filename, "reason": str(e)}))
        db.commit()
        return
    except Exception as e:  # noqa: BLE001 — job must record any parser crash
        doc.status, doc.error = "failed", f"{type(e).__name__}: {e}"
        job.status, job.detail = "failed", doc.error
        db.add(AuditLog(case_id=doc.case_id, action="parse_error",
                        detail={"document": doc.filename, "error": doc.error}))
        db.commit()
        return

    meta = info.get("header_meta") or {}
    doc.file_kind = info.get("file_kind", doc.file_kind)
    doc.parser_version = PARSER_VERSION
    doc.account_number = meta.get("account_number")
    doc.account_holder = meta.get("account_holder")
    doc.bank_name = meta.get("bank_name")
    doc.ifsc = meta.get("ifsc")
    doc.period_from = meta.get("period_from")
    doc.period_to = meta.get("period_to")

    account_ref = (doc.account_number or Path(doc.filename).stem)[-12:]
    job.progress = 60
    db.commit()

    for t in txns:
        db.add(Transaction(
            case_id=doc.case_id,
            document_id=doc.id,
            account_ref=account_ref,
            row_index=t.row_index,
            txn_date=t.txn_date,
            txn_time=time.fromisoformat(t.txn_time) if t.txn_time else None,
            amount_inr=t.amount,
            direction=t.direction,
            balance_after=t.balance,
            channel=t.channel,
            narration_raw=t.narration,
            reference_id=t.reference_id,
            counterparty_id=t.counterparty_id,
            counterparty_name=t.counterparty_name,
            extraction_confidence=t.confidence,
            needs_review=t.confidence < settings.review_confidence_threshold,
        ))

    doc.status = "parsed"
    job.status, job.progress = "done", 100
    job.detail = f"{len(txns)} transactions"
    db.add(AuditLog(case_id=doc.case_id, action="parsed", detail={
        "document": doc.filename, "sha256": doc.sha256, "parser": PARSER_VERSION,
        "rows": len(txns), "mode": info.get("extraction_mode"),
        "header_row": info.get("header_row"), "skipped": info.get("skipped"),
    }))
    db.commit()
