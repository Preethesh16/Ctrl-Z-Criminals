# Person B — Product & Visualization (frontend lane)

Scope: `frontend/**`, `docker-compose.yml`, nginx config, demo script. Read plan.md first; tick progress.md as you go. Branch: `person-b/p<phase>-<feature>`. If Person A's API is late: code against the committed OpenAPI contract with mocks in `frontend/src/api/mocks/` — do not wait.

Design north star: **a wizard, not a tool.** Non-technical police officers. Large type, plain English, red/amber/green only, every action ≤2 clicks from the dashboard.

> ⚠️ **Confidential data**: `Bank-statements-dataset/` (real police data) is local-only and git-ignored — NEVER push it, never screenshot it in demo material or PRs. UI demos use synthetic statement-forge data only. Full rules in CLAUDE.md.

## Phase 1 — Foundation

1. **Scaffold**: ✅ already done — Vite + React 18 + TS + Tailwind v4 + framer-motion with the full design-token theme (`src/styles/theme.css`), motion presets (`src/theme/motion.ts`), and UI primitives (`src/components/ui/`). Read the "Design system" and "Motion" rules in CLAUDE.md before writing any component. Remaining: router + replace the showcase `App.tsx` with the real layout shell.
2. **API layer**: typed client generated from Person A's OpenAPI JSON; mock adapter with fixture data for offline dev.
3. **Cases page**: list + big "New Case" button → form (FIR no., complainant, fraud amount, date).
4. **Case wizard shell**: stepper Upload → Review → Analyze.
5. **Upload step**: drag-drop multi-file dropzone (PDF/XLSX/CSV/DOCX/JPG/PNG), per-file job-polling progress, result chip "142 transactions found", clear failure states.

Acceptance: wizard works end-to-end against mocks and against the real Phase-1 API.

## Phase 2 — Review & Dashboard shell

1. **Review queue**: low-confidence rows and suspected duplicates as cards/table; big Accept / Fix (inline edit) / Exclude buttons; progress indicator ("12 rows need your review").
2. **Column-mapping UI**: raw extracted columns on the left, canonical fields on the right, drag to map, sample-row preview, "Save as template for this bank".
3. **Dashboard shell**: headline cards (transactions analyzed, flagged, accounts involved, round trips) + cleaning summary (duplicates removed, reversals detected, balance breaks).
4. **Upload hardening**: password-protected PDF message, same-hash duplicate warning, unsupported-format guidance.

## Phase 3 — Visual analysis (the demo heart)

1. **Flow Graph page** (Cytoscape.js): node size = throughput, color = suspicion (red/amber/grey), solid confirmed / dashed probable edges, pan/zoom, layout picker, **PNG export** (court exhibit).
2. **Drawers**: node click → account transactions + flags with plain-English explanations; edge click → transfer evidence (ref ID, amount, timestamps, source rows).
3. **Round-trip mode**: toggle highlights each detected loop (animated edge trace), loop list sidebar with score; accumulation-account badge on high-inflow/low-outflow nodes.
4. **Money Trail page**: pick any credit (searchable list of flagged credits first) → FIFO trail table + **Sankey** (credit → counterparties/categories), stop-rule toggle, per-trail disposition strip ("42% cash, 51% forwarded").
5. **Dashboard charts**: disposition donut (cash/cheque/redirected/merchant/other), flagged-activity timeline, common-suspicious-identifiers panel with occurrence counts.

## Phase 4 — Reports, Golden Hour, Ship

1. **Report page**: live HTML preview (same template as PDF) → three download buttons: Investigation PDF, Standardized extraction PDF, Excel.
2. **Golden Hour board**: per-account freeze cards (Frozen green / Pending amber / Not contacted red / Escaped dark red) + summons modal — prefilled Section 94 BNSS order, officer reviews and downloads; nothing auto-sends.
3. **Deployment**: docker-compose.yml (nginx serving frontend + proxying API, postgres, backend), `.env.example`, tested from a clean clone on a second machine.
4. **Polish pass**: empty states with guidance, skeleton loaders, keyboard-free operation, consistent color language, (stretch) Kannada label toggle.
5. **Demo script**: 7-minute walkthrough using the statement-forge case; rehearse twice with Person A.
