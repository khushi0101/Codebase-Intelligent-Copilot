"""HTTP API for the web UI — a thin layer over the same modules the CLI uses
(retrieval, call graph, incremental indexing, tracing, evals). No retrieval
logic lives here; this file only shapes inputs/outputs for the browser.

Run with `codecopilot serve` (or `uvicorn api:app`) from the project root:
like the CLI, the keyword index, index-state files and trace log are
resolved relative to the working directory.

With CODECOPILOT_PUBLIC_MODE=1 (the hosted demo) repos come only from public
GitHub URLs, visitors are rate-limited on the shared Gemini key, and
destructive actions need CODECOPILOT_ADMIN_TOKEN."""

import glob
import hashlib
import json
import os
import re
import shutil
import sqlite3
import threading
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from tenacity import RetryError

import config
from ask import retrieve_context, ask_gemini_stream, get_function_info_from_chunk
from call_graph import build_call_graph, get_related_chunks
from db_connection import connection
from evaluation_loop import citation_is_valid
from evaluation_script import run_recall_eval
from incremental_index import (
    run_incremental_index,
    get_hash_file_path,
    load_previous_hashes,
)
from latency_report import percentile
from prompt_registry import PROMPTS_DIR, load_prompt_template
from read_repo import list_python_files
from search_query import vector_search, keyword_search
from ranking import reciprocal_rank_fusion
from github_source import SourceError, canonical_url, download_repo, local_path_for, parse_github_url

REGISTRY_PATH = "repos.json"
RRF_K = 60
WEB_DIST = Path(__file__).parent / "web" / "dist"

PUBLIC = config.PUBLIC_MODE


@asynccontextmanager
async def lifespan(_app):
    if PUBLIC:
        threading.Thread(target=prepare_public_instance, daemon=True).start()
    yield


app = FastAPI(title="Codebase Intelligence Copilot", lifespan=lifespan)


# ---------------------------------------------------------------- public-mode guards

@app.middleware("http")
async def require_proxy_secret(request: Request, call_next):
    """In public mode the API sits behind the Cloudflare Pages proxy, which adds
    a shared secret. Requests that bypass the proxy are refused, so the
    visitor IP it forwards (used for rate limits) can be trusted."""
    if PUBLIC and config.PROXY_SECRET and request.url.path.startswith("/api"):
        if request.headers.get("x-proxy-secret") != config.PROXY_SECRET:
            return JSONResponse({"detail": "Forbidden"}, status_code=403)
    return await call_next(request)


def client_ip(request: Request):
    if PUBLIC and config.PROXY_SECRET:
        # set by our Pages proxy from Cloudflare's own CF-Connecting-IP; only trusted
        # because the middleware above already verified the shared secret
        return request.headers.get("x-visitor-ip") or request.client.host
    forwarded = request.headers.get("x-forwarded-for")
    return forwarded.split(",")[0].strip() if forwarded else request.client.host


VISITOR_ID_RE = re.compile(r"^[A-Za-z0-9-]{16,64}$")


def viewer_of(request: Request):
    """Who is asking, for repo visibility. Local mode: one trusted user who sees
    everything (None). Public mode: a hash of the anonymous ID the browser
    generated, so the registry never stores the raw ID. A missing/invalid ID
    sees only the shared demo repos."""
    if not PUBLIC:
        return None
    vid = request.headers.get("x-visitor-id", "")
    if not VISITOR_ID_RE.match(vid):
        return ""
    return hashlib.sha256(vid.encode()).hexdigest()[:24]


def can_see(meta, viewer):
    return viewer is None or bool(meta.get("demo")) or (bool(viewer) and viewer in meta.get("owners", []))


def is_admin(request: Request):
    return bool(config.ADMIN_TOKEN) and request.headers.get("x-admin-token") == config.ADMIN_TOKEN


class RateLimiter:
    """In-memory sliding window per key. Good enough for a single-process demo
    server; resets on restart, which only ever errs in the visitor's favour."""

    def __init__(self, limit, window_s):
        self.limit, self.window_s = limit, window_s
        self.hits = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key):
        """Returns seconds until the next allowed call, or 0 (and records the hit)."""
        now = time.time()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > self.window_s:
                q.popleft()
            if len(q) >= self.limit:
                return int(self.window_s - (now - q[0])) + 1
            q.append(now)
            return 0


