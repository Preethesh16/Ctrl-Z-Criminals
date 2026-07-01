# Person A — Work Log (Data & Detection lane)

> **Protocol for AI sessions**: this file is Person A's running context. At the END of every working prompt/session, append a dated entry under *Log* covering: what was done, files touched, decisions made, test results, and what's next. Read this file FIRST when resuming work. Rules of the road: CLAUDE.md (lanes, branches, confidential data). Task list: tasks/person-a.md. Tick progress.md alongside.

## Current state (always keep this section fresh)

- **Branch**: `person-a/p1-foundation`
- **Phase**: 1 — Foundation (in progress)
- **Working setup**: `backend/.venv` (Python 3.14), deps in `backend/requirements.txt`, run tests with `cd backend && .venv/bin/python -m pytest -q`
- **Real-data harness**: `backend/tools/validate_dataset.py` — runs extractor over the confidential `Bank-statements-dataset/` (local only, never committed) and prints aggregate stats
- **Next up**: fix zero-row/failed files from validation, wire FastAPI endpoints (cases/upload/jobs/transactions), publish OpenAPI contract for Person B, balance-consistency validation

## Key dataset intelligence (from recon of the real police data — 2026-07-02)

162 files, 54 MB: 103 PDF, 23 XLSX, 22 XLS, 11 CSV, 3 TXT.

- PDFs: 88 digital-with-tables, 15 digital-no-tables (regex line fallback), none scanned in page-1 sampling — OCR still needed for problem-statement compliance but not the bottleneck here.
- **15 “.xls” files are actually XLSX** (zip magic) → detector sniffs magic bytes, never trusts extensions.
- 14 distinct tabular layouts; the big ones: `CTR BATCH NO|TXN DT|…|DEBIT|CREDIT|BALANCE` (13×), Finacle CSV `TRAN_DATE|CHQNO|PARTICULARS|DR|CR|BAL|SOL` (7×), `ACCOUNT NO.|TRAN DATE|…|BALANCE INDICATOR` (5×), iCore `Ac_No|…|Dr_Amt|Cr_Amt|Balance` (4×).
- Plain-text statements exist (Kerala Gramin Bank) → TXT parser added (2+ space split).
- Headers appear anywhere in the first ~20 rows → header-row auto-detection by keyword scoring, not fixed positions.

## Architecture delivered so far (backend/app/)

- `config.py`, `db.py` — settings via pydantic-settings; SQLAlchemy with SQLite fallback
- `models.py` — Case, Document (header meta + sha256), Transaction (canonical schema), Job, AuditLog
- `normalize/` — `dates.py` (all Indian formats, impossible-month swap), `amounts.py` (1,00,000.50, Dr/Cr suffix, parentheses/trailing-minus), `channel.py` (UPI/ATM/NEFT/RTGS/IMPS/CHEQUE/CASH/POS/INTERNAL rules), `reference.py` (per-channel RRN/UTR validation + VPA/counterparty-name extraction)
- `ingest/` — `detector.py` (magic bytes), `columns.py` (alias map built from the 14 real layouts), `rows.py` (grid→RawTxn: header scoring, continuation-line merge, single-amount+CR/DR handling, per-row confidence), `tabular.py` (xlsx/xls/csv/html-table), `pdf_digital.py` (tables + regex line fallback + header meta), `headermeta.py`, `router.py` (any file → txns)
- `tests/` — 17 unit tests green (normalize + rows)

## Log

### 2026-07-02 — Session 1: recon + extraction core
- Created branch `person-a/p1-foundation`.
- Ran structure-only recon over the confidential dataset (aggregates only; nothing committed) — findings above.
- Built the full extraction core (see Architecture) driven by the real layouts; 17 unit tests passing.
- Built `tools/validate_dataset.py`; first full-dataset validation run in progress — results and fixes to be logged next entry.
- Confidentiality: dataset stays git-ignored; validation prints aggregate counts only; `LLM_ENABLED` stays false.
