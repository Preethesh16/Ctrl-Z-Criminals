import uuid
from datetime import UTC, date, datetime, time
from decimal import Decimal

from sqlalchemy import JSON, Date, DateTime, Enum, ForeignKey, Numeric, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(UTC)


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    fir_number: Mapped[str] = mapped_column(String(100))
    complainant: Mapped[str | None] = mapped_column(String(200))
    fraud_amount: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    complaint_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    documents: Mapped[list["Document"]] = relationship(back_populates="case")


class Document(Base):
    """One uploaded source file. SHA-256 recorded immediately — Evidence Locker."""

    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    filename: Mapped[str] = mapped_column(String(300))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    file_kind: Mapped[str] = mapped_column(String(20))  # pdf_digital/pdf_scanned/xlsx/xls/csv/docx/image/txt
    parser_version: Mapped[str] = mapped_column(String(40), default="")
    status: Mapped[str] = mapped_column(String(20), default="uploaded")  # uploaded/parsing/parsed/failed
    error: Mapped[str | None] = mapped_column(Text)
    # Statement header block, extracted before rows:
    account_number: Mapped[str | None] = mapped_column(String(40), index=True)
    account_holder: Mapped[str | None] = mapped_column(String(200))
    bank_name: Mapped[str | None] = mapped_column(String(100))
    ifsc: Mapped[str | None] = mapped_column(String(15))
    period_from: Mapped[date | None] = mapped_column(Date)
    period_to: Mapped[date | None] = mapped_column(Date)
    opening_balance: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    closing_balance: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    case: Mapped[Case] = relationship(back_populates="documents")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="document")


class Transaction(Base):
    """Canonical transaction — the unified schema every format normalizes into."""

    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    account_ref: Mapped[str] = mapped_column(String(60), index=True)
    row_index: Mapped[int] = mapped_column()  # order within source statement
    txn_date: Mapped[date] = mapped_column(Date, index=True)
    txn_time: Mapped[time | None] = mapped_column(Time)
    amount_inr: Mapped[Decimal] = mapped_column(Numeric(16, 2))  # always positive
    direction: Mapped[str] = mapped_column(Enum("DEBIT", "CREDIT", name="txn_direction"))
    balance_after: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    channel: Mapped[str] = mapped_column(String(12), default="UNKNOWN", index=True)
    narration_raw: Mapped[str] = mapped_column(Text, default="")
    reference_id: Mapped[str | None] = mapped_column(String(40), index=True)
    counterparty_id: Mapped[str | None] = mapped_column(String(120), index=True)
    counterparty_name: Mapped[str | None] = mapped_column(String(200))
    flags: Mapped[list] = mapped_column(JSON, default=list)
    extraction_confidence: Mapped[float] = mapped_column(default=1.0)
    needs_review: Mapped[bool] = mapped_column(default=False)
    excluded: Mapped[bool] = mapped_column(default=False)  # officer-excluded or reversal-paired

    document: Mapped[Document] = relationship(back_populates="transactions")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    kind: Mapped[str] = mapped_column(String(30))  # parse/analyze/report
    document_id: Mapped[str | None] = mapped_column(String(36), index=True)
    status: Mapped[str] = mapped_column(String(15), default="pending")  # pending/running/done/failed
    progress: Mapped[int] = mapped_column(default=0)  # 0-100
    detail: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(30))  # PASSWORD_PROTECTED/UNSUPPORTED_FORMAT/PARSE_FAILED
    transactions_found: Mapped[int | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class AnalysisResult(Base):
    """Stored output of the last analysis run, one row per artifact kind
    (graph / round_trips / correlation / disposition / summary)."""

    __tablename__ = "analysis_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)
    payload: Mapped[dict | list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class BankTemplate(Base):
    """Officer-saved column mapping for an unrecognized statement layout.

    header_signature = normalized '|'-joined header cells; at parse time an
    unmapped grid is matched against saved signatures before failing.
    """

    __tablename__ = "bank_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    bank: Mapped[str | None] = mapped_column(String(80))
    header_signature: Mapped[str] = mapped_column(Text, unique=True)
    mapping: Mapped[dict] = mapped_column(JSON)  # canonical field -> column index
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ReportSignature(Base):
    """Digital signature record for every report generated by this system.

    The server HMAC-signs the report's content hash (secret never leaves the
    box); the verify endpoint looks the ID up and re-checks the signature, so
    a report not in this table — or with a tampered hash — is exposed as fake.
    Append-only, like the audit log.
    """

    __tablename__ = "report_signatures"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    case_id: Mapped[str] = mapped_column(String(36), index=True)
    report_type: Mapped[str] = mapped_column(String(60))
    content_hash: Mapped[str] = mapped_column(String(64))  # SHA-256 hex of report data
    signature: Mapped[str] = mapped_column(String(64))  # HMAC-SHA256 hex
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AuditLog(Base):
    """Append-only. Every mutation, parse and officer action lands here."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    case_id: Mapped[str | None] = mapped_column(String(36), index=True)
    actor: Mapped[str] = mapped_column(String(100), default="system")
    action: Mapped[str] = mapped_column(String(60))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