question_limiter = RateLimiter(config.QUESTIONS_PER_HOUR, 3600)
own_key_limiter = RateLimiter(60, 3600)  # own key: no quota to protect, just CPU
daily_cap = RateLimiter(config.DAILY_QUESTION_CAP, 86400)
index_limiter = RateLimiter(config.INDEX_JOBS_PER_HOUR, 3600)
eval_limiter = RateLimiter(3, 3600)


def enforce(limiter, key, what):
    wait = limiter.check(key)
    if wait:
        minutes = max(1, round(wait / 60))
        raise HTTPException(429, f"{what} Try again in about {minutes} min.")


# ---------------------------------------------------------------- repos

def repo_id_for(path):
    # same id scheme as incremental_index.get_hash_file_path, so state files map 1:1 to repos
    return hashlib.md5(path.encode("utf-8")).hexdigest()[:10]


def load_registry():
    if os.path.exists(REGISTRY_PATH):
        with open(REGISTRY_PATH) as f:
            return json.load(f)
    return {}


def save_registry(registry):
    with open(REGISTRY_PATH, "w") as f:
        json.dump(registry, f, indent=2)


_registry_lock = threading.Lock()


def update_registry(repo_id, **fields):
    with _registry_lock:
        registry = load_registry()
        registry.setdefault(repo_id, {}).update(fields)
        save_registry(registry)


def add_owner(repo_id, viewer):
    """Several visitors can add the same public repo: it's indexed once, and each
    of them (only) gets it in their list."""
    if not viewer:
        return
    with _registry_lock:
        registry = load_registry()
        meta = registry.setdefault(repo_id, {})
        owners = meta.setdefault("owners", [])
        if viewer not in owners:
            owners.append(viewer)
        meta["added_at"] = time.time()  # recency for eviction
        save_registry(registry)


def infer_repo_path(repo_id, file_paths):
    """Repos indexed from the CLI only leave an index_state_<id>.json behind.
    Recover the repo root by walking up from the files' common directory until
    the path hashes to the same id."""
    if not file_paths:
        return None
    candidate = os.path.commonpath(file_paths)
    if candidate in file_paths:
        candidate = os.path.dirname(candidate)
    while True:
        if repo_id_for(candidate) == repo_id:
            return candidate
        parent = os.path.dirname(candidate)
        if parent == candidate:
            return None
        candidate = parent


def like_prefix(path):
    """LIKE pattern for 'files under this directory', with wildcards escaped so
    a '_' in a folder name can't match a sibling directory."""
    escaped = path.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return escaped + os.sep + "%"


def chunk_stats(path):
    cursor = connection.cursor()
    try:
        cursor.execute(
            "SELECT COUNT(*), COUNT(DISTINCT file_path) FROM embeddings WHERE file_path LIKE %s ESCAPE '\\'",
            (like_prefix(path),),
        )
        chunks, files_with_chunks = cursor.fetchone()
        connection.commit()
        return chunks, files_with_chunks
    except Exception:
        connection.rollback()
        return None, None
    finally:
        cursor.close()


def list_repos(viewer):
    """Repos `viewer` may see (see viewer_of). Required argument on purpose:
    a new endpoint that forgets it fails loudly instead of leaking repos."""
    registry = load_registry()
    repos = {}

    for state_file in glob.glob("index_state_*.json"):
        repo_id = state_file[len("index_state_"):-len(".json")]
        if PUBLIC and repo_id not in registry:
            continue
        hashes = load_previous_hashes(state_file)
        path = registry.get(repo_id, {}).get("path") or infer_repo_path(repo_id, list(hashes))
        if not path:
            continue
        repos[repo_id] = {"id": repo_id, "path": path, "indexed": True, "file_count": len(hashes),
                          "state_updated_at": os.path.getmtime(state_file)}

    for repo_id, meta in registry.items():
        repos.setdefault(repo_id, {"id": repo_id, "path": meta["path"], "indexed": False, "file_count": 0,
                                   "state_updated_at": None})

    if PUBLIC:
        repos = {rid: r for rid, r in repos.items() if can_see(registry.get(rid, {}), viewer)}

    for repo_id, repo in repos.items():
        meta = registry.get(repo_id, {})
        repo["name"] = meta.get("name") or os.path.basename(repo["path"].rstrip(os.sep)) or repo["path"]
        repo["exists"] = os.path.isdir(repo["path"])
        repo["last_indexed_at"] = meta.get("last_indexed_at") or repo["state_updated_at"]
        repo["last_summary"] = meta.get("last_summary")
        repo["source_url"] = meta.get("source_url")
        repo["demo"] = bool(meta.get("demo"))
        repo["added_at"] = meta.get("added_at")
        if PUBLIC:
            # the server's folder layout is an implementation detail; show the GitHub URL instead
            repo["path"] = repo["source_url"] or repo["name"]
        repo["chunk_count"], _ = chunk_stats(meta.get("path") or repo["path"])
        repo["indexing"] = any(j["repo_id"] == repo_id and j["status"] == "running" for j in JOBS.values())

    return sorted(repos.values(), key=lambda r: (not r["demo"], r["name"].lower()))


