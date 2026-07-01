# TraceNet 🏦🔍

**Financial Evidence & Organised Network Scrutiny and Intelligence Query**

Automated Bank Statement Analysis System for cybercrime investigation — built for **CIDECODE 2026** (Bangalore Cybercrime Police hackathon) by team **Ctrl+Z Criminals**.

## What it does

Police investigators receive bank statements in every imaginable format — digital PDFs, scanned printouts, Excel, CSV, DOCX, even photographs. TraceNet ingests them all, normalizes every transaction into one canonical schema, and runs forensic analysis:

- **Multi-format extraction** with dual-engine OCR (PaddleOCR + Tesseract) for scanned documents
- **Data cleaning** — duplicate removal, failed/reversed transaction detection, balance-consistency validation
- **Round-trip detection** — time-respecting cycle search that finds money looping back through mule accounts
- **Money flow graph** — interactive network of who sent money to whom, with accumulation-account highlighting
- **FIFO money trail** — track exactly where a credited amount was spent, debit by debit
- **Common suspicious identifiers** — UPI IDs/accounts appearing across multiple statements
- **Disposition breakdown** — % cash withdrawn, % cheque, % redirected to other accounts
- **Court-ready reports** — standardized extraction PDF, investigation report PDF, multi-sheet Excel export, with SHA-256 evidence chain and full audit trail

Everything runs **fully offline** on police infrastructure. An optional LLM assist (Claude API) for unknown statement layouts and report narratives is off by default.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, PostgreSQL 16 |
| Extraction | pdfplumber + docling fallback, PaddleOCR + Tesseract, pandas/openpyxl, python-docx |
| Analysis | NetworkX (temporal cycle search), scikit-learn Isolation Forest |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Visualization | Cytoscape.js (flow graph), Recharts + d3-sankey (trail, disposition) |
| Reports | WeasyPrint (PDF), openpyxl (Excel) |
| Deploy | Docker Compose — one command, no internet required |

## How the work is phased

Development runs in **4 phases**, each with parallel lanes for Person A (data & detection) and Person B (product & visualization), ending in an integration checkpoint:

| Phase | Person A (backend) | Person B (frontend) | Checkpoint |
|---|---|---|---|
| **1 — Foundation** | Scaffold, DB models, digital parsers, normalization | React scaffold, API client, case wizard + upload | Upload a digital PDF → see parsed transactions |
| **2 — Full ingestion & cleaning** | OCR pipeline, DOCX/image, cleaning suite, test-data forge | Review queue, column mapping, dashboard shell | Any format uploads cleanly with review flow |
| **3 — Detection & analysis** | Flow graph, round trips, FIFO trail, rules + ML | Cytoscape graph, Sankey trail, disposition charts | Full analysis visible end-to-end |
| **4 — Reports & ship** | PDF/Excel generation, LLM assist, hardening | Report flow, Golden Hour board, Docker, polish | Complete demo rehearsed |

## Quick start

```bash
# Full stack (recommended)
docker compose up --build
# → frontend at http://localhost:3000, API at http://localhost:8000/docs

# Dev mode
cd backend  && pip install -r requirements.txt && uvicorn app.main:app --reload
cd frontend && npm install && npm run dev
```

Database and API-key setup: see **[dbguide.md](dbguide.md)**.

## Repository guide

| File | Purpose |
|---|---|
| [plan.md](plan.md) | Full build plan — architecture, algorithms, edge cases |
| [progress.md](progress.md) | Phase-wise task checklist for both team members |
| [tasks/person-a.md](tasks/person-a.md) | Person A lane: data & detection engine, phase by phase |
| [tasks/person-b.md](tasks/person-b.md) | Person B lane: product & visualization, phase by phase |
| [dbguide.md](dbguide.md) | Database + API keys + connection setup |
| [CLAUDE.md](CLAUDE.md) | Instructions for Claude Code sessions (both members) |

## ⚠️ Confidential test data

`Bank-statements-dataset/` (local only, **never in this repo**) holds real test statements provided by the Bangalore Cybercrime Police. It is git-ignored and must stay off GitHub, cloud databases, and LLM APIs. Local testing only — see CLAUDE.md for the full handling rules. All committed fixtures and demo data are synthetic (`tools/statement-forge/`).

## Team

**Ctrl+Z Criminals** — CIDECODE 2026, conducted by Cybercrime Police Bangalore.
