from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Base, SessionLocal, engine, get_db
from .ingest.detector import detect_file_kind
from .models import AuditLog, Case, Document, Job, Transaction
from .schemas import (
    BankTemplateIn,
    BankTemplateOut,
    CaseCreate,
    CaseOut,
    DocumentOut,
    JobOut,
    Page,
    TransactionOut,
    TransactionReview,
    UploadOut,
)
from .services.extraction import process_document, sha256_file

Base.metadata.create_all(engine)

app = FastAPI(title="TraceNet API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/cases", response_model=CaseOut)
def create_case(body: CaseCreate, db: Session = Depends(get_db)):
    case = Case(**body.model_dump())
    db.add(case)
    db.add(AuditLog(action="case_created", detail={"fir": body.fir_number}))
    db.commit()
    db.refresh(case)
    return case


@app.get("/cases", response_model=list[CaseOut])
def list_cases(db: Session = Depends(get_db)):
    return db.scalars(select(Case).order_by(Case.created_at.desc())).all()


@app.get("/cases/{case_id}", response_model=CaseOut)
def get_case(case_id: str, db: Session = Depends(get_db)):
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(404, "case not found")
    return case


def _run_process(document_id: str, stored_path: str, job_id: str) -> None:
    db = SessionLocal()
    try:
        process_document(db, document_id, stored_path, job_id)
    finally:
        db.close()


@app.post("/cases/{case_id}/documents", response_model=UploadOut)
@app.post("/cases/{case_id}/uploads", response_model=UploadOut)  # alias used by frontend client
async def upload_document(
    case_id: str,
    file: UploadFile,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    settings = get_settings()
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(404, "case not found")

    content = await file.read()
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"file exceeds {settings.max_upload_mb} MB")

    upload_dir = Path(settings.upload_dir) / case_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    stored = upload_dir / (file.filename or "statement.bin")
    stored.write_bytes(content)

    digest = sha256_file(stored)
    dup = db.scalar(select(Document).where(Document.case_id == case_id, Document.sha256 == digest))
    if dup is not None:
        raise HTTPException(409, f"identical file already uploaded: {dup.filename}")

    doc = Document(
        case_id=case_id,
        filename=file.filename or "statement.bin",
        sha256=digest,
        file_kind=detect_file_kind(stored, content[:4096]),
    )
    db.add(doc)
    db.flush()
    job = Job(case_id=case_id, kind="parse", document_id=doc.id)
    db.add(job)
    db.add(AuditLog(case_id=case_id, action="document_uploaded",
                    detail={"filename": doc.filename, "sha256": digest}))
    db.commit()
    db.refresh(doc)
    db.refresh(job)

    background.add_task(_run_process, doc.id, str(stored), job.id)
    return UploadOut(document_id=doc.id, job_id=job.id, filename=doc.filename, sha256=doc.sha256)


@app.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    return job


@app.get("/cases/{case_id}/documents", response_model=list[DocumentOut])
def list_documents(case_id: str, db: Session = Depends(get_db)):
    docs = db.scalars(select(Document).where(Document.case_id == case_id)).all()
    out = []
    for d in docs:
        item = DocumentOut.model_validate(d)
        item.txn_count = db.scalar(
            select(func.count()).select_from(Transaction).where(Transaction.document_id == d.id)
        ) or 0
        out.append(item)
    return out


@app.get("/templates", response_model=list[BankTemplateOut])
def list_templates(db: Session = Depends(get_db)):
    from .models import BankTemplate

    return db.scalars(select(BankTemplate).order_by(BankTemplate.created_at.desc())).all()


@app.post("/templates", response_model=BankTemplateOut)
def save_template(body: BankTemplateIn, db: Session = Depends(get_db)):
    """Save an officer-defined column mapping for reuse on future statements."""
    from .models import BankTemplate

    existing = db.scalar(select(BankTemplate).where(
        BankTemplate.header_signature == body.header_signature))
    if existing is not None:
        existing.name, existing.bank, existing.mapping = body.name, body.bank, body.mapping
        template = existing
    else:
        template = BankTemplate(**body.model_dump())
        db.add(template)
    db.add(AuditLog(actor="officer", action="template_saved",
                    detail={"name": body.name, "signature": body.header_signature[:120]}))
    db.commit()
    db.refresh(template)
    return template


@app.post("/transactions/{txn_id}/review", response_model=TransactionOut)
def review_transaction(txn_id: str, body: TransactionReview, db: Session = Depends(get_db)):
    """Officer review: confirm / correct / exclude a row. Fully audit-logged."""
    txn = db.get(Transaction, txn_id)
    if txn is None:
        raise HTTPException(404, "transaction not found")

    changes: dict = {"action": body.action}
    if body.action == "exclude":
        txn.excluded = True
    elif body.action == "correct":
        from decimal import Decimal, InvalidOperation

        for field in ("txn_date", "direction", "narration_raw", "channel"):
            value = getattr(body, field)
            if value is not None:
                changes[field] = {"from": str(getattr(txn, field)), "to": str(value)}
                setattr(txn, field, value)
        if body.amount_inr is not None:
            try:
                amount = Decimal(body.amount_inr)
            except InvalidOperation:
                raise HTTPException(422, "amount_inr must be a decimal string") from None
            changes["amount_inr"] = {"from": str(txn.amount_inr), "to": str(amount)}
            txn.amount_inr = amount
    txn.needs_review = False
    txn.extraction_confidence = 1.0  # officer-verified

    db.add(AuditLog(case_id=txn.case_id, actor="officer", action=f"review_{body.action}",
                    detail={"transaction_id": txn.id, **changes}))
    db.commit()
    db.refresh(txn)
    return txn


@app.post("/cases/{case_id}/clean")
def clean_case(case_id: str, db: Session = Depends(get_db)) -> dict:
    """Run the cleaning pass: balance validation, duplicates, reversals."""
    if db.get(Case, case_id) is None:
        raise HTTPException(404, "case not found")
    from .services.cleaning import run_cleaning

    return run_cleaning(db, case_id)


@app.get("/cases/{case_id}/transactions", response_model=Page[TransactionOut])
def list_transactions(
    case_id: str,
    offset: int = 0,
    limit: int = 100,
    needs_review: bool | None = None,
    db: Session = Depends(get_db),
):
    q = select(Transaction).where(Transaction.case_id == case_id)
    if needs_review is not None:
        q = q.where(Transaction.needs_review == needs_review)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(q.order_by(Transaction.txn_date, Transaction.row_index)
                      .offset(offset).limit(min(limit, 500))).all()
    return Page[TransactionOut](
        items=[TransactionOut.model_validate(r) for r in rows],
        total=total, offset=offset, limit=limit,
    )
