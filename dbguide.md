# Database, API Keys & Connection Guide

Everything each team member needs to get a working environment. **Never commit `.env` files or keys** — `.gitignore` covers them; `.claude/settings.json` also blocks Claude Code from reading `.env`.

## 1. Database options

TraceNet uses **PostgreSQL 16** via SQLAlchemy. Pick one of three setups:

### Option A — Docker Postgres (recommended for solo dev & the demo)
Comes free with the compose stack, zero signup, fully offline (matches our privacy pitch):
```bash
docker compose up db          # just the database
# DATABASE_URL=postgresql+psycopg://tracenet:tracenet@localhost:5432/tracenet
```

### Option B — Shared online Postgres (recommended while both work in parallel)
Use **Neon** (https://neon.tech — free tier, serverless Postgres) or **Supabase** (https://supabase.com — free tier). Neon is simpler for a plain Postgres URL:

1. One person signs up at neon.tech → **Create project** → name `tracenet`, region `AWS ap-southeast-1 (Singapore)` (closest to Bangalore).
2. On the project dashboard, click **Connect** → copy the connection string (it looks like `postgresql://user:password@ep-xxx.ap-southeast-1.aws.neon.tech/tracenet?sslmode=require`).
3. Share it with the teammate privately (WhatsApp/Signal — **not** in the repo, not in Discord servers).
4. Both put it in `backend/.env` as `DATABASE_URL` (change scheme to `postgresql+psycopg://`).
5. Run migrations once: `cd backend && alembic upgrade head`.

> Note: the shared cloud DB is a **development convenience only**. The submission/demo runs Option A (offline Docker) — that's part of our privacy story. Don't put anything resembling real bank data in the cloud DB; statement-forge synthetic data only.

### Option C — Zero-setup SQLite fallback
If you just want to hack quickly: leave `DATABASE_URL` unset and the backend falls back to `sqlite:///./tracenet.db`. Fine for parser work; use Postgres before testing analysis features (JSONB, concurrency).

## 2. Environment files

Copy the template and fill in:
```bash
cp backend/.env.example backend/.env
```

`backend/.env.example` (committed; the real `.env` is git-ignored):
```env
# --- Database ---
DATABASE_URL=postgresql+psycopg://tracenet:tracenet@localhost:5432/tracenet

# --- LLM assist (OPTIONAL — system is fully functional without it) ---
LLM_ENABLED=false
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5

# --- App ---
SECRET_KEY=change-me-to-a-long-random-string
UPLOAD_DIR=./uploads
MAX_UPLOAD_MB=50
```

Frontend needs only `frontend/.env`:
```env
VITE_API_BASE_URL=http://localhost:8000
```

## 3. Anthropic API key (optional LLM assist)

Only needed if you enable the LLM column-mapping/narrative assist:

1. Go to https://console.anthropic.com → sign up → **API Keys** → **Create Key** (name it `tracenet-dev`).
2. Put it in `backend/.env` as `ANTHROPIC_API_KEY=sk-ant-...` and set `LLM_ENABLED=true`.
3. Each member uses their **own** key — do not share keys.
4. The backend must send only column headers + masked sample rows (account numbers truncated to last 4). This is enforced in `backend/app/llm/` — keep it that way; it's part of the pitch.

## 4. System dependencies (one-time per machine)

```bash
# Arch Linux
sudo pacman -S tesseract tesseract-data-eng poppler   # poppler = pdf2image backend
# Debian/Ubuntu
sudo apt install tesseract-ocr poppler-utils libpango-1.0-0 libpangocairo-1.0-0  # pango = WeasyPrint

# Python deps (PaddleOCR, docling etc. are pure pip installs, CPU-only)
cd backend && pip install -r requirements.txt
```

Docker users skip all of this — the backend image bundles Tesseract, Poppler, Pango, and the PaddleOCR/docling models (pre-downloaded at build time so the demo box needs no internet).

## 5. Connection checklist (run after setup)

```bash
cd backend
python -c "from app.db import engine; engine.connect(); print('DB OK')"
alembic upgrade head                    # apply migrations
uvicorn app.main:app --reload           # http://localhost:8000/docs should load
cd ../frontend && npm run dev           # http://localhost:3000 should show Cases page
```

## 7. Public deployment (Vercel frontend + hosted backend)

This is for a **public demo link only** — synthetic statement-forge data, never anything from `Bank-statements-dataset/`. The real submission/pitch story is the offline Docker stack (§1 Option A); this section is a convenience URL for judges to click.

### 7.1 Frontend → Vercel

`frontend/vercel.json` is already committed with the routing rewrites. In the Vercel dashboard:

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Env var | `VITE_API_MODE=real` |

After the backend is deployed (§7.2), edit `frontend/vercel.json` — replace `YOUR-BACKEND-URL` with the real backend URL — commit, and Vercel auto-redeploys.

### 7.2 Backend → Render or Railway (Vercel cannot host it)

The backend needs Tesseract, Poppler, and Pango system binaries, a Postgres connection, and persistent file storage for uploads — none of which fit Vercel's serverless functions. `backend/Dockerfile` already bundles everything, so either host works as a plain "deploy this Dockerfile" service.

**Render — recommended for this project:**
1. render.com → **New → Web Service** → connect the GitHub repo.
2. **Root Directory**: `backend`. **Runtime**: Docker (Render finds `backend/Dockerfile` automatically).
3. **Instance type**: Free tier works for a demo (spins down when idle — first request after sleep takes ~30s, mention that in the demo).
4. Environment variables (Render dashboard → Environment):
   ```
   DATABASE_URL=postgresql+psycopg://...   ← from Neon, see §1 Option B
   SECRET_KEY=<generate a long random string>
   LLM_ENABLED=false
   UPLOAD_DIR=/var/data/uploads
   MAX_UPLOAD_MB=50
   ```
5. Add a **Render Disk** (Settings → Disks → 1GB is plenty) mounted at `/var/data` — without this, every redeploy/restart wipes uploaded statements.
6. Deploy → copy the service URL (`https://<name>.onrender.com`) → paste into `frontend/vercel.json`.

**Railway — the alternative**, marginally simpler UI, usage-based free credits instead of a hard free tier, no separate "disk" step (volumes are built into the project). Same Dockerfile, same env vars, same Neon DB. Functionally near-identical to Render for this app; pick whichever account you already trust more. Full comparison of trade-offs is in the recommendation the assistant will give inline when asked — this file just needs to describe the mechanics of either.

### 7.3 After both are live

```bash
curl https://<your-backend>.onrender.com/health   # {"status": "ok"}
```
Then open the Vercel URL, create a case, upload a few `tools/statement-forge/out/` files, and confirm the review → analyze → report flow works over the public URLs before sharing the link.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `sslmode` errors with Neon | Ensure `?sslmode=require` stays in the URL and scheme is `postgresql+psycopg://` |
| `pdf2image` "Unable to get page count" | Install poppler (see §4) |
| WeasyPrint import error | Install pango/cairo system libs (see §4) |
| PaddleOCR first-run download | It fetches models once; for offline machines copy `~/.paddleocr/` from a connected machine |
| Both members' migrations conflict | Only Person A creates Alembic revisions; Person B pulls and runs `alembic upgrade head` |