def get_repo(repo_id, viewer):
    """Repo dict whose "path" is the real folder on this server (list_repos may
    swap it for the GitHub URL in public mode). 404 for repos `viewer` can't
    see, the same as for repos that don't exist, so IDs can't be probed."""
    registry = load_registry()
    for repo in list_repos(viewer):
        if repo["id"] == repo_id:
            if repo_id in registry:
                repo = {**repo, "path": registry[repo_id]["path"]}
            return repo
    raise HTTPException(404, f"Unknown repository '{repo_id}'")


def rel(path, repo_path):
    try:
        return os.path.relpath(path, repo_path)
    except ValueError:
        return path


# ---------------------------------------------------------------- indexing jobs

JOBS = {}
_index_lock = threading.Lock()


def start_index_job(repo_id, path, full=False, github=None, wait=False, owner=None):
    """github=(owner, repo) downloads a fresh snapshot first, then indexes it
    incrementally, so a re-index of a GitHub repo only re-embeds changed files."""
    if not _index_lock.acquire(blocking=wait):
        raise HTTPException(409, "Another repository is being indexed right now. Please try again in a minute.")

    display_path = canonical_url(*github) if github else path
    job = {"id": uuid.uuid4().hex[:12], "repo_id": repo_id, "owner": owner, "path": display_path, "full": full,
           "status": "running", "events": [], "summary": None, "error": None,
           "started_at": time.time(), "finished_at": None}
    JOBS[job["id"]] = job

    def on_progress(event):
        if "path" in event:
            event = {**event, "path": rel(event["path"], path)}
        job["events"].append({**event, "t": time.time()})

    def run():
        try:
            if github:
                download_repo(*github, on_progress=on_progress)
            summary = run_incremental_index(path, on_progress=on_progress, full=full)
            job["summary"] = summary
            job["status"] = "done"
            update_registry(repo_id, path=path, last_indexed_at=time.time(), last_summary=summary)
        except SourceError as e:
            job["status"] = "error"
            job["error"] = str(e)
            if github and not load_registry().get(repo_id, {}).get("last_indexed_at"):
                remove_from_registry(repo_id)  # never indexed: don't leave a broken card behind
        except Exception as e:
            job["status"] = "error"
            job["error"] = "Indexing failed unexpectedly." if PUBLIC else str(e)
            print(f"Index job {job['id']} failed: {e}")
        finally:
            job["finished_at"] = time.time()
            _index_lock.release()

    if wait:
        run()
    else:
        threading.Thread(target=run, daemon=True).start()
    return job


def remove_from_registry(repo_id):
    with _registry_lock:
        registry = load_registry()
        registry.pop(repo_id, None)
        save_registry(registry)


def purge_repo_index(path):
    """Delete every chunk under `path` from both stores, plus its state file."""
    pattern = like_prefix(path)
    cursor = connection.cursor()
    try:
        cursor.execute("DELETE FROM embeddings WHERE file_path LIKE %s ESCAPE '\\'", (pattern,))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()

    conn = sqlite3.connect("keyword_index.db")
    try:
        conn.execute("DELETE FROM chunks_fts WHERE file_path LIKE ? ESCAPE '\\'", (pattern,))
        conn.commit()
    except sqlite3.OperationalError:
        pass  # no keyword table yet
    finally:
        conn.close()

    state_file = get_hash_file_path(path)
    if os.path.exists(state_file):
        os.remove(state_file)


