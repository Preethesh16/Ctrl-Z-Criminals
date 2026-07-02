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
    CaseStatsOut,
    ColumnTemplateIn,
    DocumentColumn,
    DocumentColumnsOut,
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


_FRONTEND_FIELD_MAP = {  # frontend CanonicalField -> internal mapping key
    "txn_date": "date", "narration": "narration", "reference_id": "reference",
    "debit": "debit", "credit": "credit", "amount_signed": "amount", "balance": "balance",
}


def _stored_path(doc: Document) -> Path:
    return Path(get_settings().upload_dir) / doc.case_id / doc.filename


@app.get("/cases/{case_id}/stats", response_model=CaseStatsOut)
def case_stats(case_id: str, db: Session = Depends(get_db)):
    """Dashboard headline numbers + cleaning summary (CaseStats shape)."""
    if db.get(Case, case_id) is None:
        raise HTTPException(404, "case not found")
    txns = db.scalars(select(Transaction).where(Transaction.case_id == case_id)).all()

    def rule_count(prefix: str) -> int:
        return sum(1 for t in txns if any(str(f.get("rule", "")).startswith(prefix) for f in (t.flags or [])))

    loops = {f.get("loop_id") for t in txns for f in (t.flags or []) if f.get("rule") == "ROUND-TRIP"}
    return CaseStatsOut(
        case_id=case_id,
        documents_count=db.scalar(select(func.count()).select_from(Document)
                                  .where(Document.case_id == case_id)) or 0,
        transactions_count=len(txns),
        needs_review_count=sum(1 for t in txns if t.needs_review),
        flagged_count=sum(1 for t in txns if t.flags),
        accounts_count=len({t.account_ref for t in txns}),
        round_trips_count=len(loops - {None}),
        cleaning={
            "duplicates_flagged": rule_count("DUPLICATE"),
            "reversals_detected": rule_count("REVERSED") // 2,  # pairs, not legs
            "balance_breaks": rule_count("FD-07"),
        },
    )


@app.get("/documents/{document_id}/columns", response_model=DocumentColumnsOut)
def document_columns(document_id: str, db: Session = Depends(get_db)):
    """Raw grid columns + samples for the guided column-mapping UI."""
    doc = db.get(Document, document_id)
    if doc is None:
        raise HTTPException(404, "document not found")
    from .ingest.columns import score_header_row
    from .ingest.router import UnsupportedFormat, read_any_grid

    try:
        grid, _ = read_any_grid(_stored_path(doc))
    except (UnsupportedFormat, FileNotFoundError) as e:
        raise HTTPException(422, f"cannot read raw grid: {e}") from None
    if not grid:
        raise HTTPException(422, "document produced an empty grid")

    header_idx = max(range(min(45, len(grid))), key=lambda i: score_header_row(grid[i]))
    header = grid[header_idx]
    data = grid[header_idx + 1 : header_idx + 6]
    width = max(len(header), *(len(r) for r in data)) if data else len(header)
    columns = [
        DocumentColumn(
            index=i,
            header=str(header[i]) if i < len(header) and header[i] is not None else "",
            samples=[str(r[i]) for r in data if i < len(r) and r[i] is not None][:3],
        )
        for i in range(width)
    ]
    return DocumentColumnsOut(document_id=doc.id, filename=doc.filename,
                              bank_hint=doc.bank_name, columns=columns)


@app.post("/documents/{document_id}/template", response_model=JobOut)
def apply_template(document_id: str, body: ColumnTemplateIn, background: BackgroundTasks,
                   db: Session = Depends(get_db)):
    """Save the officer's column mapping as a bank template and re-parse."""
    from .models import BankTemplate

    doc = db.get(Document, document_id)
    if doc is None:
        raise HTTPException(404, "document not found")

    mapping = {
        _FRONTEND_FIELD_MAP[field]: idx
        for idx, field in body.mapping.items()
        if field in _FRONTEND_FIELD_MAP
    }
    if "date" not in mapping or not ({"debit", "credit", "amount"} & set(mapping)):
        raise HTTPException(422, "mapping needs a date column and at least one amount column")

    from .ingest.columns import score_header_row
    from .ingest.router import read_any_grid

    grid, _ = read_any_grid(_stored_path(doc))
    header_idx = max(range(min(45, len(grid))), key=lambda i: score_header_row(grid[i]))
    signature = "|".join(str(c).strip().lower() for c in grid[header_idx])

    existing = db.scalar(select(BankTemplate).where(BankTemplate.header_signature == signature))
    if existing is not None:
        existing.name, existing.bank, existing.mapping = body.bank_name, body.bank_name, mapping
    else:
        db.add(BankTemplate(name=body.bank_name, bank=body.bank_name,
                            header_signature=signature, mapping=mapping))

    # wipe previous rows for this document, then re-parse with the override
    for t in db.scalars(select(Transaction).where(Transaction.document_id == doc.id)):
        db.delete(t)
    job = Job(case_id=doc.case_id, kind="parse", document_id=doc.id)
    db.add(job)
    db.add(AuditLog(case_id=doc.case_id, actor="officer", action="template_applied",
                    detail={"document": doc.filename, "bank": body.bank_name, "mapping": mapping}))
    db.commit()
    db.refresh(job)

    override = {**mapping, "__header_row__": header_idx}
    background.add_task(_run_process_with_mapping, doc.id, str(_stored_path(doc)), job.id, override)
    return job


