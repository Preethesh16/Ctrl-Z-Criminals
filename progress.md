# TraceNet Progress Tracker

> Rules (from CLAUDE.md): tick the box **immediately** when a task is done and append `(done: YYYY-MM-DD, A|B)`. If blocked, add `> blocked: <reason>` under the task and switch to your branch + mocks — never wait for the other lane. Commit this file together with the work it describes.

**Branches**: `person-a/<phase>-<feature>`, `person-b/<phase>-<feature>`. Merge to `main` only at phase checkpoints.

---

## Phase 1 — Foundation

### Person A
- [x] Repo scaffold: backend project, requirements.txt, config, SQLAlchemy setup (Postgres + SQLite fallback) (done: 2026-07-02, A)
- [x] DB models: Case, Document, Transaction, Account, Flag, Job, AuditLog (done: 2026-07-02, A)
- [x] Canonical transaction schema (Pydantic) per plan.md §4.1 proposal schema (done: 2026-07-02, A)
- [x] Digital PDF parser (pdfplumber) with header-block extraction (done: 2026-07-02, A)
- [x] Excel (XLSX/XLS) parser with header-row auto-detection (done: 2026-07-02, A)
- [x] CSV/TSV parser with dialect sniffing (done: 2026-07-02, A)
- [x] Normalization: dates (all Indian formats), amounts (1,00,000 / Dr-Cr / signed column), channel classifier, reference-ID extraction (RRN/UTR per-channel regex) (done: 2026-07-02, A)
- [x] SHA-256 on upload + Evidence Locker records (done: 2026-07-02, A)
- [x] API: cases, upload, job status, transactions list — **publish OpenAPI contract for Person B** (done: 2026-07-02, A)

### Person B
- [x] Frontend scaffold: Vite + React 18 + TS + Tailwind v4 + framer-motion + design-token theme & motion presets (done: 2026-07-02, setup)
- [x] Typed API client generated from OpenAPI contract + mock fixtures fallback (done: 2026-07-01, B)
  > note: types are hand-written from plan.md §4.1 (`frontend/src/api/types.ts`) since the OpenAPI contract isn't published yet; regenerate + reconcile when Person A ships it. Mock adapter is default; `VITE_API_MODE=real` flips to the FastAPI proxy.
- [x] Cases list page + New Case form (FIR no., complainant, fraud amount) (done: 2026-07-01, B)
- [x] Case wizard shell (Upload → Review → Analyze steps) (done: 2026-07-01, B)
- [x] Upload dropzone: multi-file, per-file progress via job polling, "N transactions found" result (done: 2026-07-01, B)
  > note: verified against mocks incl. failure states (password-protected, duplicate hash, unsupported format); real-API pass pending Person A's Phase-1 endpoints.

### ✅ Checkpoint 1 (merge to main)
- [ ] Upload a digital PDF through the UI → parsed transactions appear from the real API

---

## Phase 2 — Full Ingestion & Cleaning

### Person A
- [ ] OCR pipeline: pdf2image + OpenCV preprocessing (deskew/denoise/threshold) + PaddleOCR primary + Tesseract cross-check confidence
- [ ] DOCX parser (python-docx tables) and image/photo parser
- [ ] docling fallback for digital PDFs when balance reconciliation fails
- [ ] Per-row extraction_confidence; review-queue API (confirm/correct/exclude)
- [x] Cleaning: exact + fuzzy duplicate detection (flagged, never silently deleted) (done: 2026-07-02, A)
- [x] Cleaning: failed/reversed transaction pairing (REV/RET/REFUND/same-ref) (done: 2026-07-02, A)
- [x] Cleaning: running-balance consistency check (FD-07 flag on break) (done: 2026-07-02, A)
- [ ] Bank templates: SBI, HDFC, ICICI, Axis, Kotak, Canara, PNB, BoB
- [ ] `tools/statement-forge/`: synthetic fraud case generator — 6 formats, planted round trip, smurfing, 40% cash-out, one reversal
- [ ] Saved-template API for the column-mapping UI

### Person B
- [ ] Review queue UI: low-confidence rows + suspected duplicates, big accept/fix/exclude buttons
- [ ] Guided column-mapping UI for unrecognized layouts (drag headers → canonical fields, save as template)
- [ ] Dashboard shell: headline cards (transactions analyzed, flagged, accounts, round trips) with real cleaning stats
- [ ] Upload UX hardening: password-protected PDF error, duplicate-file (same hash) warning, unsupported-format guidance

### ✅ Checkpoint 2 (merge to main)
- [ ] All 6 statement-forge formats upload, parse, and clean end-to-end with review flow

---

## Phase 3 — Detection & Analysis

