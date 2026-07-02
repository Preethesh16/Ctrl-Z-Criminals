# TraceNet 🏦🔍

**Financial Evidence & Organised Network Scrutiny and Intelligence Query**

Automated Bank Statement Analysis System for cybercrime investigation — built for **CIDECODE 2026** (Bangalore Cybercrime Police hackathon) by team **Ctrl+Z Criminals**.

> **Status: feature-complete.** All 4 build phases shipped and integration-verified — including an
> end-to-end rehearsal from a clean clone: 9 statement formats parsed (incl. scanned-PDF OCR),
> SHA-256 evidence chain verified 9/9, planted round-trip detected, all 3 court exports downloaded.
> Extraction validated on **160/162 real police statements (~195,000 transactions, 0 crashes)** —
> the remaining 2 files verifiably contain no transactions.

## What it does

Police investigators receive bank statements in every imaginable format — digital PDFs, scanned printouts, Excel, CSV, DOCX, even photographs. TraceNet ingests them all, normalizes every transaction into one canonical schema, and runs forensic analysis:

- **Multi-format extraction** with an OCR pipeline (OpenCV preprocessing + pluggable Tesseract/PaddleOCR) for scanned documents, magic-byte file detection, and per-bank layout handling learned from 14 real layouts
- **Data cleaning** — duplicate flagging (never silent deletion), failed/reversed transaction pairing, running-balance consistency validation (FD-07)
- **Round-trip detection** — *time-respecting* cycle search (money must move around the loop in time order — kills the false positives naive cycle detection produces)
- **Money flow graph** — interactive network of who sent money to whom, suspicion-colored, with accumulation-account highlighting and PNG export for court exhibits
- **FIFO money trail** — track exactly where a credited amount was spent, debit by debit, with partial attribution and "amount still resting" detection
- **Common suspicious identifiers** — UPI IDs/accounts appearing across multiple statements
- **Disposition breakdown** — % cash withdrawn, % cheque, % redirected to other accounts
- **Golden Hour board** — per-account freeze tracking + prefilled Section 94 BNSS notices (officer reviews; nothing auto-sends)
- **Court-ready reports** — standardized extraction PDF, investigation report PDF with legal clause mapping, multi-sheet Excel export — all carrying the SHA-256 evidence chain and audit trail

Everything runs **fully offline** on police infrastructure. An optional LLM assist (Claude API) for unknown statement layouts and report narratives is **off by default** and only ever sees masked headers/aggregates.

## Quick start

```bash
git clone <this repo> && cd Ctrl-Z-Criminals
docker compose up --build
# → app at http://localhost:3000 (UI + API behind nginx)
```

**Try it with the synthetic demo case** (1 victim + 8 mules, planted round trip — never real data):

```bash
# generate the demo statements (not committed; uses the api image's OCR libs)
docker run --rm -v "$(pwd)/tools:/tools" ctrl-z-criminals-api \
  python /tools/statement-forge/forge.py /tools/statement-forge/out
```

Then in the app: **New Case → drag all files from `tools/statement-forge/out/` → Review → Analyze**. The 7-minute walkthrough lives in [demo-script.md](demo-script.md).

Dev mode (hot reload): `cd backend && uvicorn app.main:app --reload` + `cd frontend && npm run dev` (frontend defaults to mock data; set `VITE_API_MODE=real` to hit the backend). Config: copy `.env.example` → `.env`; details in [dbguide.md](dbguide.md).

## Mentor requirements → where they live

| # | Requirement | Delivered by |
|---|---|---|
| 1 | Multi-format upload + OCR + field extraction | Upload wizard → `backend/app/ingest/` + OCR pipeline |
| 2 | Cleaning: duplicates, reversals, balance consistency | Review queue + `backend/app/services/cleaning.py` |
| 3 | All formats → one standardized PDF | Reports page → `/export/standardized.pdf` |
| 4 | Money flow dashboard + suspicious common UPI IDs | Flow Graph page + dashboard identifiers panel |
| 5 | FIFO money trail visualization | Money Trail page (Sankey + hop table, stop-rule toggle) |
| 6 | % cash / cheque / redirected breakdown | Dashboard disposition donut + per-case API |

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, PostgreSQL 16 (SQLite dev fallback) |
| Extraction | pdfplumber + layered regex fallbacks, OpenCV + Tesseract/PaddleOCR, pandas/openpyxl/xlrd, python-docx |
| Analysis | NetworkX-style temporal cycle search, FD-01…08 rule engine, scikit-learn Isolation Forest |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS v4 + framer-motion |
| Visualization | Cytoscape.js (flow graph), Recharts (donut, timeline, Sankey) |
| Reports | Jinja2 + WeasyPrint (PDF), openpyxl (Excel) |
| Deploy | Docker Compose (nginx + FastAPI + Postgres) — one command, no internet required |

## Repository guide

| File | Purpose |
|---|---|
| [plan.md](plan.md) | Full build plan — architecture, algorithms, edge cases |
| [progress.md](progress.md) | Phase-wise task checklist (fully ticked) + deviations log |
| [demo-script.md](demo-script.md) | Timed 7-minute demo walkthrough |
| [personA.md](personA.md) / [personB.md](personB.md) | Per-lane work logs (backend / frontend) |
| [tasks/](tasks/) | Original lane task lists |
| [CLAUDE.md](CLAUDE.md) | Instructions for Claude Code sessions (both members) |

## ⚠️ Confidential test data

`Bank-statements-dataset/` (local only, **never in this repo**) holds real test statements provided by the Bangalore Cybercrime Police. It is git-ignored and must stay off GitHub, cloud databases, and LLM APIs. Local testing only — see CLAUDE.md for the full handling rules. All committed fixtures and demo data are synthetic (`tools/statement-forge/`).

## Team

**Ctrl+Z Criminals** — CIDECODE 2026, conducted by Cybercrime Police Bangalore.