def _run_process_with_mapping(document_id: str, stored_path: str, job_id: str, mapping: dict) -> None:
    db = SessionLocal()
    try:
        process_document(db, document_id, stored_path, job_id, mapping_override=mapping)
    finally:
        db.close()


@app.get("/documents/{document_id}/suggest-mapping")
def suggest_mapping(document_id: str, db: Session = Depends(get_db)) -> dict:
    """LLM assist (optional): pre-fill the column-mapping UI. 501 when disabled."""
    from .ingest.columns import score_header_row
    from .ingest.router import read_any_grid
    from .llm.assist import LlmDisabled, suggest_column_mapping
    from .llm.masking import masked_samples

    doc = db.get(Document, document_id)
    if doc is None:
        raise HTTPException(404, "document not found")
    grid, _ = read_any_grid(_stored_path(doc))
    header_idx = max(range(min(45, len(grid))), key=lambda i: score_header_row(grid[i]))
    masked = masked_samples(grid, header_idx)
    try:
        mapping = suggest_column_mapping(masked)
    except LlmDisabled as e:
        raise HTTPException(501, str(e)) from None
    db.add(AuditLog(case_id=doc.case_id, action="llm_mapping_suggested",
                    detail={"document": doc.filename, "columns_sent": masked[0],
                            "mapping": mapping}))
    db.commit()
    return {"document_id": document_id, "mapping": mapping,
            "note": "suggestion only — officer must confirm in the mapping UI"}


@app.get("/cases/{case_id}/report/narrative")
def report_narrative_endpoint(case_id: str, db: Session = Depends(get_db)) -> dict:
    """LLM assist (optional): plain-language narrative from aggregate numbers."""
    from .llm.assist import LlmDisabled, report_narrative

    if db.get(Case, case_id) is None:
        raise HTTPException(404, "case not found")
    if not get_settings().llm_enabled:
        raise HTTPException(501, "LLM assist is disabled (set LLM_ENABLED=true)")
    summary = _artifact(db, case_id, "summary")
    loops = _artifact(db, case_id, "round_trips")
    dispo = _artifact(db, case_id, "disposition")
    try:
        text = report_narrative(summary, loops, dispo)
    except LlmDisabled as e:
        raise HTTPException(501, str(e)) from None
    db.add(AuditLog(case_id=case_id, action="llm_narrative_generated",
                    detail={"chars": len(text)}))
    db.commit()
    return {"narrative": text}


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

        fix = body.merged()
        for field in ("txn_date", "direction", "narration_raw", "channel"):
            value = getattr(fix, field)
            if value is not None:
                changes[field] = {"from": str(getattr(txn, field)), "to": str(value)}
                setattr(txn, field, value)
        if fix.amount_inr is not None:
            try:
                amount = Decimal(fix.amount_inr)
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


@app.post("/cases/{case_id}/analyze")
def analyze_case(case_id: str, db: Session = Depends(get_db)) -> dict:
    """One-button analysis: cleaning → rules → ML → graph → round trips →
    correlation → disposition. Returns the summary; artifacts via GETs below."""
    if db.get(Case, case_id) is None:
        raise HTTPException(404, "case not found")
    from .services.analysis import run_analysis

    return run_analysis(db, case_id)


def _artifact(db: Session, case_id: str, kind: str):
    from .models import AnalysisResult

    row = db.scalar(select(AnalysisResult).where(
        AnalysisResult.case_id == case_id, AnalysisResult.kind == kind))
    if row is None:
        raise HTTPException(404, f"no {kind} yet — run POST /cases/{{id}}/analyze first")
    return row.payload


