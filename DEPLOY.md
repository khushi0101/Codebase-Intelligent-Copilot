# Deploying the public demo ($0)

The goal is one link for your portfolio, where a visitor can ask questions about a
pre-indexed repo right away, or paste any public GitHub repo, **without you paying for anything**.

```
Browser ──► Cloudflare Pages (React UI + /api proxy function)
                 │  adds X-Proxy-Secret + visitor IP
                 ▼
            Hugging Face Space (Docker: FastAPI + the Python RAG pipeline)
                 ├─► Neon Postgres + pgvector (free tier)
                 └─► Gemini API (free-tier key, no billing linked)
```

| Piece | Free tier | Notes |
|---|---|---|
| Cloudflare Pages | Unlimited static requests, 100k Function calls/day | Serves the UI; `/api/*` is proxied by `web/functions/api/[[path]].js` |
| Hugging Face Spaces | CPU Basic: 2 vCPU, 16 GB RAM | Sleeps after ~48 h idle; the first visit then takes ~1 min (the UI shows "Waking up…") |
| Neon | 0.5 GB storage | pgvector included. A few hundred repos' worth of embeddings |
| Gemini | Free-tier quota | **Create the key in a Google Cloud project with no billing account.** It then can't incur charges; when quota runs out, requests fail with a friendly "add your own key" message |

## Why your Gemini key is safe

- The key lives only in the Space's **secrets**. It is never sent to the browser, and errors never echo it.
- **No billing account = no charges, by construction.** The worst case is the demo hitting its daily quota.
- Per-visitor limits (`CODECOPILOT_QUESTIONS_PER_HOUR`, default 12) plus a global daily cap
  (`CODECOPILOT_DAILY_QUESTION_CAP`, default 200) keep one visitor from draining the quota.
- Visitors can paste **their own** Gemini key in Settings. It's stored in their browser, sent per request,
  and never stored or logged by the server.
- The backend refuses any request that doesn't come through your Cloudflare proxy (`PROXY_SECRET`),
  so nobody can skip the rate limits by calling the Space directly.

**What each visitor sees:** the shared demo repos (`CODECOPILOT_DEMO_REPOS`) plus only the repos *they*
added. Each browser gets a random anonymous ID; the server stores only a hash of it as the repo's owner.
Another visitor's repos, indexing jobs and Insights traces return 404, exactly like a repo that doesn't
exist. If two visitors add the same public repo, it's indexed once and appears in both lists. Your laptop's
repos never reach the deployed site: it starts from an empty database and indexes only the demo repos.

Also enforced in public mode: repos come **only from public GitHub URLs** (never server folders); only
`.py` files are downloaded, nothing is executed, symlinks and path traversal are skipped; repo size and
file count are capped; delete/rebuild need `CODECOPILOT_ADMIN_TOKEN`; visitor repos are capped
(`MAX_USER_REPOS`, oldest evicted) and cleared on restart.

> Gemini's free tier may use prompts to improve Google's products. Here that's code from public
> GitHub repos only, but keep it in mind before pointing the demo at anything sensitive.

---

## 1. Database: Neon (5 min)

