# TraceNet — Final Build Plan (CIDECODE 2026, Ctrl+Z Criminals)

## Context

CIDECODE 2026 (Bangalore Cybercrime Police) submission round. Problem: automated bank statement analysis for fraud investigation. We already have a proposal PDF (TraceNet: 4-layer pipeline — Ingest → Normalize → Detect → Report). The mentors have now issued a **mandatory expectations list** that partially overlaps the proposal but adds new items. This plan merges both into one production-ready, deployable system that a non-technical police officer can operate. The repo (`~/Projects/Ctrl-Z-Criminals`) is a fresh empty git repo — greenfield build.

### Mentor's mandatory list → where each lands in this plan
| # | Mandatory requirement | Covered by |
|---|---|---|
| 1 | Round-tripping detection + account linkage | Detection Engine → cycle detection (§4.3) |
| 2 | Money flow tracking + common suspicious UPI/txn IDs | Flow graph + counterparty correlation (§4.4, §4.6) |
| 3 | All formats extracted into one standardized PDF | Standardized extraction PDF export (§4.7) |
| 4 | Money flow dashboard | Dashboard (§5.2) |
| 5 | Money trail analysis visualization (FIFO) | FIFO trail engine + Sankey/waterfall viz (§4.5, §5.3) |
| 6 | % cash withdrawal / cheque / redirected — dashboard viz | Disposition breakdown (§4.6, §5.2) |

## Product decisions (made as the "senior dev")

- **Name/branding**: keep **TraceNet**.
- **AI strategy — hybrid, offline-first**: deterministic rule-based core that works with zero internet (police data never leaves the box). An **optional, toggleable LLM assist** (Claude API) for two things only: (a) column-mapping suggestions for unrecognized statement layouts, (b) plain-language investigation narrative in the report. When toggled on, only column headers + a few masked sample rows are sent — never full account numbers or full statements. This gives the "uses AI/LLM" checkbox the mentors want without breaking the privacy story.
- **Differentiators kept**: Evidence Locker (SHA-256 + audit trail), court-structured report, Golden Hour panel (freeze board + Section 94 BNSS summons template). **Cut**: mule fingerprint cross-case DB and predictive next-hop routing (high effort, needs fabricated prior-case data to demo; mention as roadmap in the pitch instead).
- **Simplify infra vs proposal**: drop Celery + Redis. Use FastAPI `BackgroundTasks` + a `jobs` table with progress polling — OCR of a 30-page statement is the longest job (~1–2 min) and doesn't justify a distributed queue. Fewer moving parts = more reliable demo and easier police deployment.

## Research findings that shaped this plan (validated July 2026)

1. **OCR — Tesseract alone is no longer the right call.** 2026 benchmarks consistently rank PaddleOCR (PP-StructureV3) above Tesseract for financial documents with tables and complex layouts; Tesseract still wins on footprint/speed for clean scans and runs in ~10 MB. Both are fully offline/CPU-capable. → **Dual-engine OCR**: PaddleOCR PP-Structure as primary for scanned statements (it does layout + table structure recovery, not just text), Tesseract 5 as the lightweight fallback and for confidence cross-checking. When both engines agree on a cell, confidence is high; disagreement routes the row to the officer review queue — a stronger, research-backed confidence signal than single-engine Tesseract scores.
2. **Digital PDF tables — add a transformer fallback.** IBM's docling (TableFormer) hits ~93.6% table accuracy vs Camelot ~73% / Tabula ~68% on financial table benchmarks; pdfplumber remains best for deterministic, debuggable extraction when the layout is known. → **pdfplumber primary** (fast, explainable, per-bank templates), **docling as the automatic fallback** when pdfplumber's table detection yields malformed rows (failed balance reconciliation is the trigger). Fully offline — docling models run locally.
3. **Round-trip detection — plain cycle detection is provably wrong; use temporal cycles.** AML literature (2SCENT, VLDB'18; temporal network analytics for banking fraud) is explicit that static `simple_cycles` produces false positives because it ignores edge ordering: money must flow around the loop in time order. → Implement a **bounded time-respecting cycle search** (DFS with strictly increasing edge timestamps, hop bound 6, seeded per 2SCENT's source-filtering idea) on top of the NetworkX graph, instead of raw `networkx.simple_cycles`. This is both more correct and a defensible "we read the research" talking point.
4. **Cross-statement matching key confirmed.** For UPI, the 12-digit RRN printed in one bank's statement **is the same number** as the "UTR" shown in the counterparty bank's statement — this is the network-level key, so RRN/UTR matching across statements is reliable. NEFT UTRs are ~16 chars, RTGS ~22 chars, IMPS RRN 12 digits. → `reference.py` gets per-channel regex + format validation (a 12-digit match in a UPI narration is an RRN; a 16-char alphanumeric in a NEFT narration is a UTR), which cuts false joins from random 12-digit numbers.
5. **Competitive gap re-verified.** Precisa/ProAnalyser/DocuClipper (2026) now advertise circular-transaction and mule-pattern detection, but all remain lender/fintech SaaS — cloud-hosted, no evidence chain, no court-report output, no on-prem police deployment. Our positioning (offline, evidence-locker, court-ready, officer UX) still holds; say this explicitly in the pitch.

