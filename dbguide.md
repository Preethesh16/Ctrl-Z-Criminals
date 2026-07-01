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

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `sslmode` errors with Neon | Ensure `?sslmode=require` stays in the URL and scheme is `postgresql+psycopg://` |
| `pdf2image` "Unable to get page count" | Install poppler (see §4) |
| WeasyPrint import error | Install pango/cairo system libs (see §4) |
| PaddleOCR first-run download | It fetches models once; for offline machines copy `~/.paddleocr/` from a connected machine |
| Both members' migrations conflict | Only Person A creates Alembic revisions; Person B pulls and runs `alembic upgrade head` |
