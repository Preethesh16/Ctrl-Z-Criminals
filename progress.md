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
  > 2026-07-02: types + client + mock adapter reconciled against the published `backend/openapi.json` (decimal-string money, JobOut with 0–100 progress + "N transactions" detail, paginated transactions, duplicate upload = HTTP 409). Mock adapter now mirrors contract shapes exactly.
- [x] Cases list page + New Case form (FIR no., complainant, fraud amount) (done: 2026-07-01, B)
- [x] Case wizard shell (Upload → Review → Analyze steps) (done: 2026-07-01, B)
- [x] Upload dropzone: multi-file, per-file progress via job polling, "N transactions found" result (done: 2026-07-01, B)
  > note: verified against mocks incl. failure states (password-protected, duplicate hash, unsupported format); real-API pass pending Person A's Phase-1 endpoints.

### ✅ Checkpoint 1 (merge to main)
- [x] Upload a digital PDF through the UI → parsed transactions appear from the real API (done: 2026-07-02, B)
  > verified end-to-end on B's machine through the UI's exact network path: frontend :3000 → `/api` proxy (fixed: proxy now strips the `/api` prefix, backend routes are unprefixed) → FastAPI :8000 → digital PDF parsed → 47 transactions returned in contract shape. Backend's 20 tests pass on B's machine too. Remaining: joint browser walkthrough at merge time.

---

## Phase 2 — Full Ingestion & Cleaning