def remove_repo(repo_id, path):
    purge_repo_index(path)
    if os.path.realpath(path).startswith(os.path.realpath(config.REPOS_DIR) + os.sep):
        shutil.rmtree(path, ignore_errors=True)  # only ever delete folders we downloaded
    remove_from_registry(repo_id)


def evict_old_user_repos():
    """Keep public-instance storage bounded: drop the oldest visitor repos."""
    registry = load_registry()
    user = sorted((m.get("added_at") or 0, rid) for rid, m in registry.items() if not m.get("demo"))
    for _, rid in user[: max(0, len(user) - config.MAX_USER_REPOS)]:
        remove_repo(rid, registry[rid]["path"])


def prepare_public_instance():
    """Hosted disks are ephemeral: start from a clean slate for everything this
    instance downloads (only paths under REPOS_DIR, never anything else), then
    index the demo repos so visitors can ask right away."""
    try:
        purge_repo_index(config.REPOS_DIR)
    except Exception as e:
        print(f"Startup purge failed: {e}")
    with _registry_lock:
        save_registry({})
    for url in config.DEMO_REPOS:
        parsed = parse_github_url(url)
        if not parsed:
            print(f"Skipping invalid DEMO_REPOS entry: {url}")
            continue
        path = local_path_for(*parsed)
        repo_id = repo_id_for(path)
        update_registry(repo_id, path=path, source_url=canonical_url(*parsed), name=parsed[1], demo=True,
                        added_at=time.time())
        start_index_job(repo_id, path, github=parsed, wait=True)


# ---------------------------------------------------------------- serialization

def chunk_function_name(text):
    first_line = text.strip().split("\n")[0]
    m = re.match(r"(?:async\s+)?def\s+(\w+)", first_line)
    return m.group(1) if m else None


def serialize_tuple_chunk(chunk, repo_path):
    file_path, start_line, end_line, text = chunk[0], chunk[1], chunk[2], chunk[3]
    out = {"file_path": file_path, "rel_path": rel(file_path, repo_path), "start_line": start_line,
           "end_line": end_line, "text": text, "function_name": chunk_function_name(text)}
    if len(chunk) > 4:
        out["distance"] = float(chunk[4])
    return out


def serialize_dict_chunk(chunk, repo_path, label=None):
    return {"file_path": chunk["file_path"], "rel_path": rel(chunk["file_path"], repo_path),
            "start_line": chunk["start_line"], "end_line": chunk["end_line"], "text": chunk["text"],
            "function_name": chunk.get("function_name"), "label": label}


def with_provenance(chunks, vector_results, keyword_results, repo_path):
    """Annotate fused chunks with where each one came from (vector rank/distance,
    BM25 rank) and its RRF score, so the UI can show *why* it was retrieved."""
    vector_rank = {(c[0], c[1], c[2]): (i, float(c[4])) for i, c in enumerate(vector_results, start=1)}
    keyword_rank = {(c[0], c[1], c[2]): i for i, c in enumerate(keyword_results, start=1)}

    out = []
    for chunk in chunks:
        key = (chunk[0], chunk[1], chunk[2])
        item = serialize_tuple_chunk(chunk, repo_path)
        item.pop("distance", None)
        v = vector_rank.get(key)
        k = keyword_rank.get(key)
        item["vector_rank"] = v[0] if v else None
        item["vector_distance"] = v[1] if v else None
        item["keyword_rank"] = k
        item["rrf_score"] = (1 / (RRF_K + v[0]) if v else 0) + (1 / (RRF_K + k) if k else 0)
        out.append(item)
    return out


# Leftmost match may swallow preceding words ("defined in ask.py:3"), since paths
# can contain spaces; resolve_citation trims words off the front until it hits a real file.
CITATION_RE = re.compile(r"([\w\-./ ]*?[\w\-]+\.py):(\d+)(?:\s*[-–]\s*(\d+))?")


def resolve_citation(candidate, known_files, repo_path):
    words = candidate.split(" ")
    for i in range(len(words)):
        cand = " ".join(words[i:]).strip()
        if not cand:
            continue
        norm = cand[2:] if cand.startswith("./") else cand
        if os.path.isabs(norm) and norm in known_files:
            return cand, norm
        full = os.path.join(repo_path, norm)
        if full in known_files:
            return cand, full
        suffix_matches = [f for f in known_files if f.endswith(os.sep + norm)]
        if len(suffix_matches) == 1:
            return cand, suffix_matches[0]
    return None, None


