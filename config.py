"""Typed, centralized configuration — read once here instead of hardcoding
model names, DB credentials, and retrieval knobs across the codebase.

Values come from environment variables (loaded from .env), namespaced with
a CODECOPILOT_ prefix on purpose: generic names like DB_HOST or DB_USER are
exactly the kind of variable another project on your machine might already
export in your shell/conda env, and python-dotenv does NOT override an
already-set environment variable — it silently loses to it. Namespacing
avoids that collision instead of fighting it."""

import os
from dotenv import load_dotenv

load_dotenv()


def _env(name, default=None):
    return os.getenv(f"CODECOPILOT_{name}", default)


# --- Database ---
DB_USER = _env("DB_USER", "khushiagrawal")
DB_PASSWORD = _env("DB_PASSWORD", "")
DB_HOST = _env("DB_HOST", "localhost")
DB_PORT = _env("DB_PORT", "5432")
DB_NAME = _env("DB_NAME", "codebase_copilot")

# --- Models ---
GEMINI_MODEL = _env("GEMINI_MODEL", "gemini-2.5-flash")
EMBEDDING_MODEL = _env("EMBEDDING_MODEL", "all-MiniLM-L6-v2")

# --- Retrieval ---
RETRIEVAL_K = int(_env("RETRIEVAL_K", "5"))
FINAL_K = int(_env("FINAL_K", "5"))

# --- Prompting ---
PROMPT_VERSION = _env("PROMPT_VERSION", "answer_v1")

# --- Tracing ---
TRACE_LOG_PATH = _env("TRACE_LOG_PATH", "traces.jsonl")

# --- Database (hosted) ---
# A full connection string (e.g. Neon's "postgresql://...?sslmode=require") takes
# precedence over the individual DB_* fields above when set.
DATABASE_URL = _env("DATABASE_URL")

# --- Public (hosted demo) mode ---
# Off by default: the local app trusts whoever is at the keyboard. On a public
# server it must not index arbitrary server folders, delete repos, or let one
# visitor burn through the owner's Gemini quota.
PUBLIC_MODE = _env("PUBLIC_MODE", "0") == "1"
REPOS_DIR = _env("REPOS_DIR", "/tmp/codecopilot-repos")      # where GitHub repos are downloaded
DEMO_REPOS = [u.strip() for u in _env("DEMO_REPOS", "").split(",") if u.strip()]
SOURCE_URL = _env("SOURCE_URL", "")                          # "view source" link shown in the UI
MAX_REPO_MB = int(_env("MAX_REPO_MB", "50"))                 # GitHub-reported repo size cap
MAX_PY_FILES = int(_env("MAX_PY_FILES", "300"))
MAX_USER_REPOS = int(_env("MAX_USER_REPOS", "15"))           # oldest visitor repo is evicted beyond this
QUESTIONS_PER_HOUR = int(_env("QUESTIONS_PER_HOUR", "12"))   # per visitor, on the shared key
DAILY_QUESTION_CAP = int(_env("DAILY_QUESTION_CAP", "200"))  # all visitors, on the shared key
INDEX_JOBS_PER_HOUR = int(_env("INDEX_JOBS_PER_HOUR", "3"))  # per visitor
PROXY_SECRET = _env("PROXY_SECRET")                          # shared with the Cloudflare Pages proxy
ADMIN_TOKEN = _env("ADMIN_TOKEN")                            # unlocks delete/rebuild in public mode
GITHUB_TOKEN = _env("GITHUB_TOKEN")                          # optional: raises GitHub API rate limit