1. Sign up at [neon.tech](https://neon.tech) and create a project (any region close to the Space; US East pairs well).
2. Open the **SQL Editor** and run [`schema.sql`](schema.sql).
3. Copy the **connection string** (Dashboard → Connect). It looks like
   `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`.

## 2. Gemini key, free and unbillable (2 min)

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → **Create API key** → *create in a new project*.
2. Don't attach billing to that project. AI Studio will show the key as **Free tier**.

## 3. Backend: Hugging Face Space (10 min)

1. Sign up at [huggingface.co](https://huggingface.co) → **New Space** → SDK **Docker** → *Blank* → CPU Basic (free) → **Public**.
2. Upload the two files from [`deploy/huggingface/`](deploy/huggingface/) (`Dockerfile`, `README.md`) to the Space
   (Files → Add file → Upload). The Dockerfile builds straight from this GitHub repo's `main` branch.
3. Space **Settings → Variables and secrets**:

   | Name | Type | Value |
   |---|---|---|
   | `GEMINI_API_KEY` | Secret | your free-tier key |
   | `CODECOPILOT_DATABASE_URL` | Secret | the Neon connection string |
   | `CODECOPILOT_PROXY_SECRET` | Secret | a long random string, e.g. `openssl rand -hex 32` |
   | `CODECOPILOT_ADMIN_TOKEN` | Secret | another random string (only you use it) |
   | `CODECOPILOT_DEMO_REPOS` | Variable | `https://github.com/khushi0101/Codebase-Intelligent-Copilot` (comma-separate more) |
   | `CODECOPILOT_SOURCE_URL` | Variable | `https://github.com/khushi0101/Codebase-Intelligent-Copilot` |

4. The Space builds (~5 min). When it shows **Running**, note its URL: `https://<user>-<space>.hf.space`.
   Visiting `/api/health` there should return `{"detail":"Forbidden"}`. That's the proxy secret doing its job.

## 4. Frontend: Cloudflare Pages (5 min)

1. Push this repo to GitHub (the `web/` folder must be in it).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
3. Build settings:
   - Framework preset: **None**
   - Root directory: `web`
   - Build command: `npm run build`
   - Build output directory: `dist`
4. **Environment variables** (Production):

   | Name | Value |
   |---|---|
   | `VITE_HOSTED` | `1` |
   | `BACKEND_URL` | `https://<user>-<space>.hf.space` |
   | `PROXY_SECRET` | the same value as `CODECOPILOT_PROXY_SECRET` (mark it **Encrypt**) |

5. Deploy. Your link is `https://<project>.pages.dev`. Put that in your portfolio and resume.
   (Optional: add a custom domain under the project's **Custom domains** tab.)

Every push to `main` now redeploys the UI automatically. To redeploy the backend, use
**Factory rebuild** in the Space settings.

## Checking it

- Open the Pages URL. The demo repo should be selected and ready within a few seconds of the Space waking.
- Ask a question; citations should be green (verified) and clickable.
- Repositories → paste `https://github.com/pallets/itsdangerous` → it should index in a few seconds.

## Tuning (all optional, as Space variables)

| Variable | Default | |
|---|---|---|
| `CODECOPILOT_QUESTIONS_PER_HOUR` | 12 | per visitor, shared key |
| `CODECOPILOT_DAILY_QUESTION_CAP` | 200 | all visitors, shared key; keep below your Gemini free-tier daily limit |
| `CODECOPILOT_INDEX_JOBS_PER_HOUR` | 3 | per visitor |
| `CODECOPILOT_MAX_PY_FILES` | 300 | per repo |
| `CODECOPILOT_MAX_REPO_MB` | 50 | per repo (GitHub-reported size) |
| `CODECOPILOT_MAX_USER_REPOS` | 15 | oldest visitor repo is evicted beyond this |
| `CODECOPILOT_GITHUB_TOKEN` | – | a fine-grained token with **no** permissions raises the GitHub API limit from 60 to 5,000/h |

## Running the same container elsewhere

The root [`Dockerfile`](Dockerfile) builds the same image from a local checkout (UI included):

```bash
docker build -t codecopilot .
docker run -p 7860:7860 \
  -e GEMINI_API_KEY=... \
  -e CODECOPILOT_DATABASE_URL=postgresql://... \
  -e CODECOPILOT_DEMO_REPOS=https://github.com/khushi0101/Codebase-Intelligent-Copilot \
  codecopilot
# open http://localhost:7860  (without PROXY_SECRET set, the API accepts direct requests)
```

This works on Render, Fly.io, or Railway too, but their free tiers are too small for the
embedding model, which is why Hugging Face Spaces is the default here.