def extract_answer_citations(answer, repo_path, provided_chunks):
    known_files = set(list_python_files(repo_path))
    citations, seen = [], set()
    for m in CITATION_RE.finditer(answer):
        raw_path, file_path = resolve_citation(m.group(1), known_files, repo_path)
        if not file_path:
            continue
        start = int(m.group(2))
        end = int(m.group(3)) if m.group(3) else start
        raw = m.group(0)[m.group(0).index(raw_path):]
        if raw in seen:
            continue
        seen.add(raw)
        citation = {"file_path": file_path, "start_line": start, "end_line": end}
        citations.append({**citation, "raw": raw, "rel_path": rel(file_path, repo_path),
                          "valid": citation_is_valid(citation, provided_chunks)})
    return citations


def sse(event):
    return f"data: {json.dumps(event)}\n\n"


# ---------------------------------------------------------------- endpoints

class AddRepoRequest(BaseModel):
    path: str


class IndexRequest(BaseModel):
    full: bool = False


class AskRequest(BaseModel):
    question: str
    repo_id: str
    retrieval_k: int = Field(default=config.RETRIEVAL_K, ge=1, le=50)
    final_k: int = Field(default=config.FINAL_K, ge=1, le=50)
    expand_graph: bool = True


class SearchRequest(BaseModel):
    query: str
    repo_id: str
    k: int = Field(default=config.RETRIEVAL_K, ge=1, le=50)


class EvalRequest(BaseModel):
    repo_id: str
    ks: list[int] = [3, 5, 10]


@app.get("/api/health")
def health():
    db_ok = True
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        connection.commit()
    except Exception:
        connection.rollback()
        db_ok = False
    return {
        "database": db_ok,
        "llm_key": bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")),
        "llm_model": config.GEMINI_MODEL,
        "embedding_model": config.EMBEDDING_MODEL,
        "prompt_version": config.PROMPT_VERSION,
        "public": PUBLIC,
        "source_url": config.SOURCE_URL or None,
        "limits": {"max_py_files": config.MAX_PY_FILES, "max_repo_mb": config.MAX_REPO_MB,
                   "questions_per_hour": config.QUESTIONS_PER_HOUR} if PUBLIC else None,
    }


@app.get("/api/config")
def get_config():
    versions = sorted(p.stem for p in PROMPTS_DIR.glob("*.txt"))
    if PUBLIC:
        database = "Managed Postgres + pgvector"
    elif config.DATABASE_URL:
        database = "CODECOPILOT_DATABASE_URL"
    else:
        database = f"{config.DB_USER}@{config.DB_HOST}:{config.DB_PORT}/{config.DB_NAME}"
    settings = {
        "Database": database,
        "LLM model": config.GEMINI_MODEL,
        "Embedding model": config.EMBEDDING_MODEL,
        "Retrieval k (per retriever)": config.RETRIEVAL_K,
        "Final k (after fusion)": config.FINAL_K,
        "RRF constant": RRF_K,
        "Prompt version": config.PROMPT_VERSION,
    }
    if not PUBLIC:
        settings["Trace log"] = os.path.abspath(config.TRACE_LOG_PATH)
        settings["Keyword index"] = os.path.abspath("keyword_index.db")
    return {
        "settings": settings,
        "defaults": {"retrieval_k": config.RETRIEVAL_K, "final_k": config.FINAL_K},
        "prompt_versions": versions,
        "prompts": {v: load_prompt_template(v) for v in versions},
    }


@app.get("/api/repos")
def api_list_repos(request: Request):
    return list_repos(viewer_of(request))


