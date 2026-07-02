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

## Current state (updated: 2026-07-02, session 7)

- **Phase**: 4 — **ALL Person B tasks complete and Docker-verified** on `person-b/p4-reports-ship`. `docker compose up --build` tested end-to-end on this machine: 3 containers healthy, all 9 forge formats parsed **including scanned-PDF OCR inside the container**, round trip detected, all 3 exports downloaded through nginx, running on postgres. Checkpoint 4 = joint demo rehearsal + clean-clone repeat on a second machine.
- **Docker how-to on this machine**: WSL integration is OFF but Windows Docker Desktop is reachable via `"/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe" compose ...` from the repo root. (Editing Docker Desktop's settings-store.json is permission-blocked — use docker.exe or enable integration manually in the GUI.) Stack left RUNNING on http://localhost:3000 after this session.
- **Report page**: preview iframe + 3 downloads verified against real backend (report.pdf 60KB, case.xlsx 16KB, standardized.pdf endpoint live). WeasyPrint works on this WSL directly too.
- **Golden Hour**: freeze statuses live in localStorage per case (`tracenet.freeze.<caseId>`) — officer working state, not evidence; deliberately not a backend model.
- **Deploy files**: compose (postgres+api+web:3000), nginx strips `/api` (trailing-slash proxy_pass), backend image bakes poppler/tesseract/pango, frontend image builds with `VITE_API_MODE=real`. Added `psycopg2-binary` to backend requirements (cross-lane, noted to A).
- **A's remaining P4**: LLM assist, API hardening, embedding graph PNGs into the report.

## Previous state (2026-07-02, late night — Phase 3)

- **Phase**: 3 — **COMPLETE, Checkpoint 3 verified B-side** on branch `person-b/p3-visuals`. All Person B phases 1–3 done; only Phase 4 remains (reports UI, Golden Hour board, Docker/nginx, polish, demo script).
- **Phase-3 deliverables**: FlowGraphPage (Cytoscape: size=throughput, color=suspicion, dashed=probable, loop highlighting + loop cards, PNG export, legend), GraphDrawers (node → account stats/badge/flagged txns with explanations; edge → transfer evidence incl. confirmed-vs-probable wording), MoneyTrailPage (flagged-credits-first picker, stop-rule toggle, hop table, recharts Sankey, "still resting" freeze callout), DashboardPage v2 (Analyze button, disposition donut, flagged timeline, common-identifiers panel), wizard AnalyzeStep (real POST /analyze + deep links), flagExplanations.ts.
- **New deps**: cytoscape (+@types), recharts.
- **Verified against real backend on fresh forge case**: planted 5-hop round trip found (37.7% back, score 5.9), disposition/correlation/trail all render from real payloads. ⚠️ Cases parsed with older backend code have stale rows → 0 round trips; always test on a freshly uploaded case after pulling backend changes.
- Backend deps grew (scikit-learn, networkx): rerun `pip3 --python .venv/bin/python install -r requirements.txt` after pulls.

## Previous state (2026-07-02, night — Phase 2)

- **Phase**: 2 — **COMPLETE and real-wired, Checkpoint 2 verified B-side** on branch `person-b/p2-real-wiring`. Review queue, cleaning, and templates now hit Person A's real endpoints; mocks kept in contract parity.
- **Real contract notes (the repo openapi.json is STALE vs code — trust `backend/app/main.py`)**:
  - Upload (`POST /cases/{id}/documents` or `/uploads` alias) returns `UploadOut{document_id, job_id, filename, sha256}` → poll `job_id`.
  - `flags` are objects `{rule: "DUPLICATE-SUSPECT"|"REVERSED"|"FD-07-BALANCE-BREAK", …evidence}`.
  - Review corrections are FLAT fields on `TransactionReview` (no nested `corrections`).
  - Cleaning = explicit `POST /cases/{id}/clean` → `{transactions, balance_breaks, duplicate_pairs, reversal_pairs}` (idempotent). Dashboard has a "Run cleaning" button.
  - Templates: `GET/POST /templates`, `header_signature` = lowercased `|`-joined headers. No raw-columns endpoint and no server-side re-parse yet → mapping modal stays mock-fed for columns; real save → "re-upload the file" message.
- **Machine setup gap**: scanned-PDF OCR needs `sudo apt install poppler-utils tesseract-ocr` on this WSL — not yet installed (needs password). Until then scanned uploads fail gracefully. ⚠️ Also: running `backend/tests/test_forge_roundtrip.py` REGENERATES `tools/statement-forge/out/` and corrupts it if poppler is missing — restore with `git checkout -- tools/statement-forge/out/`.
- **Checkpoint 2**: ticked (B-side, 8/9 files: parse → clean finds planted reversal → review confirm/correct → dup 409). Joint browser walkthrough + merge to main remain.
- **Next up**: merge to main with Person A, then Phase 3 UI (Cytoscape flow graph, Sankey trail, dashboard charts) — Person A already has a `person-a/p3-detection` branch going.
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

### 2026-07-03 — Session 12: submission polish — README refresh
- Pulled main (A fixed the last known real-data misparse — AU Bank layout; coverage now effectively 100%: 160/162, the 2 remainders contain no transactions; 69 tests).
- progress.md fully ticked — remaining work is ship polish. **Rewrote README.md** for submission judges: status banner (feature-complete, clean-clone verified, real-data numbers), mentor-requirements→implementation table, corrected drift (docling dropped, React 19, Recharts Sankey not d3, OCR described as shipped), demo quickstart incl. container-based forge generation, repo guide updated (demo-script, work logs).
- Rebuilt the running Docker stack on latest main.
- Still open for A: the report bank-attribution flag from Session 11 (headermeta) — not yet addressed in their commits.

### 2026-07-02 — Session 11: officer-lens UX pass with real screenshots
- Drove the live Docker UI headless via **Windows Edge** (`msedge.exe --headless --screenshot`, works from WSL — no Playwright needed; chromium install blocked on sudo). Shots in `Hacathon/ux-shots/` (outside the repo).
- All 6 screens audited as a non-technical officer. **Passed**: guided empty states everywhere, plain-English copy, color discipline, ≤2 clicks, evidence-chain table with hashes visible in the report preview, Money Trail flagged-credits-first list reads beautifully.
- **Found + fixed 3 real issues**: (1) disposition donut never rendered — recharts draw animation + ResponsiveContainer zero-width; now fixed-size PieChart with `isAnimationActive={false}` (Bar too); (2) flow-graph labels overlapped on disconnected nodes — `nodeDimensionsIncludeLabels: true` + `componentSpacing: 120`, graph is dramatically more readable; (3) Flow Graph's "press Analyze" link dropped officers on the Upload step — wizard now supports `?step=analyze|review|upload` deep links.
- **Flagged to A** (progress.md notes): report evidence table shows victim_hdfc.pdf as "SBI" — header-meta bank misattribution, court-accuracy risk.
- Web container rebuilt with fixes; dashboard/graph re-shot and verified. Screenshot workflow reusable: see EDGE one-liner in this repo's history.

### 2026-07-02 — Session 10: Checkpoint 4 clean-clone rehearsal — ALL BOXES TICKED
- Pulled main (A's final balance-audit log). The last unticked box was Checkpoint 4.
- Cloned the repo fresh from GitHub into `/mnt/c/Deepthi_Files/Hacathon/tracenet-clean-test`, `docker compose -p tracenet-clean up --build` → 3 healthy containers.
- Full demo sequence through the clone's nginx: forge via container → case CEN/REHEARSAL/2026 → 9 formats parsed (incl. OCR) → **9/9 SHA-256 hashes verified** local-vs-Evidence-Locker → analyze (46 txns, 34 flagged, round trip found, 3 identifiers) → donut/trail render payloads → 3 exports downloaded.
- progress.md is now **100% ticked**. Only human step left: the spoken 7-minute rehearsal, both members, script in demo-script.md.
- Housekeeping: clean-test stack torn down; original project stack restarted on :3000 (previous demo cases intact in the `ctrl-z-criminals` volumes); clone kept at `tracenet-clean-test/` for reference (delete freely).

### 2026-07-02 — Session 9: final merge to main (SHIP state)
- Pulled main: A finished their last P4 items (LLM assist behind flag, API hardening, 160/162 real-file coverage, docling dropped as a recorded deviation) and **untracked the generated forge outputs** — demo files must now be regenerated via forge.py.
- Merged main into my branch (one conflict: requirements.txt — kept both `anthropic` and `psycopg2-binary`). Backend tests on merged code: 55 pass; the 13 golden-test errors are the known poppler fixture gap on this machine (they pass on A's machine and the flows are Docker-verified).
- The test fixture wiped `tools/statement-forge/out/` again (now untracked = unrecoverable via git) → **regenerated all 9 files + manifest inside the api container** (`docker run -v tools:/tools ctrl-z-criminals-api python forge.py`) — no host poppler needed. Demo script updated with this as the canonical setup step.
- **Merged everything to main and pushed** (user-authorized checkpoint merge; A had concurrently merged my branch too — final tip `403334d`). Main = complete TraceNet: all 4 phases, both lanes.
- **Remaining before submission**: joint demo rehearsal (script ready) + clean-clone `docker compose up` on a second machine + verify report hashes match uploads live.

### 2026-07-02 — Session 8: Docker stack verified end-to-end
- Discovered Docker Desktop was running and reachable from WSL via `docker.exe` (no setup needed) — `docker compose up --build` succeeded first try.
- Containerized e2e: created case through nginx :3000 → uploaded all 9 forge formats → **scanned PDF parsed via OCR inside the container** (poppler/tesseract baked into the image — the one format this WSL can't do natively) → analyze found the planted round trip (46 txns, 34 flagged) → all 3 exports downloaded (report.pdf 60KB, standardized.pdf 32KB, case.xlsx 17KB) → postgres backing store, not sqlite.
- Ticked the Docker Compose task in progress.md; Checkpoint 4 now only needs the joint rehearsal + clean-clone repeat on a second machine.
- Stack left running on http://localhost:3000 (stop with `docker.exe compose down`).

### 2026-07-02 — Session 7: Phase 4 — reports UI, Golden Hour, ship files
- Pulled main (P3 PR #4 merged). Merged `origin/person-a/p4-reports` into new branch `person-b/p4-reports-ship` (don't-wait rule): their report engine landed (preview HTML + 3 export endpoints, audit-logged).
- **ReportPage**: case picker, sandboxed iframe preview (`srcDoc`), three download cards → real export URLs; mock mode = placeholder preview + disabled downloads (`IS_MOCK_MODE` + `exportDownloadUrl` exported from client).
- **GoldenHourBoard + SummonsModal** on Dashboard (post-analysis): suspects from graph nodes, 4-state freeze tracker (localStorage), prefilled editable Section 94 BNSS notice → .txt download, status auto-advances to "Notice sent".
- **Deployment**: docker-compose.yml, backend/frontend Dockerfiles, nginx.conf (`/api` strip!), .env.example, .dockerignores, psycopg2-binary dep. Compose build untested here — Docker Desktop WSL integration off (documented).
- **demo-script.md**: 7-minute walkthrough, every beat tied to a mentor requirement, with fallbacks.
- Verified against real backend: report preview HTML renders, report.pdf (60KB) + case.xlsx (16KB) download. Build + lint clean.
- **Next session**: enable Docker WSL integration → clean-clone `docker compose up` test; joint Checkpoint-4 rehearsal; help A with anything left (LLM assist toggle UI?).

### 2026-07-02 (late night) — Session 6: Phase 3 visual analysis, real-wired
- Pulled main: Person A had reconciled all my provisional P2 endpoints to real ones (stats/columns/template-apply — review accepts both flat & nested) AND shipped the full detection engine + analysis APIs. Branch `person-b/p3-visuals`.
- Simplified client back to direct calls for stats/columns/template; added the 6 analysis endpoints (analyze, graph, round-trips, correlation, disposition, trail) with real-contract types; mock adapter got a coherent synthetic fraud story for offline dev.
- Built FlowGraphPage + GraphDrawers + MoneyTrailPage (Sankey) + DashboardPage v2 + wizard AnalyzeStep + flagExplanations (see Current state for details). Routes wired; placeholders remain only for Reports (P4).
- **Checkpoint 3 verified** on a fresh forge case against the real backend — planted round trip detected end-to-end. Two real bugs found & fixed en route: loop `score` is an open scale (UI showed 592%); and stale-parse gotcha documented (old-parser rows kill cross-statement matching — my Checkpoint-2 case showed 0 loops until re-uploaded fresh; also my earlier review-test "correction" of ₹56,500→₹12,345 had broken a loop leg — restored).
- Backend venv updated (sklearn/networkx now required).
- **Next session**: Phase 4 — report preview/download page, Golden Hour freeze board + Section 94 summons modal, docker-compose + nginx (remember: nginx must strip `/api`), polish pass, demo script.

### 2026-07-02 (night) — Session 5: real-wire Phase 2 + Checkpoint 2 verification
- Pulled main (PR #3 merged my P2 UI; Person A's OCR/DOCX/forge/cleaning/review/template APIs all landed). Branch `person-b/p2-real-wiring`.
- Reconciled the API layer with the real Phase-2 contract (see Current state): flat `TransactionReview`, flag objects, `CleanReport`, `BankTemplateIn/Out`, `UploadOut` upload response (client now polls `job_id` — this was a would-be production bug, the repo's openapi.json is stale). Real `getCaseStats` composes documents+transactions queries; `getDocumentColumns` 501s in real mode (no backend source yet).
- ReviewQueue: rule-based reason tags (incl. "Balance mismatch" for FD-07). Dashboard: "Run cleaning" button → `POST /clean`, summary merged into the cleaning card. Mapping modal: real mode saves to `POST /templates` (computed header signature) and tells the officer to re-upload.
- **Checkpoint 2 run** (real backend, forge files): 8 formats → 45 txns; `/clean` caught the planted reversal; review confirm+correct verified with UI payloads; duplicate 409 verified; scanned PDF fails gracefully (poppler missing locally — A's golden test covers OCR). Full chain re-verified through the :3000 proxy.
- Ops notes: stale `backend/tracenet.db` from my Checkpoint-1 run broke A's new tests (deleted it — schema had changed); forge pytest regenerated+corrupted `tools/statement-forge/out/` on my popplerless machine (restored via git; warning recorded above).
- **Next session**: joint walkthrough + Checkpoint-2 merge, then Phase 3 UI.

### 2026-07-02 (evening) — Session 4: Phase 2 UI complete (mock-first)
- Branch `person-b/p2-review-queue` from merged main (PR #2 closed Checkpoint 1).
- **ReviewQueue** (`src/components/ReviewQueue.tsx`): needs-review rows as cards with reason tags ("Hard to read" / "Possible duplicate"), big ✓ Correct / ✎ Fix (inline date-amount-direction editor) / ✕ Exclude buttons, "N of M cleared" progress, optimistic removal with reload-on-error. Wired into wizard step 2 above the full table.
- **ColumnMappingModal** (`src/components/ColumnMappingModal.tsx`): raw columns with sample values on the left, canonical field slots on the right, drag *or* tap-to-assign (officer-friendly), required-field validation, "save as template for this bank" → re-parse job polled to done. Launched from a "Map columns" button on failed upload rows.
- **DashboardPage**: case picker (URL `?case=` param), StatCards (analyzed / needs review / flagged / accounts), cleaning-summary card (duplicates, reversals, balance breaks), "Review N rows now" deep link, Phase-3 analysis placeholder card.
- **API layer**: provisional Phase-2 types (ReviewAction, CaseStats, DocumentColumns, ColumnTemplate) + 4 provisional endpoints in client + full mock implementations (mutable review state, seeded SUSPECTED_DUPLICATE flags ~4%, `unmapped`-in-filename demo trigger for the mapping flow).
- Build + lint clean; dashboard/cases routes smoke-tested. Ticked all 4 Phase-2 Person B boxes in progress.md with contract-proposal notes addressed to Person A.
- **Next session**: reconcile provisional endpoints when Person A's review/cleaning/template APIs land; joint Checkpoint 2 run with statement-forge formats. Until then, possible early Phase-3 prep: Cytoscape spike.

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
