# TraceNet Progress Tracker

> Rules (from CLAUDE.md): tick the box **immediately** when a task is done and append `(done: YYYY-MM-DD, A|B)`. If blocked, add `> blocked: <reason>` under the task and switch to your branch + mocks — never wait for the other lane. Commit this file together with the work it describes.

**Branches**: `person-a/<phase>-<feature>`, `person-b/<phase>-<feature>`. Merge to `main` only at phase checkpoints.

---

## Phase 1 — Foundation

### Person A
- [ ] Repo scaffold: backend project, requirements.txt, config, SQLAlchemy setup (Postgres + SQLite fallback)
- [ ] DB models: Case, Document, Transaction, Account, Flag, Job, AuditLog
- [ ] Canonical transaction schema (Pydantic) per plan.md §4.1 proposal schema
- [ ] Digital PDF parser (pdfplumber) with header-block extraction
- [ ] Excel (XLSX/XLS) parser with header-row auto-detection
- [ ] CSV/TSV parser with dialect sniffing
- [ ] Normalization: dates (all Indian formats), amounts (1,00,000 / Dr-Cr / signed column), channel classifier, reference-ID extraction (RRN/UTR per-channel regex)
- [ ] SHA-256 on upload + Evidence Locker records
- [ ] API: cases, upload, job status, transactions list — **publish OpenAPI contract for Person B**

### Person B
- [ ] Frontend scaffold: Vite + React 18 + TS + Tailwind
- [ ] Typed API client generated from OpenAPI contract + mock fixtures fallback
- [ ] Cases list page + New Case form (FIR no., complainant, fraud amount)
- [ ] Case wizard shell (Upload → Review → Analyze steps)
- [ ] Upload dropzone: multi-file, per-file progress via job polling, "N transactions found" result

### ✅ Checkpoint 1 (merge to main)
- [ ] Upload a digital PDF through the UI → parsed transactions appear from the real API

---

## Phase 2 — Full Ingestion & Cleaning

### Person A
- [ ] OCR pipeline: pdf2image + OpenCV preprocessing (deskew/denoise/threshold) + PaddleOCR primary + Tesseract cross-check confidence
- [ ] DOCX parser (python-docx tables) and image/photo parser
- [ ] docling fallback for digital PDFs when balance reconciliation fails
- [ ] Per-row extraction_confidence; review-queue API (confirm/correct/exclude)
- [ ] Cleaning: exact + fuzzy duplicate detection (flagged, never silently deleted)
- [ ] Cleaning: failed/reversed transaction pairing (REV/RET/REFUND/same-ref)
- [ ] Cleaning: running-balance consistency check (FD-07 flag on break)
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
