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
