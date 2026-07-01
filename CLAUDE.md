# CLAUDE.md — TraceNet (CIDECODE 2026, Ctrl+Z Criminals)

This file is shared by **both team members**. Every Claude Code session on either machine follows these rules.

## Project

TraceNet: automated bank statement analysis for cybercrime police. Read **plan.md** before implementing anything — it contains the architecture, canonical transaction schema, algorithm specs (round-trip temporal cycles, FIFO trail), edge-case checklist, and tech stack decisions. Do not deviate from plan.md without noting the deviation in progress.md.

## Who is working: lanes

Work is split into two lanes, phased in **tasks/person-a.md** and **tasks/person-b.md**:

- **Person A — Data & Detection**: everything under `backend/app/` (ingest, normalize, cleaning, detection, reporting, api) + `tools/statement-forge/`
- **Person B — Product & Visualization**: everything under `frontend/` + Docker/nginx deployment + report preview UX

At the start of a session, ask the user which person they are if not obvious, then work **only in that lane's files**. The API contract (Pydantic schemas / OpenAPI spec published by Person A at the end of Phase 1) is the shared boundary — changes to it require a note in progress.md and a heads-up to the other member.

## Phases — do not skip ahead

Work proceeds in 4 phases (see plan.md §6 and the task files). Finish and check off your current phase's tasks before starting the next. Each phase ends with an **integration checkpoint** both members verify together:

1. **Foundation** → checkpoint: upload a digital PDF via the UI, see parsed transactions from the real API
2. **Full ingestion & cleaning** → checkpoint: all 6 demo formats upload; review queue works
3. **Detection & analysis** → checkpoint: round trip, flow graph, FIFO trail, disposition donut all render from real data
4. **Reports & ship** → checkpoint: full demo rehearsal, `docker compose up` from a clean clone

## Progress protocol (mandatory)

**progress.md** is the single source of truth for what is done.

- After completing any task, immediately tick its checkbox in progress.md and append `(done: YYYY-MM-DD, <person>)`.
- If a task is partially done or blocked, note it under the task: `> blocked: <reason>`.
- Commit progress.md together with the work it describes — never as a separate stale commit.
- At the start of every session, read progress.md to see the other person's state before writing code.

## Git workflow (mandatory)

- **Never commit directly to `main`.**
- Branch naming: `person-a/<phase>-<feature>` and `person-b/<phase>-<feature>` (e.g. `person-a/p1-pdf-parser`, `person-b/p2-review-queue`).
- Merge into `main` only at phase checkpoints, after both lanes' checkpoint criteria pass. Pull `main` into your branch daily.
- **If you are blocked by the other person's delayed work**: do NOT wait. Create your branch, code against the OpenAPI contract using mock fixtures (`frontend/src/api/mocks/` for Person B; synthetic fixture data in `backend/tests/fixtures/` for Person A), and merge when the real dependency lands. This is the standing rule — no coordination needed to invoke it.
- Commit messages: `[A|B][P<phase>] <what>` e.g. `[A][P1] canonical schema + date normalizer`.

## Conventions

- Backend: Python 3.12, type hints everywhere, Pydantic v2 models for all API I/O, pytest for every module in `backend/tests/`. Run `pytest` before every commit.
- Frontend: TypeScript strict, components in `frontend/src/components/`, pages in `frontend/src/pages/`, all server calls through the typed client in `frontend/src/api/`.
- **Design system (mandatory)**: all colors, type sizes, radii, shadows, and spacing come from the tokens in `frontend/src/styles/theme.css` — never hardcode hex values, px sizes, or ad-hoc shadows. Use the component classes (`card`, `btn-primary`, `btn-secondary`, `tag`, `stat-number`) and Tailwind utilities backed by the tokens (`bg-primary`, `text-text-secondary`, `rounded-card`, …). Palette: background #F6F7FB, surface white, sidebar #16161D, primary #2F6FED, secondary #8B7CF6, warning #F5A623, success #2FC5A0, border #E5E7EB. Font: Inter (400/500/600/700).
- **Motion (mandatory)**: all animations come from the framer-motion presets in `frontend/src/theme/motion.ts` (`fadeIn`, `slideUp`, `staggerContainer`, `hoverScale`, `transitions`) — never define ad-hoc variants per page. Entrances ≤0.3s easeOut, interactions 0.2s easeInOut; subtle and fast, this is an investigation tool.
- Reusable UI primitives live in `frontend/src/components/ui/` (`Button`, `Card`, `StatCard`) — extend these, don't fork them. `src/App.tsx` currently shows the sanctioned conventions; replace it with real pages but keep the patterns.
- Money is `Decimal` (backend) / integer paise or string (API JSON) — never float.
- All timestamps stored UTC, displayed IST.
- Never commit `.env`, API keys, or real bank statements. Demo data comes only from `tools/statement-forge/`.

## ⚠️ CONFIDENTIAL TEST DATA — `Bank-statements-dataset/`

The `Bank-statements-dataset/` folder (subfolders `primary/`, `Secondary/`) contains **real, confidential test data provided by the Bangalore Cybercrime Police**. Both persons MUST follow these rules — no exceptions:

- **NEVER push this folder to GitHub or any remote.** It is git-ignored in `.gitignore`; do not remove that entry, do not `git add -f` it, do not copy files out of it into tracked paths.
- Use it **only locally** for testing the parsers and analysis pipeline on your own machine.
- Never upload its contents to any cloud service — no shared Neon/Supabase DB rows derived from it, no LLM API calls with its contents (keep `LLM_ENABLED=false` when testing against it), no screenshots of it in issues/PRs/demo material.
- Test fixtures committed to the repo must come **only** from `tools/statement-forge/` synthetic data — never from this folder, not even "anonymized" copies.
- Before every `git push`, verify with `git status` that nothing from `Bank-statements-dataset/` is staged.
- The public demo uses synthetic statement-forge data only; the police dataset is for private validation.
- Secrets/config: environment variables via `.env` (see dbguide.md).

## Commands

```bash
# backend
cd backend && uvicorn app.main:app --reload   # dev server :8000
cd backend && pytest                          # tests
# frontend
cd frontend && npm run dev                    # dev server :3000
cd frontend && npm run build && npm run lint
# full stack
docker compose up --build
```
