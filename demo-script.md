# TraceNet — 7-minute demo script (CIDECODE 2026)

> Rehearse twice with both members. Uses ONLY synthetic statement-forge data.
> Presenter A drives, Presenter B narrates.
>
> **Setup (before the audience arrives):**
> 1. `docker compose up --build` → app on http://localhost:3000
> 2. Generate the demo files (they are NOT in git). No host dependencies needed —
>    use the api image, which has poppler/tesseract baked in:
>    `docker run --rm -v "<repo>/tools:/tools" ctrl-z-criminals-api python /tools/statement-forge/forge.py /tools/statement-forge/out`
>    (Host alternative if poppler+tesseract are installed:
>    `backend/.venv/bin/python tools/statement-forge/forge.py tools/statement-forge/out`)
> 3. Create NOTHING in the app in advance except having it open on Cases.
> 4. Keep `LLM_ENABLED=false` (default) — the demo story is offline-first.

## 0:00 — The problem (30s, no screen)

"A victim loses ₹9 lakh. The money hops through 8 mule accounts across 4 banks
in 3 hours. The investigating officer gets 9 statements in 9 different formats
and has days of manual Excel work — while the money is still moving. TraceNet
turns that into minutes, fully offline, on the station's own machine."

## 0:30 — Create the case (30s)

- Cases → **+ New Case** → FIR `CEN/0042/2026`, complainant, ₹9,00,000 loss.
- Say: "Only the FIR number is mandatory — an officer can start in 10 seconds."

## 1:00 — Upload all 9 formats at once (90s) ← mentor req 1

- Drag ALL files from `tools/statement-forge/out/` (digital PDF, scanned PDF,
  CSV, XLSX, legacy XLS, TXT, DOCX) into the dropzone in one gesture.
- Narrate while progress bars run: "Magic-byte detection — that .xls is secretly
  XLSX and we catch it. The scanned PDF goes through the OCR pipeline. Every file
  gets a SHA-256 into the evidence locker the moment it lands."
- Point at the green chips: "…and each one tells the officer exactly how many
  transactions were read."
- Optional 15s flex: re-drop one file → duplicate warning; drop a
  `*password*.pdf` → plain-English guidance.

## 2:30 — Review queue (45s) ← mentor req: cleaning

- Step 2 → "The system read 45 rows; the few it wasn't sure about are here.
  Big buttons: Correct / Fix / Exclude. The officer reviews 3 rows, not 3,000."
- Fix one row inline (date/amount/money-in-out). "Every decision is audit-logged."

## 3:15 — ONE BUTTON: Analyze (30s)

- Step 3 → **Analyze case**. While it runs (seconds):
  "Cleaning → 8 forensic rules → machine-learning anomaly scoring → cross-bank
  reference matching → time-respecting round-trip search. The research point:
  we don't use naive cycle detection — money must move around the loop in time
  order, which kills the false positives naive tools produce."

## 3:45 — The reveal: Flow Graph (90s) ← mentor reqs 1, 2, 4

- "See the money flow" → the network renders. "Node size = money volume,
  red = suspicious, dashed = probable link pending counterparty statement."
- Click **Show round trips** → loop lights up, everything else dims.
  Read the loop card aloud: "₹1.5 lakh out, ₹56,500 back to the same account
  in hours — a laundering loop, detected automatically."
- Click a node → drawer: "…and why: each flag in plain English." Click an edge:
  "Confirmed — the same UTR appears in BOTH banks' statements."
- **Export PNG**: "straight into the court file."

## 5:15 — Money Trail (60s) ← mentor req 5

- Money Trail → top flagged credit → "Strict FIFO: this exact ₹1.8 lakh,
  debit by debit, until it's gone." Point at Sankey.
- Toggle the stop rule. If money is resting: "₹X is STILL in the account —
  freeze today and it comes back to the victim."

## 6:15 — Dashboard + Golden Hour (45s) ← mentor req 6

- Dashboard: donut ("how much cash-out vs redirected — the SP's first
  question"), common suspicious identifiers ("this UPI ID appears in 3
  different victims' statements").
- Golden Hour board: mark an account frozen; open the **Section 94 BNSS
  notice** — prefilled, officer edits, downloads. "Nothing auto-sends."

## 7:00 — Reports + close (30s) ← mentor req 3, 6

- Reports → live preview → download all three: Investigation PDF,
  **Standardized extraction PDF** ("every format, one uniform table — mentor
  requirement 3"), Excel workbook.
- Close: "Offline. Evidence-chain intact — hashes in the report match the
  uploads. One `docker compose up` to deploy at any police station. And the
  parsers are validated on 162 real statements at 93% — not just our demo data."

## Fallbacks

- If OCR is slow live: the scanned file was pre-uploaded in a second case.
- If a question probes round trips: show the loop card's timestamps — strictly
  increasing (the 2SCENT talking point).
- If asked about AI: rules+ML run locally; the optional LLM assist is off by
  default and never sees full statements.
