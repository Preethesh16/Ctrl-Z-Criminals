"""Pydantic API schemas — the OpenAPI contract Person B codes against.

Money crosses the wire as strings ("50000.00") — never JSON floats.
"""

from datetime import date, datetime, time
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

# DB Numeric → wire string ("50000.00"); never JSON floats for money.
DecimalStr = Annotated[str, BeforeValidator(lambda v: None if v is None else str(v))]


class CaseCreate(BaseModel):
    fir_number: str = Field(min_length=1, max_length=100)
    complainant: str | None = None
    fraud_amount: str | None = None  # decimal string
    complaint_date: date | None = None


class CaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    fir_number: str
    complainant: str | None
    fraud_amount: DecimalStr | None
    complaint_date: date | None
    created_at: datetime


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    case_id: str
    filename: str
    sha256: str
    file_kind: str
    status: str
    error: str | None
    account_number: str | None
    account_holder: str | None
    bank_name: str | None
    period_from: date | None
    period_to: date | None
    txn_count: int = 0


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    case_id: str
    kind: str
    document_id: str | None
    status: str
    progress: int  # 0-100
    detail: str | None
    error_code: str | None
    transactions_found: int | None


class UploadOut(BaseModel):
    """Response to a document upload: everything needed to poll and display."""

    document_id: str
    job_id: str
    filename: str
    sha256: str


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    account_ref: str
    row_index: int
    txn_date: date
    txn_time: time | None
    amount_inr: DecimalStr
    direction: str
    balance_after: DecimalStr | None
    channel: str
    narration_raw: str
    reference_id: str | None
    counterparty_id: str | None
    counterparty_name: str | None
    flags: list
    extraction_confidence: float
    needs_review: bool
    excluded: bool


class ReviewCorrections(BaseModel):
    txn_date: date | None = None
    amount_inr: str | None = None
    direction: str | None = Field(default=None, pattern="^(DEBIT|CREDIT)$")
    narration_raw: str | None = None
    channel: str | None = None


class TransactionReview(BaseModel):
    """Officer review action on a low-confidence/flagged row.

    Corrections may come flat (contract v2) or nested under `corrections`
    (frontend ReviewAction shape) — both accepted.
    """

    action: str = Field(pattern="^(confirm|correct|exclude)$")
    corrections: ReviewCorrections | None = None
    # flat variants of the same fields:
    txn_date: date | None = None
    amount_inr: str | None = None
    direction: str | None = Field(default=None, pattern="^(DEBIT|CREDIT)$")
    narration_raw: str | None = None
    channel: str | None = None

    def merged(self) -> "ReviewCorrections":
        nested = self.corrections or ReviewCorrections()
        return ReviewCorrections(
            txn_date=self.txn_date or nested.txn_date,
            amount_inr=self.amount_inr or nested.amount_inr,
            direction=self.direction or nested.direction,
            narration_raw=self.narration_raw or nested.narration_raw,
            channel=self.channel or nested.channel,
        )


class DocumentColumn(BaseModel):
    index: int
    header: str
    samples: list[str]


class DocumentColumnsOut(BaseModel):
    """Raw extracted grid of an unparseable document, for the mapping UI."""

    document_id: str
    filename: str
    bank_hint: str | None
    columns: list[DocumentColumn]


class ColumnTemplateIn(BaseModel):
    """Frontend mapping shape: column index -> canonical field name."""

    bank_name: str
    mapping: dict[int, str]  # values: txn_date|narration|reference_id|debit|credit|amount_signed|balance|ignore


class CaseStatsOut(BaseModel):
    case_id: str
    documents_count: int
    transactions_count: int
    needs_review_count: int
    flagged_count: int
    accounts_count: int
    round_trips_count: int
    cleaning: dict


class BankTemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    bank: str | None = None
    header_signature: str = Field(min_length=1)
    mapping: dict[str, int]


class BankTemplateOut(BankTemplateIn):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime


class Page[T](BaseModel):
    items: list[T]
    total: int
    offset: int
    limit: int