@app.post("/api/repos")
def api_add_repo(req: AddRepoRequest, request: Request):
    is_local_dir = not PUBLIC and os.path.isdir(os.path.expanduser(req.path.strip()))
    github = None if is_local_dir else parse_github_url(req.path)
    viewer = viewer_of(request)
    if github:
        if PUBLIC and not viewer:
            raise HTTPException(400, "Missing visitor ID. Please reload the page.")
        path = local_path_for(*github)
        repo_id = repo_id_for(path)
        existing = load_registry().get(repo_id)
        if existing and existing.get("last_indexed_at"):
            add_owner(repo_id, viewer)
            return {"repo_id": repo_id, "job_id": None}  # already indexed: just add it to this visitor's list
        running = next((j for j in JOBS.values() if j["repo_id"] == repo_id and j["status"] == "running"), None)
        if running:
            add_owner(repo_id, viewer)
            return {"repo_id": repo_id, "job_id": running["id"]}
        if PUBLIC:
            enforce(index_limiter, client_ip(request), "You've added several repositories recently.")
        update_registry(repo_id, path=path, source_url=canonical_url(*github), name=github[1],
                        demo=bool(existing and existing.get("demo")), added_at=time.time())
        add_owner(repo_id, viewer)
        job = start_index_job(repo_id, path, github=github, owner=viewer)
        if PUBLIC:
            evict_old_user_repos()
        return {"repo_id": repo_id, "job_id": job["id"]}

    if PUBLIC:
        raise HTTPException(400, "Paste a public GitHub repository URL, like https://github.com/owner/repo.")
    path = str(Path(req.path).expanduser().resolve())
    if not os.path.isdir(path):
        raise HTTPException(400, f"Not a directory or GitHub URL: {req.path}")
    repo_id = repo_id_for(path)
    update_registry(repo_id, path=path, added_at=time.time())
    job = start_index_job(repo_id, path)
    return {"repo_id": repo_id, "job_id": job["id"]}


@app.post("/api/repos/{repo_id}/index")
def api_index_repo(repo_id: str, req: IndexRequest, request: Request):
    repo = get_repo(repo_id, viewer_of(request))
    if PUBLIC and not is_admin(request):
        if req.full:
            raise HTTPException(403, "Full rebuilds are disabled on the public demo.")
        enforce(index_limiter, client_ip(request), "You've re-indexed several times recently.")
    github = parse_github_url(repo["source_url"]) if repo.get("source_url") else None
    if not github and not repo["exists"]:
        raise HTTPException(400, f"Folder no longer exists: {repo['path']}")
    job = start_index_job(repo_id, repo["path"], full=req.full, github=github, owner=viewer_of(request))
    return {"job_id": job["id"]}


@app.delete("/api/repos/{repo_id}")
def api_delete_repo(repo_id: str, request: Request):
    if PUBLIC and not is_admin(request):
        raise HTTPException(403, "Removing repositories is disabled on the public demo.")
    repo = get_repo(repo_id, None)
    if repo["indexing"]:
        raise HTTPException(409, "This repository is being indexed right now.")
    try:
        remove_repo(repo_id, repo["path"])
    except Exception as e:
        raise HTTPException(500, f"Failed to remove the index: {e}")
    return {"ok": True}


def job_visible(job, viewer):
    # owner None = system job (demo repos at startup), fine for anyone to see
    return viewer is None or job.get("owner") in (None, viewer)


@app.get("/api/jobs/{job_id}")
def api_job(job_id: str, request: Request):
    job = JOBS.get(job_id)
    if not job or not job_visible(job, viewer_of(request)):
        raise HTTPException(404, "Unknown job")
    return job


@app.get("/api/jobs")
def api_jobs(request: Request):
    viewer = viewer_of(request)
    jobs = [j for j in JOBS.values() if job_visible(j, viewer)]
    return sorted(jobs, key=lambda j: j["started_at"], reverse=True)[:20]


@app.get("/api/repos/{repo_id}/files")
def api_repo_files(repo_id: str, request: Request):
    repo = get_repo(repo_id, viewer_of(request))
    hashes = load_previous_hashes(get_hash_file_path(repo["path"]))

    functions = {}
    cursor = connection.cursor()
    try:
        cursor.execute(
            "SELECT file_path, start_line, end_line, split_part(sentence, E'\\n', 1) FROM embeddings "
            "WHERE file_path LIKE %s ESCAPE '\\' ORDER BY file_path, start_line",
            (like_prefix(repo["path"]),),
        )
        for file_path, start, end, first_line in cursor.fetchall():
            functions.setdefault(file_path, []).append(
                {"name": chunk_function_name(first_line) or first_line.strip()[:40], "start_line": start, "end_line": end}
            )
        connection.commit()
    except Exception:
        connection.rollback()
    finally:
        cursor.close()

    paths = sorted(set(hashes) | set(functions))
    return [{"file_path": p, "rel_path": rel(p, repo["path"]), "functions": functions.get(p, [])} for p in paths]


