# Person A — Work Log (Data & Detection lane)

> **Protocol for AI sessions**: this file is Person A's running context. At the END of every working prompt/session, append a dated entry under *Log* covering: what was done, files touched, decisions made, test results, and what's next. Read this file FIRST when resuming work. Rules of the road: CLAUDE.md (lanes, branches, confidential data). Task list: tasks/person-a.md. Tick progress.md alongside.

## Current state (always keep this section fresh)

- **Branch**: `person-a/p1-foundation`
- **Phase**: 1 — Foundation (in progress)
- **Working setup**: `backend/.venv` (Python 3.14), deps in `backend/requirements.txt`, run tests with `cd backend && .venv/bin/python -m pytest -q`
- **Real-data harness**: `backend/tools/validate_dataset.py` — runs extractor over the confidential `Bank-statements-dataset/` (local only, never committed) and prints aggregate stats
- **Real-data coverage**: **160/162 files, 195,041 transactions, 0 crashes — the 2 "zero-row" files verifiably contain no transactions (dormant/summary-only), so effective coverage is 100%** (validation round 5)
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

### 2026-07-02 — Session 9: the \b bug — misparse fixes on "worst offender" PDFs
- Fixed three compounding extraction bugs found while chasing high balance-break files:
  1. **Continuation-line loss**: BoB-style layouts print the full UPI/IMPS reference on the NEXT line; fallback parser dropped it → refs truncated. Now non-amount lines append to the previous row's narration (`collect_text_lines`, guarded to 5-col regex rows only). Worst file: refs 0 → 2106/2214.
  2. **Duplicated regex path**: read_pdf_grid's inline loop unified with read_pdf_text_lines.
  3. **The `\b` bug (critical)**: `parse_amount`'s Dr/Cr stripper used `\b`, but regex has NO word boundary between digit and letter — glued suffixes ("11,000.00Cr") never parsed and balances silently became None → no balance chain → no direction repair → silent all-DEBIT files. Fixed with `(?<![A-Za-z])` lookbehind + regression tests.