@app.get("/cases/{case_id}/graph")
def case_graph(case_id: str, db: Session = Depends(get_db)):
    """Cytoscape.js elements: {nodes: [{data}], edges: [{data}]}."""
    return _artifact(db, case_id, "graph")


@app.get("/cases/{case_id}/round-trips")
def case_round_trips(case_id: str, db: Session = Depends(get_db)):
    return _artifact(db, case_id, "round_trips")


@app.get("/cases/{case_id}/correlation")
def case_correlation(case_id: str, db: Session = Depends(get_db)):
    return _artifact(db, case_id, "correlation")


@app.get("/cases/{case_id}/disposition")
def case_disposition(case_id: str, db: Session = Depends(get_db)):
    return _artifact(db, case_id, "disposition")


@app.get("/cases/{case_id}/trail/{txn_id}")
def money_trail(case_id: str, txn_id: str, stop_rule: str = "tranche",
                db: Session = Depends(get_db)) -> dict:
    """FIFO money trail for one credit (mentor requirement 5)."""
    if stop_rule not in ("tranche", "balance"):
        raise HTTPException(422, "stop_rule must be 'tranche' or 'balance'")
    target = db.get(Transaction, txn_id)
    if target is None or target.case_id != case_id:
        raise HTTPException(404, "transaction not found in this case")
    if target.direction != "CREDIT":
        raise HTTPException(422, "money trail starts from a CREDIT transaction")
    from dataclasses import asdict

    from .detection.fifo_trail import fifo_trail

    account_txns = db.scalars(select(Transaction).where(
        Transaction.case_id == case_id,
        Transaction.account_ref == target.account_ref)).all()
    trail = fifo_trail(account_txns, txn_id, stop_rule=stop_rule)
    out = asdict(trail)
    for key in ("credit_amount", "pre_credit_balance", "spent", "resting"):
        out[key] = str(out[key]) if out[key] is not None else None
    for hop in out["hops"]:
        hop["attributed"] = str(hop["attributed"])
        hop["debit_total"] = str(hop["debit_total"])
    return out


@app.get("/cases/{case_id}/report/preview")
def report_preview(case_id: str, db: Session = Depends(get_db)):
    """Investigation report as HTML — same template as the PDF (live preview)."""
    from fastapi.responses import HTMLResponse

    from .reporting.builder import render_report_html

    if db.get(Case, case_id) is None:
        raise HTTPException(404, "case not found")
    return HTMLResponse(render_report_html(db, case_id))


@app.get("/cases/{case_id}/export/report.pdf")
def export_report_pdf(case_id: str, db: Session = Depends(get_db)):
    from fastapi.responses import Response

    from .reporting.builder import html_to_pdf, render_report_html

    if db.get(Case, case_id) is None:
        raise HTTPException(404, "case not found")
    pdf = html_to_pdf(render_report_html(db, case_id))
    db.add(AuditLog(case_id=case_id, actor="officer", action="export_report_pdf",
                    detail={"bytes": len(pdf)}))
    db.commit()
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="tracenet-report-{case_id[:8]}.pdf"'})


@app.get("/cases/{case_id}/export/standardized.pdf")
def export_standardized_pdf(case_id: str, db: Session = Depends(get_db)):
    """Mentor requirement 3: every source format re-rendered as ONE uniform table."""
    from fastapi.responses import Response

    from .reporting.builder import html_to_pdf, render_standardized_html

    if db.get(Case, case_id) is None:
        raise HTTPException(404, "case not found")
    pdf = html_to_pdf(render_standardized_html(db, case_id))
    db.add(AuditLog(case_id=case_id, actor="officer", action="export_standardized_pdf",
                    detail={"bytes": len(pdf)}))
    db.commit()
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="tracenet-standardized-{case_id[:8]}.pdf"'})


@app.get("/cases/{case_id}/export/case.xlsx")
def export_excel(case_id: str, db: Session = Depends(get_db)):
    from fastapi.responses import Response

    from .reporting.builder import build_excel

    if db.get(Case, case_id) is None:
        raise HTTPException(404, "case not found")
    data = build_excel(db, case_id)
    db.add(AuditLog(case_id=case_id, actor="officer", action="export_excel",
                    detail={"bytes": len(data)}))
    db.commit()
    return Response(
        data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="tracenet-case-{case_id[:8]}.xlsx"'})


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