def safe_repo_file(repo, path):
    full = os.path.realpath(path if os.path.isabs(path) else os.path.join(repo["path"], path))
    root = os.path.realpath(repo["path"])
    if not full.startswith(root + os.sep) or not full.endswith(".py") or not os.path.isfile(full):
        raise HTTPException(404, "File not found in this repository")
    return full


@app.get("/api/repos/{repo_id}/file")
def api_repo_file(repo_id: str, path: str, request: Request):
    repo = get_repo(repo_id, viewer_of(request))
    full = safe_repo_file(repo, path)
    with open(full, encoding="utf-8", errors="replace") as f:
        content = f.read()
    return {"file_path": full, "rel_path": rel(full, repo["path"]), "content": content}


@app.get("/api/repos/{repo_id}/graph")
def api_repo_graph(repo_id: str, path: str, function: str, request: Request):
    repo = get_repo(repo_id, viewer_of(request))
    full = safe_repo_file(repo, path)
    function_index, callers_of = build_call_graph(repo["path"])
    target = function_index.get((full, function))
    if target is None:
        raise HTTPException(404, f"Function '{function}' not found in {rel(full, repo['path'])}")
    callees, callers = get_related_chunks(function_index, callers_of, full, function, max_each=50)

    def node(c):
        return {"file_path": c["file_path"], "rel_path": rel(c["file_path"], repo["path"]),
                "function_name": c["function_name"], "start_line": c["start_line"], "end_line": c["end_line"]}

    def unique(chunks):
        # a function that calls another twice shows up twice in the raw graph
        seen, out = set(), []
        for c in chunks:
            key = (c["file_path"], c["function_name"])
            if key not in seen:
                seen.add(key)
                out.append(node(c))
        return out

    unresolved = sorted(set(target["callees"]) - {c["function_name"] for c in callees})
    return {"function": node(target), "callees": unique(callees), "callers": unique(callers),
            "unresolved_calls": unresolved}


@app.post("/api/search")
def api_search(req: SearchRequest, request: Request):
    repo = get_repo(req.repo_id, viewer_of(request))
    start = time.perf_counter()
    vector_results = vector_search(req.query, repo["path"], top_k=req.k)
    keyword_results = keyword_search(req.query, repo["path"], top_k=req.k)
    fused = reciprocal_rank_fusion([vector_results, keyword_results])
    elapsed = (time.perf_counter() - start) * 1000
    return {
        "vector": [serialize_tuple_chunk(c, repo["path"]) for c in vector_results],
        "keyword": [serialize_tuple_chunk(c, repo["path"]) for c in keyword_results],
        "fused": with_provenance(fused, vector_results, keyword_results, repo["path"]),
        "latency_ms": elapsed,
    }


def friendly_llm_error(e, own_key):
    if isinstance(e, RetryError) and e.last_attempt.exception():
        e = e.last_attempt.exception()
    text = str(e)
    if "RESOURCE_EXHAUSTED" in text or "429" in text:
        if own_key:
            return "Your Gemini key has hit its rate limit. Wait a minute and try again."
        return ("The demo's free Gemini quota is used up for now. Add your own free key in Settings "
                "to keep going.")
    if "API_KEY_INVALID" in text or "API key not valid" in text:
        return "That Gemini API key was rejected. Check it in Settings." if own_key else "The server's Gemini key is invalid."
    return "The model call failed. Please try again." if PUBLIC else text