- Former worst offenders after fix: Statement 578… 2214 rows / full balance chain / 691 credits repaired / 0 breaks; 45170 stmt 1565 rows 0 breaks (was 94.7% break rate); STATEMENT 1026 0 breaks; KOMAL 6 breaks in 228 (genuine statement quirks — FD-07's job).
- Final validation: **160/162, 195,041 txns, 0 crashes**; channel classification improved (UNKNOWN −2.1k, refs recovered feed NEFT/IMPS/CHEQUE up). 69/69 tests.
- Lane A closed. **Final balance-audit: 112/148 balance-bearing docs reconcile perfectly (was 78 at first measurement); of the 36 with breaks, all but one are ≤8.5% break-rate (statement quirks FD-07 correctly surfaces).**

### 2026-07-03 — Session 10: soa fixed (last known misparse)
- `soa_0167042251865512.pdf` (AU Bank web export, 222 pages): txn lines carry `amount rate lcy_amount` with the TRUE balance alone on the next line — parser took the LCY duplicate as balance (97.6% breaks). Fix in `collect_text_lines`: lone-amount follow-up line becomes the row's balance; when the captured balance equalled the amount (LCY duplicate), the middle rate column is dropped as noise. Result: **4.3% breaks, full balance chain, 642 credits repaired, refs extracted.** 69/69 tests. No known systematic misparses remain.

### 2026-07-02 — Session 8: hardening + 100% effective real-data coverage
- API hardening: upload filename traversal fix (basename-only), empty-file 422, global 500 envelope. 68 tests.
- Stubborn-file iteration (was 11 zero-row):
  - `_AMT` now tolerates glued/spaced Cr/Dr suffixes ("1,50,391.44Cr") → fixed STATEMENT 1026 ×2, KOMAL, 8642666611469255, "Statement from 16082019".
  - TXT gets the PDF line-regex fallback (Finacle exports drift per row; fixed-width slicing can't hold) → NITIN ×2.
  - `_LINE_LOOSE` second-chance regex (optional leading serial, ≤3 trailing non-amount tokens, lookahead-guarded), used ONLY when strict matches nothing in the whole document → DEVANSHU (PNB ledger), BOM 570-txn file.
  - Detector: `.txt` extension authoritative over comma-sniffing → shivlal (357 txns).
  - Remaining 2 "zero-row" files verified transaction-free (Withdrawal/Deposit Count: 0; single-page account summary) — correct output.
- **Final validation: 160/162 files, 195,041 txns, 0 crashes, 0 needs-review false floods.** Dropped docling fallback as unnecessary (deviation noted in progress.md).
- Lane A is now COMPLETE across Phases 1–4. Waiting on B: report page, Golden Hour, Docker → Checkpoint 4 joint rehearsal.

### 2026-07-02 — Session 7: merges + LLM assist
- Merged B's Phase-3 visuals (PR #4: Cytoscape graph w/ loop highlighting, Sankey trail page, dashboard donut/timeline; Checkpoint 3 verified B-side) into my branch; merged `person-a/p4-reports` into main → main `08071c8` has everything from both lanes. Untracked `tools/statement-forge/out/` (generated PDFs embed timestamps → dirtied git every test run; regenerate via forge.py).
- **LLM assist** (`app/llm/`, OFF by default): `masking.py` is the single privacy choke point (digits→last-4, VPA local→2 chars, names→initials; header names pass through); `assist.py` — column-mapping suggestion (officer must confirm in the mapping UI) + report narrative from aggregates only. Endpoints `GET /documents/{id}/suggest-mapping`, `GET /cases/{id}/report/narrative`; 501 when disabled; audit-logged. Tests cover the masking contract + disabled-by-default. **67/67 tests, 25 API paths.**
- Remaining lane-A: API hardening (small), docling fallback + 4 stubborn real PDFs (non-blocking). B: report page, Golden Hour, Docker, polish → Checkpoint 4 rehearsal.

### 2026-07-02 — Session 6: merges + Phase 4 exports (3 of 5 lane-A tasks)
- Merged: origin/main → p3 branch; p3 → main; B's `person-b/p2-real-wiring` → main (her Checkpoint-2 verification: 8 formats, reversal caught, review flow green against real API). main `813889f` carries both lanes; 60/60 green post-merge. New branch `person-a/p4-reports`.
- **Reporting** (`app/reporting/`): one Jinja2 context builder feeds every output (preview and court PDF can never diverge).
  - `GET /cases/{id}/report/preview` — HTML investigation report (same template as PDF) for B's report page.
  - `GET /cases/{id}/export/report.pdf` — WeasyPrint: case header, evidence chain with SHA-256 per document, cleaning summary, round-trip loops with edge evidence, disposition table, common identifiers, flagged txns with rule chips + why-lines, legal clause mapping (PMLA/BNS/IT Act/BSA), audit trail. Page footers mark CONFIDENTIAL + page numbers.
  - `GET /cases/{id}/export/standardized.pdf` — mentor req 3: every source format as ONE uniform table (Date|Narration|Ref|Debit|Credit|Balance|Channel) per document with hashes.
  - `GET /cases/{id}/export/case.xlsx` — 6 sheets: Transactions, Flags, Round Trips, Accounts, Disposition, Audit.
  - Exports are audit-logged (who exported what, when — chain of custody).
- Golden exports test: forge case → analyze → HTML contains loop-1 + FIR; both PDFs valid; workbook sheet structure + row counts asserted. **64/64 tests.** Contract regenerated (23 paths).
- Remaining lane-A: LLM assist (flagged off), API hardening; P2 stragglers (docling fallback, 4 stubborn real PDFs). B's Phase 3/4: viz pages + report page + Docker.

### 2026-07-02 — Session 5: DETECTION ENGINE COMPLETE (all Phase 3 lane-A tasks)
- Branch `person-a/p3-detection` (main was merged first; Checkpoint 1 landed via B's PR #2).
- Reconciled B's provisional endpoints for real: `GET /cases/{id}/stats` (her CaseStats shape), `GET /documents/{id}/columns`, `POST /documents/{id}/template` (her index→field mapping; saves BankTemplate; re-parses), saved-template auto-retry on zero-row parses, review accepts nested `corrections`.
- **Detection engine** (`app/detection/`):
  - `flowgraph.py` — edges in 3 evidence tiers: confirmed (RRN/UTR both-leg match), probable (±2% amount within 30min/same-day), external (counterparty nodes); node table with accumulator badge.
  - `roundtrip.py` — time-respecting bounded DFS (non-decreasing timestamps for date-granularity data, hop≤6, in/out seed filtering), rotation-aware, loop scoring (amount/speed/%returned/confirmed-share). Key insight encoded in tests: a cycle is temporal iff SOME rotation is time-ordered; only all-descending cycles are rejected.
  - `fifo_trail.py` — tranche queue with split attribution, stop rules (tranche|balance), resting-amount report.
  - `rules.py` — FD-01 round-figure, FD-02 rapid in-out, FD-03 odd-hour, FD-04 smurfing, FD-05 velocity, FD-06 new-account, FD-08 dominance; every flag carries `why` + evidence values.
  - `anomaly.py` — local IsolationForest (log-amount, hour, dow, channel, account z-score), ≥30 rows.
  - `correlation.py`, `disposition.py` — common identifiers, % cash/cheque/redirected buckets.
- `services/analysis.py` — one-button orchestrator (cleaning→rules→ML→graph→loops→evidence gate ≥2 signals→artifacts stored in `analysis_results`). APIs: POST `/cases/{id}/analyze`; GET `graph` (Cytoscape elements), `round-trips`, `correlation`, `disposition`, `trail/{txn_id}?stop_rule=`.
- Extraction fixes found by the golden e2e: fixed-width TXT reader (data-occupancy column inference — naive 2-space split dropped empty debit cells and mis-directioned credits); header meta now extracted for ALL tabular formats (account_ref = real account number everywhere); HTML meta from tag-stripped text.
- **Golden e2e green: all 9 forge formats uploaded (incl. scanned via OCR) → analyze → planted loop m3→m4→m5→m1 found, smurfing (6 credits) flagged, cash% > 10, confirmed edges present, FIFO trail arithmetic exact. 60/60 tests.**
- Person B can now build: Cytoscape graph page, trail Sankey, dashboard donut — every endpoint is live in openapi.json.
- Next (Phase 4): standardized extraction PDF, investigation report PDF, Excel export, LLM assist, hardening. Remaining P2 stragglers: docling fallback, 4 stubborn real-PDF layouts.

### 2026-07-02 — Session 4: Checkpoint 1 passed; OCR + DOCX + templates
- Pulled main: Deepthi reconciled the API layer to the contract and **verified Checkpoint 1 end-to-end** (UI → /api proxy → FastAPI → 47 txns). Phase 1 fully closed.
- **OCR pipeline** (`ingest/ocr.py`, `ocr_preprocess.py`): pdf2image rasterize → OpenCV deskew/denoise/adaptive-threshold → pluggable engine (PaddleOCR if installed, else Tesseract via pytesseract) → OCR lines with confidence → same `_LINE` regex path as digital PDFs → per-line OCR confidence blended into row confidence → direction repair. Scanned PDFs and photo uploads route through it. ⚠ validation blocked: `tesseract` binary not installed yet on this machine (`sudo pacman -S tesseract tesseract-data-eng`); golden test auto-skips.
- **DOCX parser** (`ingest/docxfile.py`): tables → grid, paragraphs → header meta.
- **statement-forge v2**: mule6 now DOCX, mule8 a 200-DPI image-only scanned PDF (exercises OCR); stale-output cleanup; DOCX round-trip green in golden tests.
- **Saved-template API**: `BankTemplate` model + GET/POST `/templates` (upsert by normalized header signature) — backend for Deepthi's column-mapping UI. Auto-application at parse time still TODO (bank-templates task).
- Tests: 38 passing. Contract regenerated. New deps: pdf2image, opencv-python-headless, pytesseract, python-docx.
- Next: template auto-application; 4 stubborn PDF layouts; then Phase 3 detection.

### 2026-07-02 — Session 4b: OCR validated end-to-end
- Tesseract was present all along (`/usr/bin/tesseract`; earlier sandbox PATH check lied). Golden scanned-PDF test initially failed — two real bugs found:
  1. PIL writes image-PDFs with no DPI ⇒ pdf2image re-render exploded to 9746×6892 px and Tesseract collapsed. Fix: `resolution=200` in forge writer + defensive 3600px cap in `ocr_image` (protects against phone photos too).
  2. Ruled table grid lines wreck Tesseract line segmentation (table OCR'd as one garbage line). Fix: morphology-based `remove_table_rules()` (open with 60px h/v kernels, paint white); also dropped the adaptive threshold — measured worse than Tesseract's internal Otsu on clean scans.
- After fixes: scanned statement OCRs cleanly (`09-05-2026 POS ... 1567.00 11249.00`), full suite 38/38 with the OCR golden test actually executing.

### 2026-07-02 — Session 3: direction repair + statement-forge + review API
- Balance audit round 1 exposed a systematic bug: `pdf_text_regex` fallback dropped credit rows (`0.00 | 500.00 | bal` → amount 0 → skipped) and guessed all directions as DEBIT. Fixes:
  - fallback now emits 5-col rows keeping BOTH amount columns;
  - new `rows.repair_directions()` uses running-balance deltas as ground truth to correct DEBIT/CREDIT (handles newest-first statements); applied to all regex-fallback extractions.
- Built `tools/statement-forge/forge.py`: deterministic synthetic fraud case — victim + 8 mules, 4 banks, 5 formats (reportlab PDF, Finacle CSV, XLSX, HTML-disguised .xls, fixed-width TXT), planted smurfing (6×<50k), layering, time-ordered ROUND TRIP (m3→m4→m5→m1), ~40% ATM cash-out at odd hours, one reversed IMPS — with `case_manifest.json` ground truth. Bug found & fixed en route: balances must be computed AFTER time-sorting events, not in call order.
- Golden tests: all forge formats extract (≥90% row recovery), planted RRNs found on both legs, all balances reconcile. New deps: reportlab, lxml. pandas `read_html` fixes: StringIO wrapper + re-adding `<th>` header row.
- Review-queue API: `POST /transactions/{id}/review` (confirm/correct/exclude, per-field audit of corrections, confidence→1.0 officer-verified). Contract regenerated.
- Tests: 37 passing.
- **Balance audit after repair** (121 real docs with balance chains): perfect 78→**88**, with-breaks 43→**33**; STATEMENT (3)/(6)-class files fell from 33.9% to ≤3% break rate. Remaining stubborn: `Statement 57856891688032*.pdf`, `soa_0167042251865512.pdf`, `45170 stmt.pdf` (~95-98% breaks — regex fallback misreads their column order entirely; needs a per-layout look, Phase 2). FD-07 on real data now measures statements, not our parser.

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