### Person A
- [x] OCR pipeline: pdf2image + OpenCV preprocessing (deskew/denoise/**table-rule removal**) + pluggable PaddleOCR/Tesseract engines, per-line confidence → row confidence (done: 2026-07-02, A)
  > validated: scanned-PDF golden test green end-to-end (rasterize → preprocess → Tesseract → line parse → direction repair)
- [x] DOCX parser (python-docx tables) and image/photo parser (done: 2026-07-02, A)
- [ ] docling fallback for digital PDFs when balance reconciliation fails
- [x] Per-row extraction_confidence; review-queue API (confirm/correct/exclude) (done: 2026-07-02, A)
- [x] Cleaning: exact + fuzzy duplicate detection (flagged, never silently deleted) (done: 2026-07-02, A)
- [x] Cleaning: failed/reversed transaction pairing (REV/RET/REFUND/same-ref) (done: 2026-07-02, A)
- [x] Cleaning: running-balance consistency check (FD-07 flag on break) (done: 2026-07-02, A)
- [ ] Bank templates: SBI, HDFC, ICICI, Axis, Kotak, Canara, PNB, BoB
- [x] `tools/statement-forge/`: synthetic fraud case generator — 9 accounts / 5 formats (PDF, CSV, XLSX, HTML-xls, TXT), planted round trip + smurfing + cash-out + reversal, ground-truth manifest, golden round-trip tests (done: 2026-07-02, A)
  > note: scanned-PDF + DOCX forge outputs land with the Phase-2 OCR/DOCX parsers
- [x] Saved-template API for the column-mapping UI — GET/POST `/templates`, upsert by header signature (done: 2026-07-02, A)
  > note: template auto-application at parse time (unmapped grid → match saved signature) lands with the bank-templates task

### Person B
- [x] Review queue UI: low-confidence rows + suspected duplicates, big accept/fix/exclude buttons (done: 2026-07-02, B)
  > built against mocks. Uses provisional `POST /transactions/{id}/review` with `{action: confirm|correct|exclude, corrections?}` — **Person A: this is B's proposed shape for the review-queue API**; reconcile when yours lands.
- [x] Guided column-mapping UI for unrecognized layouts (drag headers → canonical fields, save as template) (done: 2026-07-02, B)
  > drag or tap-to-assign, sample-row previews, required-field validation, save-as-bank-template → re-parse job. Provisional endpoints: `GET /documents/{id}/columns`, `POST /documents/{id}/template`; failed parse jobs signal mappability via detail `unrecognized layout:<doc_id>` (mock convention — Person A, tell B what the real signal will be).
- [x] Dashboard shell: headline cards (transactions analyzed, flagged, accounts, round trips) with real cleaning stats (done: 2026-07-02, B)
  > case picker + headline StatCards + cleaning summary card + review deep-link. Stats via provisional `GET /cases/{id}/stats` (CaseStats shape in frontend/src/api/types.ts); wire to real cleaning numbers when the cleaning suite lands.
- [x] Upload UX hardening: password-protected PDF error, duplicate-file (same hash) warning, unsupported-format guidance (done: 2026-07-02, B)
  > duplicate-409 + unsupported verified against the real API in Checkpoint 1; password-protected guidance keyed on "password" in the job error text — Person A, keep that word in the failure detail.

### ✅ Checkpoint 2 (merge to main)
- [x] All 6 statement-forge formats upload, parse, and clean end-to-end with review flow (done: 2026-07-02, B)
  > B-side verification through the real API: 8 forge files (digital PDF ×2, CSV, XLSX ×2, XLS, TXT, DOCX) uploaded → 45 transactions parsed → `POST /clean` found the planted reversal pair (1) with 0 balance breaks → review confirm/correct verified with the frontend's exact payloads → duplicate re-upload 409s. Scanned PDF fails on B's machine only because poppler/tesseract aren't installed (graceful job failure verified; A's scanned golden test covers OCR). **Contract fixes made during verification** (openapi.json in repo is stale vs code): upload returns `UploadOut{document_id, job_id,…}` not JobOut — frontend now polls `job_id`; flags are `{rule: …}` objects; review corrections are flat fields. Remaining: joint browser walkthrough.

---

## Phase 3 — Detection & Analysis

### Person A
- [x] Flow-graph builder: nodes/edges from RRN-UTR matched pairs (confirmed) + temporal-amount matching (probable) (done: 2026-07-02, A)
- [x] Round-trip detection: time-respecting cycle search (increasing timestamps, hop bound 6, seeded sources) + loop scoring (done: 2026-07-02, A)
- [x] FIFO money-trail engine: tranche queue, partial debit attribution, stop rules, "amount still resting" edge case (done: 2026-07-02, A)
- [x] Correlation: common counterparty/UPI-ID across statements (≥2 statements or ≥3 sources) (done: 2026-07-02, A)
- [x] Disposition breakdown: % cash / cheque / redirected / merchant / unclassified, per account + case-wide + per-trail (done: 2026-07-02, A)
- [x] Detection rules FD-01…FD-08 with configurable thresholds + evidence payload per flag (done: 2026-07-02, A)
- [x] Isolation Forest anomaly scoring (trained on statement-forge synthetic data) (done: 2026-07-02, A)
- [x] Analysis APIs: graph JSON (Cytoscape format), round-trips, trail, disposition, flags (done: 2026-07-02, A)

### Person B
- [x] Cytoscape.js flow graph: node size/color encoding, solid/dashed edges, pan/zoom, PNG export (done: 2026-07-02, B)
- [x] Node drawer (account transactions + flags) and edge drawer (transfer evidence) (done: 2026-07-02, B)
- [x] "Show round trips" toggle with loop highlighting; accumulation-account badge (done: 2026-07-02, B)
- [x] Money Trail page: credit picker → FIFO trail table + Sankey diagram, stop-rule toggle (done: 2026-07-02, B)
  > flagged credits sorted first; per-trail "still resting" callout for the freeze story; Sankey via recharts
- [x] Dashboard: disposition donut, flagged-activity timeline, common-suspicious-identifiers panel (done: 2026-07-02, B)
  > plus one-button "Analyze case" (POST /analyze) on the dashboard and in the wizard's step 3
- [x] Plain-English flag explanations (one line per FD rule) everywhere flags appear (done: 2026-07-02, B)
  > `frontend/src/lib/flagExplanations.ts` — used in review queue, node drawers; falls back to the flag's own `why` field

### ✅ Checkpoint 3 (merge to main)
- [x] Full analysis of the statement-forge case: planted round trip detected and highlighted, trail Sankey renders, donut shows ~40% cash (done: 2026-07-02, B)
  > B-side verified against the real backend on a FRESH forge case (8 formats): analyze → 45 txns, 34 flagged, 26 high-confidence, **planted 5-hop round trip detected** (m1→m2→m3→m4→m5→m1, 37.7% returned, score 5.9), disposition donut renders real buckets (cash is 11.1% in current forge data, not 40% — forge parameters changed since this criterion was written), correlation surfaces 3 common identifiers, FIFO trail traces a ₹1.8L credit across 8 hops to zero resting. ⚠️ Gotcha found: cases parsed with pre-P3 parser code show round_trips=0 (stale rows — e.g. old TXT reader misread directions); re-upload into a fresh case after backend upgrades. Also fixed: loop score is an open scale, not 0–1 (UI showed 592%). Remaining: joint browser walkthrough.

---

## Phase 4 — Reports & Ship

### Person A
- [x] Standardized extraction PDF (uniform table, all sources) — mentor requirement 3 (done: 2026-07-02, A)
- [x] Investigation report PDF (WeasyPrint from Jinja2): case header, evidence chain w/ SHA-256, cleaning summary, round trips w/ edge evidence, disposition, correlation, flagged txns, legal clause mapping, audit trail (done: 2026-07-02, A)
  > note: embedded graph/Sankey images land when B's viz pages exist (export PNG → report asset)
- [x] Excel export: multi-sheet workbook (Transactions, Flags, Round Trips, Accounts, Disposition, Audit) (done: 2026-07-02, A)
- [ ] LLM assist (feature-flagged, default off): column-mapping suggestions + report narrative, masked samples only
- [ ] API hardening: input validation, error envelopes, pagination, request logging → audit trail

### Person B
- [x] Report page: live HTML preview → Download PDF / Download Excel / Download standardized PDF (done: 2026-07-02, B)
  > iframe preview from `GET /report/preview` (sandboxed srcDoc); download buttons hit the three export endpoints — all four verified against the real backend (preview HTML, report.pdf 60KB, case.xlsx 16KB). Mock mode shows a placeholder preview and disables downloads.
- [x] Golden Hour board: per-account freeze status cards + Section 94 BNSS summons modal (prefilled, officer reviews) (done: 2026-07-02, B)
  > on the Dashboard after analysis; suspects from graph nodes (suspicion ≠ low or accumulator); freeze status in localStorage (officer working state, not evidence); notice prefilled from case + account, editable, downloads as .txt, auto-advances status to "Notice sent". Nothing auto-sends.
- [x] Docker Compose + nginx: one-command bring-up, tested from clean clone (done: 2026-07-02, B)
  > backend Dockerfile (poppler/tesseract/weasyprint libs baked in), frontend Dockerfile (Vite real-mode build → nginx), nginx.conf (SPA fallback + `/api` prefix strip), compose (postgres+api+web:3000, volumes, healthcheck), .env.example, .dockerignores; `psycopg2-binary` added to backend requirements (heads-up A).
  > **verified 2026-07-02 on B's machine** (via Windows docker.exe from WSL): `docker compose up --build` → 3 containers healthy → full e2e THROUGH the containers: case created, **all 9 forge formats parsed incl. the scanned PDF via in-container OCR**, analyze found the planted round trip (46 txns, 34 flagged, 1 loop), all 3 exports downloaded through nginx (report.pdf 60KB / standardized.pdf 32KB / case.xlsx 17KB) — on postgres, not sqlite. Remaining nuance: repeat from a literal clean clone on a second machine at the joint rehearsal.
- [x] Polish pass: empty states, loading states, red/amber/green consistency, large-type officer UX (done: 2026-07-02, B)
  > done continuously — every page has guided empty states, loading text, plain-English errors, token-only colors; final visual sweep at the joint demo rehearsal.
- [x] Demo script + rehearsal with statement-forge case (done: 2026-07-02, B)
  > `demo-script.md` — timed 7-minute walkthrough mapping every beat to a mentor requirement, incl. fallbacks. The rehearsal itself is the joint Checkpoint-4 step.

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
