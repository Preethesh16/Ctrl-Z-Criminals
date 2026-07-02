# Person A — Work Log (Data & Detection lane)

> **Protocol for AI sessions**: this file is Person A's running context. At the END of every working prompt/session, append a dated entry under *Log* covering: what was done, files touched, decisions made, test results, and what's next. Read this file FIRST when resuming work. Rules of the road: CLAUDE.md (lanes, branches, confidential data). Task list: tasks/person-a.md. Tick progress.md alongside.

## Current state (always keep this section fresh)

- **Branch**: `person-a/p1-foundation`
- **Phase**: 1 — Foundation (in progress)
- **Working setup**: `backend/.venv` (Python 3.14), deps in `backend/requirements.txt`, run tests with `cd backend && .venv/bin/python -m pytest -q`
- **Real-data harness**: `backend/tools/validate_dataset.py` — runs extractor over the confidential `Bank-statements-dataset/` (local only, never committed) and prints aggregate stats
- **Real-data coverage**: **151/162 files (93.2%), 182,515 transactions, 0 crashes** (validation round 3)
- **Integration state**: Deepthi's Phase-1 frontend merged from main (PR #1). API contract v2 shipped — upload returns `{document_id, job_id, filename, sha256}`, `/uploads` path alias, job `error_code`/`transactions_found`, `POST /cases/{id}/clean`. Her remaining type reconciliation items are listed in progress.md "Deviations" — her lane.
- **Next up (Phase 2)**: the 11 remaining zero-row files — fixed-width TXT parser (NITIN/shivlal, Kerala Gramin), PNB "Customer Account Ledger" dash-table layout (DEVANSHU, KOMAL), BOM_Statement FTP layout, `STATEMENT 1026*.pdf`, `4513362998.pdf`, `8642666611469255.pdf`; then balance-consistency check, cleaning suite, OCR pipeline, review-queue API

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

### 2026-07-02 — Session 3: direction repair + statement-forge + review API
- Balance audit round 1 exposed a systematic bug: `pdf_text_regex` fallback dropped credit rows (`0.00 | 500.00 | bal` → amount 0 → skipped) and guessed all directions as DEBIT. Fixes:
  - fallback now emits 5-col rows keeping BOTH amount columns;
  - new `rows.repair_directions()` uses running-balance deltas as ground truth to correct DEBIT/CREDIT (handles newest-first statements); applied to all regex-fallback extractions.
- Built `tools/statement-forge/forge.py`: deterministic synthetic fraud case — victim + 8 mules, 4 banks, 5 formats (reportlab PDF, Finacle CSV, XLSX, HTML-disguised .xls, fixed-width TXT), planted smurfing (6×<50k), layering, time-ordered ROUND TRIP (m3→m4→m5→m1), ~40% ATM cash-out at odd hours, one reversed IMPS — with `case_manifest.json` ground truth. Bug found & fixed en route: balances must be computed AFTER time-sorting events, not in call order.
- Golden tests: all forge formats extract (≥90% row recovery), planted RRNs found on both legs, all balances reconcile. New deps: reportlab, lxml. pandas `read_html` fixes: StringIO wrapper + re-adding `<th>` header row.
- Review-queue API: `POST /transactions/{id}/review` (confirm/correct/exclude, per-field audit of corrections, confidence→1.0 officer-verified). Contract regenerated.
- Tests: 37 passing.

### 2026-07-02 — Session 2: Person B merge + contract v2 + cleaning suite (Phase 2 started)
- Merged `origin/main` (Deepthi's Phase-1 frontend, PR #1) into `person-a/p1-foundation`.
- Audited her provisional `frontend/src/api/types.ts` against the real API — found 6 contract mismatches. Adopted her better designs on the backend (richer upload response, `/uploads` alias, job error codes + transactions_found); documented the 5 frontend-side diffs in progress.md Deviations with @Deepthi tag.
- Built the cleaning suite (`app/cleaning/`):
  - `balance_check.py` — FD-07 running-balance validation, auto-detects newest-first statements, restart-on-gap chains.
  - `dedup.py` — cross-document exact (same ref) + fuzzy (narration ≥0.9) duplicates; flag-only, never delete.
  - `failed_txn.py` — reversal pairing (marker regex or same reference, 5-day window, one pair per leg); paired legs excluded from flow analysis.
  - `services/cleaning.py` — idempotent case-level pass exposed at `POST /cases/{id}/clean`, audit-logged.
- Tests: 32 passing (12 new cleaning tests). Regenerated `openapi.json`.
- Balance audit over real dataset: results below.

### 2026-07-02 — Session 1: recon + extraction core + API (Phase 1 complete for lane A)
- Created branch `person-a/p1-foundation`.
- Ran structure-only recon over the confidential dataset (aggregates only; nothing committed) — findings above.
- Built the full extraction core (see Architecture) driven by the real layouts.
- Built `tools/validate_dataset.py` and iterated three rounds against all 162 real files:
  - **Round 1**: 124/162 ok, 145,763 txns, 0 crashes. Diagnosed the 38 zero-row files.
  - **Fixes**: header normalizer converts dashes→spaces (Finacle `TRAN-DATE|WITHDRAWAL|DEPOSIT`); added `trans date`/`trans dt`/`transaction particulars` aliases; multiline-cell explosion for HDFC packed rows; regex-line retry when detected tables map to nothing; `\s*` after date in line regex (glued date+ref).
  - **Round 2**: 142/162 ok, 179,677 txns. Regression: my explosion split Bandhan's *wrapped* cells (`20-MAR-\n2025`). Fix: explode only when a cell's newline parts are ≥2 parseable dates, else unwrap-join; tolerant month-name date separators.
  - **Round 3**: **151/162 ok (93.2%), 182,515 txns, 0 crashes.**
- Channel census on real data: UPI 121,776 / IMPS 15,140 / NEFT 15,036 / ATM 8,929 / UNKNOWN 15,807 (8.7% — acceptable; officer annotation covers it).
- Built FastAPI layer: POST/GET cases, document upload (SHA-256 → Evidence Locker, duplicate-hash 409), background parse job + polling, paginated transactions with needs_review filter. `backend/openapi.json` committed — **Person B: this is your contract.**
- Tests: 20 passing incl. end-to-end API flow. Fixed en route: txn_time string→`time` coercion, Decimal→string wire serialization (`DecimalStr`), stray line in main.py.
- Confidentiality: dataset stays git-ignored (verified before every commit); validation prints aggregate counts only; `LLM_ENABLED` stays false.