### Person A
- [ ] Flow-graph builder: nodes/edges from RRN-UTR matched pairs (confirmed) + temporal-amount matching (probable)
- [ ] Round-trip detection: time-respecting cycle search (increasing timestamps, hop bound 6, seeded sources) + loop scoring
- [ ] FIFO money-trail engine: tranche queue, partial debit attribution, stop rules, "amount still resting" edge case
- [ ] Correlation: common counterparty/UPI-ID across statements (≥2 statements or ≥3 sources)
- [ ] Disposition breakdown: % cash / cheque / redirected / merchant / unclassified, per account + case-wide + per-trail
- [ ] Detection rules FD-01…FD-08 with configurable thresholds + evidence payload per flag
- [ ] Isolation Forest anomaly scoring (trained on statement-forge synthetic data)
- [ ] Analysis APIs: graph JSON (Cytoscape format), round-trips, trail, disposition, flags

### Person B
- [ ] Cytoscape.js flow graph: node size/color encoding, solid/dashed edges, pan/zoom, PNG export
- [ ] Node drawer (account transactions + flags) and edge drawer (transfer evidence)
- [ ] "Show round trips" toggle with loop highlighting; accumulation-account badge
- [ ] Money Trail page: credit picker → FIFO trail table + Sankey diagram, stop-rule toggle
- [ ] Dashboard: disposition donut, flagged-activity timeline, common-suspicious-identifiers panel
- [ ] Plain-English flag explanations (one line per FD rule) everywhere flags appear

### ✅ Checkpoint 3 (merge to main)
- [ ] Full analysis of the statement-forge case: planted round trip detected and highlighted, trail Sankey renders, donut shows ~40% cash

---

## Phase 4 — Reports & Ship

### Person A
- [ ] Standardized extraction PDF (uniform table, all sources) — mentor requirement 3
- [ ] Investigation report PDF (WeasyPrint from Jinja2): case header, cleaning summary, flags w/ evidence, round trips, graph image, trail tables + Sankey images, disposition %, legal clause mapping, audit trail w/ hashes
- [ ] Excel export: multi-sheet workbook (Transactions, Flags, Round Trips, Trails, Accounts, Audit)
- [ ] LLM assist (feature-flagged, default off): column-mapping suggestions + report narrative, masked samples only
- [ ] API hardening: input validation, error envelopes, pagination, request logging → audit trail

### Person B
- [ ] Report page: live HTML preview → Download PDF / Download Excel / Download standardized PDF
- [ ] Golden Hour board: per-account freeze status cards + Section 94 BNSS summons modal (prefilled, officer reviews)
- [ ] Docker Compose + nginx: one-command bring-up, tested from clean clone
- [ ] Polish pass: empty states, loading states, red/amber/green consistency, large-type officer UX
- [ ] Demo script + rehearsal with statement-forge case

### ✅ Checkpoint 4 — SHIP
- [ ] End-to-end demo rehearsed: clean clone → `docker compose up` → create case → upload 6 formats → review → analyze → graph/trail/donut → download all 3 exports → hashes verified

---

## Deviations / notes

_(Record any deviation from plan.md here, with date and reason.)_

### 2026-07-02 (A) — API contract v2 after reconciling with Person B's provisional types

**@Deepthi — action needed.** I adopted your better ideas into the backend; `backend/openapi.json` is regenerated and is now the single source of truth. Backend changes (already live):
- Upload response is now your `UploadResult` shape: `{document_id, job_id, filename, sha256}`.
- `POST /cases/{id}/uploads` works as an alias of `/documents` — your client path needs no change.
- `Job` now carries `document_id`, `error_code` (`PASSWORD_PROTECTED|UNSUPPORTED_FORMAT|PARSE_FAILED`) and `transactions_found`.
- New: `POST /cases/{id}/clean` → `{transactions, balance_breaks, duplicate_pairs, reversal_pairs}` for your Phase-2 dashboard cleaning stats.

Frontend-side diffs still to reconcile in `frontend/src/api/types.ts` (your lane):
1. **Money is decimal STRING, not paise int**: `fraud_amount`, `amount_inr` ("50000.00"), `balance_after`. Transaction has `amount_inr` + `direction: "DEBIT"|"CREDIT"` — not `debit_paise`/`credit_paise`.
2. `GET /cases/{id}/transactions` returns `{items, total, offset, limit}` page — not a bare array (145k+ rows in real cases; use `offset`/`limit`, filter `needs_review=true` for the review queue).
3. `Job.progress` is **0–100**, not 0..1. `DUPLICATE_FILE` is not a job error: duplicate upload fails fast with HTTP **409** on the upload call itself.
4. Field names: `narration_raw` (not `narration`), `document_id` (not `source_document_id`), case has `complaint_date` (not `incident_date`), no `status`/counts on Case yet (counts live on `GET /cases/{id}/documents` as `txn_count`).
5. `channel` enum: `UPI|NEFT|IMPS|RTGS|ATM|CHEQUE|CASH|POS|INTERNAL|UNKNOWN` (not `OTHER`).