Sources: [CodeSOTA OCR benchmarks](https://www.codesota.com/ocr/best-for-python), [PaddleOCR vs Tesseract](https://www.codesota.com/ocr/paddleocr-vs-tesseract), [Unstract PDF table guide](https://unstract.com/blog/extract-tables-from-pdf-python/), [docling/TableFormer comparison](https://pdfexcel.ai/resources/pdf-table-extraction-python-libraries-comparison/), [2SCENT temporal cycles (VLDB)](https://rohit13k.github.io/doc/2SCENT_full.pdf), [Temporal network analytics for banking fraud](https://link.springer.com/chapter/10.1007/978-3-030-55814-7_12), [UTR/RRN formats](https://www.winvesta.in/blog/businesses/understanding-utr-numbers-formats-for-neft-rtgs-and-upi), [RRN in UPI](https://www.xflowpay.com/blog/rrn-retrieval-reference-number), [Precisa fraud detection](https://precisa.in/bank-statement-fraud-detection/).

## Tech stack (final)

| Layer | Choice | Why |
|---|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Pydantic v2 | Team knows it; typed schemas match the canonical model |
| DB | PostgreSQL 16 (SQLite fallback via SQLAlchemy for zero-setup dev) | JSONB for flags/audit; production-grade |
| PDF parsing | pdfplumber primary + docling (TableFormer) automatic fallback | Deterministic first; 93.6%-accuracy transformer fallback for hard layouts (see Research §2) |
| OCR | PaddleOCR PP-StructureV3 primary + Tesseract 5 cross-check; OpenCV preprocessing (deskew, adaptive threshold, denoise); `pdf2image` | Dual-engine agreement = confidence signal; fully offline (see Research §1) |
| Excel/CSV | pandas + openpyxl; `csv.Sniffer` for dialect | Handles both |
| DOCX | python-docx (tables) with text fallback | Mentor requirement |
| Graph engine | NetworkX + custom time-respecting cycle search (2SCENT-style) | Static cycles give false positives; temporal ordering required (see Research §3) |
| ML anomaly | scikit-learn Isolation Forest (local) | From proposal; cheap, offline |
| LLM assist | Anthropic SDK, `claude-sonnet-5`, feature-flagged off by default | Hybrid strategy above |
| Frontend | React 18 + TypeScript + Vite, Tailwind CSS | Fast to build, modern look |
| Graph viz | Cytoscape.js (not raw D3) | Interactive network graph with far less custom code; built-in layouts, pan/zoom, node click |
| Charts | Recharts (donut for disposition %, timeline, Sankey via `recharts`/`d3-sankey` for trail) | |
| Report PDF | WeasyPrint (HTML→PDF: same templates render report preview in UI and final PDF) | One template, two outputs |
| Excel export | openpyxl | |
| Deploy | Docker Compose (nginx + api + postgres), one command, no internet needed | Police on-prem story |

## Architecture & repo layout

```
Ctrl-Z-Criminals/
├── docker-compose.yml
├── backend/
│   ├── app/
│   │   ├── main.py, config.py, db.py
│   │   ├── models/          # SQLAlchemy: Case, Document, Transaction, Account, Flag, Job, AuditLog
│   │   ├── ingest/          # detector.py (file-type sniff), pdf_digital.py, pdf_scanned.py,
│   │   │                    # excel.py, csvfile.py, docx.py, image.py, ocr_preprocess.py
│   │   ├── normalize/       # schema.py (canonical txn), dates.py, amounts.py (Indian 1,00,000 & Cr/Dr),
│   │   │                    # channel.py (UPI/NEFT/IMPS/RTGS/ATM/CHEQUE/CASH), reference.py (UTR/UPI-ref regex),
│   │   │                    # counterparty.py, bank_templates/ (per-bank column maps: SBI, HDFC, ICICI, Axis, Kotak, Canara, PNB, BoB)
│   │   ├── cleaning/        # dedup.py, failed_txn.py, balance_check.py, missing_data.py
│   │   ├── detection/       # rules.py (FD-01..FD-08), anomaly.py (IsolationForest),
│   │   │                    # roundtrip.py (cycles), flowgraph.py, fifo_trail.py, correlation.py (common UPI/counterparty)
│   │   ├── reporting/       # report_html/ (Jinja2), pdf.py (WeasyPrint), excel.py, standardized_pdf.py
│   │   ├── llm/             # column_mapper.py, narrative.py (both behind settings.LLM_ENABLED)
│   │   └── api/             # routers: cases, uploads, jobs, transactions, analysis, graph, trail, reports
│   └── tests/               # pytest per module + synthetic-statement fixtures
├── frontend/
│   └── src/
│       ├── pages/           # Cases, CaseWizard (Upload→Review→Analyze), Dashboard, FlowGraph, MoneyTrail, Report
│       ├── components/      # UploadDropzone, ReviewTable, FlagBadge, FreezeBoard, SummonsModal, charts/
│       └── api/             # typed client
└── tools/statement-forge/   # synthetic bank-statement generator for demo & tests (see §7)
```

## 4. Backend engine — key algorithms

### 4.1 Ingest & parse
- File-type detection by magic bytes + extension; digital-vs-scanned PDF decided by text-layer density per page (mixed PDFs handled page-by-page).
- Every upload: SHA-256 immediately → Evidence Locker record (document, officer, timestamp, hash, parser version).
- Header block extraction (account holder, acct no, IFSC, bank, period, opening/closing balance) → case metadata; used later for balance validation.
- Per-row `extraction_confidence` (1.0 for digital, Tesseract confidence for OCR). Rows < 0.70 go to the **officer review queue** in the UI (confirm/correct/exclude) before analysis.
- Unrecognized layout → guided column-mapping UI (drag headers onto canonical fields); mapping saved as a reusable bank template. LLM assist (if enabled) pre-fills the suggested mapping.

### 4.2 Cleaning & validation (mentor req. 2)
- **Duplicates**: exact key (date, amount, direction, reference_id) plus fuzzy pass (same date+amount+direction, narration similarity ≥ 0.9) — flagged, officer confirms removal; never silently deleted (audit trail).
- **Failed/reversed transactions**: debit followed by credit of identical amount within N days with reversal markers in narration (`REV`, `RET`, `FAILED`, `REFUND`, same UTR) → paired and marked `REVERSED`, excluded from flow analysis but kept visible.
- **Balance consistency**: running check `prev_balance ± amount == balance_after` (tolerance ₹0.01); breaks flagged FD-07 (possible tampering or missed rows) with the exact row highlighted.
- **Missing data**: null dates interpolated only when unambiguous (between two same-date rows); otherwise held for review. Amount-in-single-column-with-sign and Dr/Cr-suffix formats normalized in `amounts.py`.

### 4.3 Round-trip detection (mentor req. 1) — the headline feature
1. Build directed multigraph: nodes = normalized account identifiers (own accounts from headers + counterparties from narrations/reference matching), edges = transfers (amount, date, reference, channel).
2. Cross-statement edge linking: same reference debit↔credit pair = **confirmed** edge — for UPI the 12-digit RRN in one statement equals the "UTR" in the counterparty statement (network-level key, Research §4); per-channel format validation (12-digit RRN for UPI/IMPS, ~16-char NEFT UTR, ~22-char RTGS UTR) prevents false joins on random digit runs. Else temporal-amount matching (credit of amount M within 30 min of debit M, fee tolerance up to 2%) = **probable** edge.
3. **Time-respecting cycle search** (custom DFS, 2SCENT-inspired): edges along a candidate loop must have strictly increasing timestamps; hop bound 6; candidate sources seeded from accounts with both large inflow and outflow (source filtering keeps it fast). A time-ordered cycle where money returns to the origin (or an account sharing counterparty identity/VPA with the origin) = **round trip**. Static cycles that fail the time ordering are reported separately as "linked cluster, not a confirmed round trip" — correctness the judges can probe.
4. Score each loop: total amount, loop length, elapsed time, % returned. Output: loop list + member accounts + the loop highlighted in the flow graph.

### 4.4 Money flow graph (mentor req. 2, 4)
- Aggregated account-level graph: node size = total throughput, color = suspicion score (red/amber/grey), edge width = total amount, dashed = probable.
- **Accumulation detection**: node with high in-degree/inflow and low outflow = "destination account where funds accumulate" — auto-highlighted with a badge.
- **Common counterparty detection** (mentor's "common UPI id that feels suspicious"): any VPA/account appearing across ≥ 2 uploaded statements, or receiving from ≥ 3 distinct sources, surfaces in a "Common Suspicious Identifiers" panel with occurrence counts.

### 4.5 FIFO money trail (mentor req. 5) — new vs proposal, spec carefully
For a selected credit (or automatically for every flagged credit):
1. Snapshot `pre_credit_balance` just before the credit lands.
2. Maintain a FIFO queue of credit "tranches". Each subsequent debit consumes tranches oldest-first; a debit can split across tranches (record partial attribution: debit X = ₹a from tranche 1 + ₹b from tranche 2).
3. The trail for the selected credit = ordered list of debits (with attributed portions) until the tranche is exhausted **or** balance returns to `pre_credit_balance` — whichever the officer selects as the stop rule (default: tranche exhaustion, which is the strict FIFO reading).
4. Edge cases: credit never fully spent within statement period → report "₹X of ₹Y still resting in account at period end"; interleaved credits → FIFO ordering by (date, statement row order); reversed transactions excluded.
5. Output per trail: table (debit date, narration, channel, counterparty, attributed amount) + **Sankey diagram** (credit on left → spending categories/counterparties on right).

### 4.6 Disposition breakdown (mentor req. 6)
From channel classification, per account and case-wide: **% cash withdrawn (ATM/CASH)**, **% cheque withdrawals**, **% redirected to other accounts (UPI/NEFT/IMPS/RTGS to counterparties)**, % merchant/POS, % unclassified. Donut chart + absolute amounts on the dashboard; also computed per-trail ("of this ₹5,00,000 credit: 42% withdrawn as cash, 51% forwarded to 3 accounts").

### 4.7 Detection rules & scoring
Keep proposal's FD-01…FD-08 (round figures, rapid in-out, odd-hour, smurfing below ₹50k, velocity spike, new-account spike, balance arithmetic fail, single-counterparty dominance) + Isolation Forest anomaly score. **Evidence gate** stays: ≥ 2 independent signals for High Confidence; every flag stores the rule inputs that fired (no black boxes).

### 4.8 Reporting & export (mentor req. 3, 6)
- **Standardized extraction PDF**: all statements, whatever the input format, re-rendered as one uniform table (Date | Narration | Ref/Txn ID | Debit | Credit | Balance | Channel | Source doc) — this is the mentor's item 3, distinct from the investigation report.
- **Investigation report PDF** (WeasyPrint from the same Jinja2 templates the UI previews): case header, account summary, cleaning summary (duplicates/failed txns removed), flagged transactions with rule evidence, round-trip loops, flow-graph image (Cytoscape PNG export embedded), FIFO trail tables + Sankey images, disposition percentages, legal clause mapping (IT Act 66C/66D, BNS 318), audit trail with SHA-256 hashes.
- **Excel export**: multi-sheet workbook (Normalized Transactions, Flags, Round Trips, Trails, Accounts, Audit Log).

## 5. Frontend — designed for a non-technical officer

Guiding principle: **a wizard, not a tool**. No jargon on primary screens; every flag has a one-line plain-English explanation.

1. **Cases list** → big "New Case" button (FIR no., complainant, fraud amount).
2. **Case wizard**: Step 1 drag-drop upload (any mix of PDF/XLSX/CSV/DOCX/images, live per-file progress + "142 transactions found") → Step 2 review queue (low-confidence rows, suspected duplicates — accept/fix with big buttons) → Step 3 "Analyze" (one button runs everything).
3. **Dashboard** (§5.2): headline cards (total analyzed, flagged count, round trips found, accounts involved), disposition donut, timeline of flagged activity, common-suspicious-identifiers panel, Golden Hour freeze board (per-account status: Frozen/Pending/Not contacted + one-click Section 94 BNSS summons DOCX/PDF prefilled for officer review).
4. **Flow Graph page** (§5.3): Cytoscape network, click node → account drawer (transactions, flags), click edge → transfer evidence, "Show round trips" toggle animates/highlights loops, PNG export for court exhibit.
5. **Money Trail page**: pick any credit → FIFO trail table + Sankey, stop-rule toggle, export.
6. **Report page**: live HTML preview → Download PDF / Download Excel.
- Visual language: large type, green/amber/red only, icons + labels, empty-state guidance on every page. (Stretch: Kannada label toggle — cheap i18n win for these judges.)

## 6. Two-person work split

**Person A — Data & Detection (backend-heavy)**
- P1: repo scaffold, DB models, canonical schema, digital-PDF/Excel/CSV parsers, normalization (dates/amounts/channel/reference)
- P2: OCR pipeline, DOCX/image parsers, cleaning suite (dedup, failed-txn, balance validation), bank templates, statement-forge test-data generator
- P3: flow-graph builder, round-trip cycle detection, FIFO trail engine, correlation (common IDs), FD rules + Isolation Forest
- P4: report/Excel/standardized-PDF generation, LLM assist endpoints, API hardening

**Person B — Product & Visualization (frontend-heavy)**
- P1: Vite+React+Tailwind scaffold, typed API client, Cases + wizard + upload with job polling
- P2: review-queue UI, column-mapping UI, dashboard shell with real cleaning stats
- P3: Cytoscape flow graph + drawers + round-trip highlighting, Sankey trail page, disposition donut + charts
- P4: report preview/download flow, Golden Hour board + summons modal, polish pass, Docker Compose + nginx, demo script

Contract-first: Person A publishes Pydantic/OpenAPI schemas at the end of P1; Person B codes against generated types + a fixtures mock until real endpoints land. Integration checkpoints at the end of every phase.

## 7. Demo data & edge cases (build these in, don't discover them on stage)

`tools/statement-forge/` generates a coherent synthetic fraud case: 1 victim + 8 mule accounts across 4 "banks", each exported in a different format (HDFC-style digital PDF, SBI-style scanned PDF at 200 DPI, Excel, CSV, DOCX, one photographed JPEG) with a planted round-trip loop, smurfing pattern, 40% cash-out, and one reversed transaction. Same dataset drives pytest fixtures and the live demo.

Edge cases to handle explicitly (test each): Indian digit grouping (1,00,000.50), Dr/Cr suffix vs separate columns vs signed single column, DD-MM vs MM-DD ambiguity (resolve via header period + monotonic dates), multi-line narrations, repeated page headers in PDFs, password-protected PDF (clear error + prompt), same statement uploaded twice (hash-level dedup), same account appearing in two uploads (merge by account no.), transfers with fees (amount tolerance), FIFO when balance never returns to pre-credit level, cycles longer than 6 hops (bounded + reported as "deep layering"), OCR misreads of ₹ symbol and 0/O.

## 8. Verification

- `pytest` suites per module; golden tests: each statement-forge format must normalize to the identical canonical transaction set.
- Balance-check property: for every parsed statement, running balance reconciles or FD-07 fires — never silent.
- End-to-end: `docker compose up` → create case → upload all 6 demo formats → review queue → analyze → confirm round-trip loop detected, trail Sankey renders, disposition donut shows planted 40% cash → download standardized PDF, investigation PDF, Excel → verify SHA-256 in report matches uploaded files.
- Frontend: manual walkthrough of the wizard as a "non-tech officer" (no console errors, every action ≤ 2 clicks from dashboard).

## 9. Pitch framing (for submission write-up)

Lead with mentor's list 1–6 as a checklist demo; then differentiators: Evidence Locker/admissibility, Golden Hour + Section 94 summons, offline-first privacy with optional LLM assist, one-command on-prem deployment. Position fingerprint DB + predictive routing as the deployed roadmap with Bangalore CEN stations.
