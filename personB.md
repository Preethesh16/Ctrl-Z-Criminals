# Person B — Work Log (Product & Visualization lane)

> **Purpose**: single source of context for any AI session or teammate picking up Person B's work.
> **Protocol (mandatory)**: this file is updated **on every prompt/work session** — append a session entry before pushing. Read this file + `progress.md` + `tasks/person-b.md` at the start of every session.

## Who / lane

- **Person B** — owns `frontend/**`, `docker-compose.yml`, nginx config, demo script, report-preview UX.
- Never touches `backend/app/` or `tools/statement-forge/` (Person A's lane).
- Shared boundary: the OpenAPI contract Person A publishes at end of Phase 1. Until it lands, code against mocks in `frontend/src/api/mocks/` — never wait.

## Standing rules (from CLAUDE.md — enforced every session)

- Never commit to `main`; branches are `person-b/p<phase>-<feature>`; merge only at phase checkpoints.
- Commit format: `[B][P<phase>] <what>`.
- Design tokens only (`frontend/src/styles/theme.css`), motion presets only (`frontend/src/theme/motion.ts`), extend UI primitives in `frontend/src/components/ui/` — never fork or hardcode.
- `Bank-statements-dataset/` is confidential police data: **local-only, git-ignored, never pushed/screenshotted/uploaded anywhere**. Verify `git status` before every push. Committed fixtures come only from statement-forge synthetic data.
- Money = integer paise or string in API JSON, never float. Timestamps UTC stored, IST displayed.
- `npm run build && npm run lint` before every commit.

## Current state (updated: 2026-07-01)

- **Phase**: 1 — Foundation.
- **Done**: frontend scaffold (Vite + React 18 + TS + Tailwind v4 + framer-motion, design-token theme, motion presets, `Button`/`Card`/`StatCard` primitives, showcase `App.tsx`).
- **Next up (Phase 1 remaining)**:
  1. Router + real layout shell (replace showcase `App.tsx`, keep its patterns).
  2. Typed API client + mock adapter with fixture data (Person A's OpenAPI contract not yet published — mocks are the standing rule).
  3. Cases list page + New Case form (FIR no., complainant, fraud amount, date).
  4. Case wizard shell (Upload → Review → Analyze stepper).
  5. Upload dropzone: multi-file, per-file job-polling progress, "N transactions found" chip, failure states.
- **Person A state** (per progress.md): nothing ticked yet — no OpenAPI contract, no backend endpoints. All frontend work goes through mocks.
- **Blockers**: none.

## Local dataset intel (structure only — contents never leave this machine)

`Bank-statements-dataset/Bank-statements-dataset/{primary, Secondary}` — 103 PDF, 23 xlsx, 22 xls, 11 csv, 3 txt (~162 real statements, filenames are account/reference numbers, some `_SOA` suffixed). Implications for the UI:

- Upload dropzone must comfortably handle **bulk multi-file drops (100+ files)** — virtualized file list, per-file status.
- Mixed formats in one case is the norm, not the edge case.
- `.xls` (legacy) and `.txt` appear in real data — surface "unsupported/needs conversion" guidance if Person A's parsers don't cover them.

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-07-01 | `git config core.autocrlf input` on this machine | Windows/WSL CRLF made all 29 tracked files show as fully modified (pure line-ending churn). `input` normalizes to LF on commit; working tree went clean with zero content change. |
| 2026-07-01 | This file (`personB.md`) is the per-session context log; updated every prompt and pushed with the work | Keeps any AI session / teammate in sync without re-deriving context. |

## Session log (newest first)

### 2026-07-01 — Session 1: setup & housekeeping
- Read plan.md, progress.md, tasks/person-b.md, CLAUDE.md; confirmed lane = Person B, Phase 1.
- Diagnosed the 29 phantom-modified files as CRLF churn; fixed with `core.autocrlf=input` — working tree clean, no content commits needed.
- Inspected `Bank-statements-dataset/` structure locally (verified git-ignored; nothing copied out); recorded format-mix implications above.
- Created this work log; branch `person-b/p1-foundation`; pushed.
- **Next session starts at**: router + layout shell (Phase 1 item 1).
