# Person A — Data & Detection Engine (backend lane)

Scope: `backend/app/**`, `backend/tests/**`, `tools/statement-forge/**`. Read plan.md first; tick progress.md as you go. Branch: `person-a/p<phase>-<feature>`.

> ⚠️ **Confidential data**: validate parsers locally against `Bank-statements-dataset/` (real police data — git-ignored, NEVER push, never use in committed fixtures or LLM calls). All committed test fixtures come from statement-forge only. Full rules in CLAUDE.md.

## Phase 1 — Foundation

1. **Scaffold**: `backend/` with FastAPI app factory, `config.py` (pydantic-settings, `.env`), `db.py` (SQLAlchemy 2, `DATABASE_URL` with SQLite fallback), Alembic migrations.
2. **Models**: Case, Document (with sha256, parser_version), Transaction (canonical schema from plan.md — txn_id, case_id, account_ref, txn_date/time, amount_inr Decimal, txn_direction, balance_after, channel, narration_raw, reference_id, counterparty_id/name, flags JSONB, extraction_confidence), Account, Flag, Job, AuditLog.
3. **Digital PDF parser** (`ingest/pdf_digital.py`): pdfplumber tables, header-block extraction (holder, acct no, IFSC, period, opening/closing balance), repeated-page-header removal, multi-line narration merging.
4. **Excel/CSV parsers**: header-row detection by keyword match; `csv.Sniffer`; pandas.
5. **Normalization** (`normalize/`): date formats (DD-MM-YYYY, DD/MM/YY, "01 Jan 2026"…; resolve DD/MM vs MM/DD via statement period + monotonicity), amounts (Indian grouping, Dr/Cr suffix, signed single column, ₹ symbol), channel classifier (UPI/NEFT/IMPS/RTGS/ATM/CHEQUE/CASH/POS/INTERNAL/UNKNOWN), reference extraction with per-channel format validation (12-digit RRN for UPI/IMPS, ~16-char NEFT UTR, ~22-char RTGS).
6. **Evidence Locker**: SHA-256 on upload, audit rows for every mutation.
7. **API + contract**: routers for cases/uploads/jobs/transactions; background job via `BackgroundTasks` + jobs table. **Deliverable: OpenAPI JSON committed for Person B.**

Acceptance: pytest green; a real-style digital PDF fixture parses to the canonical set; balance reconciles.

## Phase 2 — Full Ingestion & Cleaning

1. **OCR pipeline** (`ingest/pdf_scanned.py`, `image.py`, `ocr_preprocess.py`): pdf2image → OpenCV deskew/denoise/adaptive-threshold → PaddleOCR PP-Structure (primary) + Tesseract 5 (cross-check). Cell agreement ⇒ high confidence; disagreement ⇒ review queue.
2. **DOCX parser** (python-docx tables, text fallback). **docling fallback** for digital PDFs triggered by failed balance reconciliation.
3. **Cleaning suite** (`cleaning/`): exact dup key (date, amount, direction, ref) + fuzzy pass (same date/amount/direction + narration similarity ≥0.9) — flag, never delete; reversal pairing (identical amount, N days, REV/RET/FAILED/REFUND/same ref) → `REVERSED`, excluded from flow analysis; running balance check (±₹0.01) → FD-07.
4. **Bank templates** (`normalize/bank_templates/`): column maps for SBI, HDFC, ICICI, Axis, Kotak, Canara, PNB, BoB + template save/load API for the mapping UI.
5. **statement-forge** (`tools/statement-forge/`): generate one coherent synthetic fraud case — victim + 8 mules, 4 banks, 6 output formats (digital PDF, 200-DPI scanned PDF, XLSX, CSV, DOCX, photo JPEG), planted: round-trip loop, smurfing under ₹50k, 40% ATM cash-out, one reversed txn. Same data drives pytest fixtures.

Acceptance: all 6 formats normalize to the identical canonical transaction set (golden test).

## Phase 3 — Detection & Analysis

1. **Flow graph** (`detection/flowgraph.py`): nodes = normalized accounts (own + counterparties); confirmed edges via RRN/UTR match across statements; probable edges via temporal-amount matching (±30 min, ≤2% fee tolerance).
2. **Round-trip** (`detection/roundtrip.py`): time-respecting DFS — strictly increasing timestamps, hop bound 6, sources seeded by high in+out throughput. Score loops (amount, hops, elapsed, % returned). Static-only cycles reported as "linked cluster".
3. **FIFO trail** (`detection/fifo_trail.py`): tranche queue per plan.md §4.5 — partial attribution, stop rules (tranche exhaustion | balance return), interleaved credits, "₹X still resting" output.
4. **Correlation** (`detection/correlation.py`): identifiers across ≥2 statements or receiving from ≥3 sources.
5. **Disposition**: % cash/cheque/redirected/merchant/unclassified — per account, case, and per trail.
6. **Rules FD-01…FD-08** + Isolation Forest (train on statement-forge data); evidence payload (rule inputs) on every flag; ≥2 signals ⇒ High Confidence.
7. **Analysis APIs**: Cytoscape-format graph JSON, round-trips, trail, disposition, flags.

Acceptance: planted loop found with correct members; FIFO attribution sums exactly; donut matches planted 40% cash.

## Phase 4 — Reports & Hardening

1. **Standardized extraction PDF**: uniform table (Date | Narration | Ref | Debit | Credit | Balance | Channel | Source) across all inputs.
2. **Investigation report** (Jinja2 → WeasyPrint): sections per plan.md §4.8 incl. legal clause mapping (IT Act 66C/66D, BNS 318) and audit trail with hashes.
3. **Excel export**: 6-sheet workbook.
4. **LLM assist** (`llm/`, `LLM_ENABLED=false` default): column-map suggestions + narrative; masked samples only; log every call to audit trail.
5. **Hardening**: validation, error envelopes, pagination, structured logging.
