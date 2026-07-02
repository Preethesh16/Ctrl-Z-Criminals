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

## Current state (updated: 2026-07-02)

- **Phase**: 1 — **COMPLETE, Checkpoint 1 verified** against Person A's real API. Ready to merge to main jointly, then start Phase 2 (review queue UI, column-mapping UI, dashboard shell).
- **Contract**: `backend/openapi.json` is live; `src/api/types.ts` reconciled to it 2026-07-02. Key shapes: money = decimal strings ("500000.00"), JobOut progress 0–100 + detail "N transactions", transactions paginated `{items,total,offset,limit}` with `direction`+`amount_inr`, duplicate upload = HTTP 409, `needs_review` boolean drives review highlighting.
- **Integration verified on this machine**: backend venv at `backend/.venv` (created via `pip3 --python` because python3-venv lacks ensurepip here), 20 backend tests pass, real digital PDF → 47 transactions through :3000 → /api proxy → :8000.
- **Done**:
  - Frontend scaffold (theme tokens, motion presets, `Button`/`Card`/`StatCard`/`Input` primitives).
  - Router + `AppLayout` shell (react-router-dom; dark sidebar with NavLink active state; showcase `App.tsx` replaced).
  - API layer: provisional types (`src/api/types.ts`, hand-written from plan.md §4.1), typed client (`src/api/client.ts`), mock adapter (`src/api/mocks/mockAdapter.ts`) with seeded demo case, deterministic synthetic transactions, job-polling simulation and failure states. Default = mocks; `VITE_API_MODE=real` → `/api` proxy → FastAPI :8000 (proxy in vite.config.ts, dev port set to 3000).
  - Cases page: list + New Case modal (FIR/CEN no., complainant, ₹→paise conversion, incident date, validation).
  - Case wizard (`/cases/:caseId/wizard`): Upload → Review → Analyze pill stepper. Review shows transactions table with low-confidence (<0.70) rows highlighted; Analyze is a Phase-3 stub.
  - UploadDropzone: drag-drop + click, multi-file, per-file progress bar with job polling (700ms), "N transactions found" success chip, plain-English failure guidance (password-protected / unsupported format / duplicate file / parse failed).
  - Placeholder pages with empty-state guidance for Dashboard, Flow Graph, Money Trail, Reports.
- **Verified**: `npm run build` (tsc strict) + `npm run lint` clean; dev server smoke-tested on :3000.
- **Person A state** (per progress.md): nothing ticked — no OpenAPI contract yet. When it lands: regenerate `src/api/types.ts`, reconcile field names, run wizard against real API (that's Checkpoint 1).
- **Blockers**: Checkpoint 1 ("upload digital PDF → parsed txns from real API") needs Person A's endpoints — frontend side is ready.
- **Next up (Phase 2)**: review queue UI, column-mapping UI, dashboard shell with real cleaning stats, upload hardening polish.

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

### 2026-07-02 — Session 3: contract reconciliation + Checkpoint 1 integration
- Pulled main (PR #1 merged); merged `origin/person-a/p1-foundation` into my branch (standing don't-wait rule) — clean merge, backend + `openapi.json` + `personA.md` now on my branch.
- Read Person A's log: their whole Phase-1 lane is done, 93.2% real-data coverage, contract published.
- Rewrote the API layer to match the real contract (types.ts, client.ts, mockAdapter.ts — mock now has full contract parity incl. 409 duplicates and "N transactions" job detail). Moved `ApiError` to `src/api/errors.ts` (shared by both adapters). Updated CasesPage (CaseOut has no status/counts; only FIR required now), CaseWizardPage (paginated transactions, `needs_review` highlighting, direction-based debit/credit columns), UploadDropzone (progress 0–100, error guidance classified from HTTP status + message text since the contract carries failures as free text).
- **Found + fixed a real integration bug**: vite proxy forwarded `/api/cases` verbatim but backend routes are unprefixed → added `rewrite` strip. ⚠️ The Phase-4 nginx config must strip `/api` the same way.
- Stood up the backend locally (pip3 --python workaround for missing ensurepip), ran their 20 tests (pass), then verified Checkpoint 1 through the UI's exact network path: create case → upload real digital PDF (local-only) → job polls to done → 47 transactions in contract shape via the :3000 proxy.
- Build + lint clean. Ticked Checkpoint 1 in progress.md (joint browser walkthrough still recommended at merge).
- **Next session starts at**: merge to main with Person A, then Phase 2 review-queue UI.

### 2026-07-01 — Session 2: Phase 1 complete (mock-first)
- Installed `react-router-dom`; replaced showcase `App.tsx` with real router + `AppLayout` (kept sanctioned sidebar/motion patterns).
- Built the full API layer (provisional types from plan.md §4.1 + mock adapter + typed client with `VITE_API_MODE` switch); mock simulates job polling, ~15% low-confidence OCR rows, password-protected/duplicate/unsupported failures (trigger the password flow in demos by naming a file `...protected.pdf`).
- Built CasesPage (+ New Case modal), CaseWizardPage (stepper + review table), UploadDropzone, placeholder pages; added `Input` UI primitive and `lib/format.ts` (INR paise formatter, IST dates).
- Fixed `index.html` title → "TraceNet — Bank Statement Analysis". Set vite dev port 3000 + `/api` proxy per CLAUDE.md.
- Fixed one TS error (`erasableSyntaxOnly` forbids constructor parameter properties). Build + lint clean; dev-server smoke test OK.
- Ticked all 4 remaining Person B Phase-1 boxes in progress.md with notes.
- **Next session starts at**: Phase 2 review-queue UI — or Checkpoint 1 integration if Person A's API has landed.

### 2026-07-01 — Session 1: setup & housekeeping
- Read plan.md, progress.md, tasks/person-b.md, CLAUDE.md; confirmed lane = Person B, Phase 1.
- Diagnosed the 29 phantom-modified files as CRLF churn; fixed with `core.autocrlf=input` — working tree clean, no content commits needed.
- Inspected `Bank-statements-dataset/` structure locally (verified git-ignored; nothing copied out); recorded format-mix implications above.
- Created this work log; branch `person-b/p1-foundation`; pushed.
- **Next session starts at**: router + layout shell (Phase 1 item 1).