@app.post("/api/ask")
def api_ask(req: AskRequest, request: Request):
    repo = get_repo(req.repo_id, viewer_of(request))
    if not req.question.strip():
        raise HTTPException(400, "Question is empty")
    if len(req.question) > 2000:
        raise HTTPException(400, "Question is too long (2,000 characters max).")

    user_key = (request.headers.get("x-gemini-key") or "").strip() or None
    if user_key and (len(user_key) > 200 or not user_key.isascii()):
        raise HTTPException(400, "That doesn't look like a Gemini API key.")
    if PUBLIC:
        ip = client_ip(request)
        if user_key:
            enforce(own_key_limiter, ip, "Too many questions in a short time.")
        else:
            enforce(question_limiter, ip, f"The shared demo key allows {config.QUESTIONS_PER_HOUR} questions per "
                                          "hour per visitor. Add your own free Gemini key in Settings to skip this limit.")
            enforce(daily_cap, "global", "The demo's daily question budget is used up. Add your own free Gemini key "
                                         "in Settings to keep going.")
    elif not user_key and not (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")):
        raise HTTPException(400, "No Gemini API key: set GEMINI_API_KEY in .env or add one in Settings.")

    def stream():
        try:
            context = retrieve_context(req.question, repo["path"], req.retrieval_k, req.final_k, req.expand_graph)
            yield sse({
                "type": "context",
                "sources": with_provenance(context["top_chunks"], context["vector_results"],
                                           context["keyword_results"], repo["path"]),
                "related": [serialize_dict_chunk(c, repo["path"], label) for c, label in context["related_chunks"]],
                "anchor": dict(zip(("file_path", "function_name"),
                                   get_function_info_from_chunk(context["top_chunks"][0])))
                if context["top_chunks"] else None,
                "retrieval_ms": context["retrieval_ms"],
            })

            answer_parts = []
            gen = ask_gemini_stream(req.question, repo["path"], context, req.retrieval_k, req.final_k, api_key=user_key)
            while True:
                try:
                    piece = next(gen)
                except StopIteration as stop:
                    stats = stop.value
                    break
                answer_parts.append(piece)
                yield sse({"type": "token", "text": piece})

            answer = "".join(answer_parts)
            provided = list(context["top_chunks"]) + [
                (c["file_path"], c["start_line"], c["end_line"], c["text"]) for c, _ in context["related_chunks"]
            ]
            citations = extract_answer_citations(answer, repo["path"], provided)
            yield sse({
                "type": "done",
                "citations": citations,
                "stats": {**stats, "retrieval_ms": context["retrieval_ms"],
                          "total_ms": context["retrieval_ms"] + stats["generation_ms"]},
            })
        except Exception as e:
            print(f"/api/ask failed: {type(e).__name__}")  # never log the exception text: it can echo the key
            yield sse({"type": "error", "message": friendly_llm_error(e, bool(user_key))})

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/traces")
def api_traces(request: Request, limit: int = 200, repo_id: Optional[str] = None):
    records = []
    try:
        with open(config.TRACE_LOG_PATH) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        records.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
    except FileNotFoundError:
        pass

    viewer = viewer_of(request)
    if repo_id:
        get_repo(repo_id, viewer)  # 404 unless visible
        records = [r for r in records if r.get("repo_path") and repo_id_for(r["repo_path"]) == repo_id]
    elif PUBLIC:
        visible = {r["id"] for r in list_repos(viewer)}
        records = [r for r in records if r.get("repo_path") and repo_id_for(r["repo_path"]) in visible]

    def stats(field):
        values = [r[field] for r in records if isinstance(r.get(field), (int, float))]
        if not values:
            return None
        return {"n": len(values), "p50": percentile(values, 50), "p95": percentile(values, 95),
                "mean": sum(values) / len(values)}

    return {
        "count": len(records),
        "latency": {"total": stats("total_latency_ms"), "retrieval": stats("retrieval_latency_ms"),
                    "generation": stats("generation_latency_ms")},
        "tokens": {"input": stats("input_tokens"), "output": stats("output_tokens")},
        "records": records[-limit:][::-1],
    }


@app.post("/api/eval/recall")
def api_eval_recall(req: EvalRequest, request: Request):
    if PUBLIC:
        enforce(eval_limiter, client_ip(request), "The evaluation was run several times recently.")
    repo = get_repo(req.repo_id, viewer_of(request))
    ks = sorted(set(k for k in req.ks if 1 <= k <= 50)) or [3, 5, 10]
    start = time.perf_counter()
    result = run_recall_eval(ks=ks, repo_path=repo["path"])
    result["ks"] = ks
    result["elapsed_ms"] = (time.perf_counter() - start) * 1000
    return result


# ---------------------------------------------------------------- built UI (web/dist)

if WEB_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        candidate = WEB_DIST / full_path
        if full_path and candidate.is_file() and WEB_DIST in candidate.resolve().parents:
            return FileResponse(candidate)
        return FileResponse(WEB_DIST / "index.html")
