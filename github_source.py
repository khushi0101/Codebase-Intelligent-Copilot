"""Fetch a public GitHub repository for indexing, safely enough to run on a
public server.

Uses the tarball endpoint instead of `git clone`: no git binary, no hooks, no
submodules or LFS. Only regular `.py` files are extracted. Symlinks, devices,
absolute paths and `..` components are skipped, and size limits are enforced
while streaming, so a hostile repo can't fill the disk or escape the target
folder. Nothing from the repo is ever executed."""

import io
import json
import os
import re
import shutil
import tarfile
import tempfile
import urllib.error
import urllib.request

from config import GITHUB_TOKEN, MAX_PY_FILES, MAX_REPO_MB, REPOS_DIR

GITHUB_URL_RE = re.compile(
    r"^(?:https?://)?(?:www\.)?github\.com/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:/(?:tree|blob)/[^?#]*)?/?(?:[?#].*)?$"
)
SHORT_RE = re.compile(r"^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/([A-Za-z0-9._-]{1,100})$")
MAX_PY_FILE_BYTES = 1_000_000


class SourceError(Exception):
    """A user-facing problem with the requested repository."""


def parse_github_url(text):
    """'https://github.com/owner/repo', 'github.com/owner/repo(.git)' or 'owner/repo'
    -> (owner, repo), or None if it isn't a GitHub repo reference."""
    text = text.strip()
    m = GITHUB_URL_RE.match(text) or SHORT_RE.match(text)
    if not m:
        return None
    owner, repo = m.group(1), m.group(2)
    if repo.endswith(".git"):
        repo = repo[:-4]
    if repo in ("", ".", ".."):
        return None
    return owner, repo


def canonical_url(owner, repo):
    return f"https://github.com/{owner}/{repo}"


def local_path_for(owner, repo):
    return os.path.join(REPOS_DIR, f"{owner}__{repo}".lower())


def _request(url, timeout=20):
    headers = {"User-Agent": "codebase-copilot", "Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout)


def repo_metadata(owner, repo):
    try:
        with _request(f"https://api.github.com/repos/{owner}/{repo}") as res:
            meta = json.load(res)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise SourceError(f"github.com/{owner}/{repo} wasn't found. It may be private or misspelled; only public repositories are supported.")
        if e.code in (403, 429):
            raise SourceError("GitHub's API rate limit was hit. Please try again in a few minutes.")
        raise SourceError(f"GitHub returned an error ({e.code}).")
    except urllib.error.URLError:
        raise SourceError("Couldn't reach GitHub. Please try again.")

    if meta.get("private"):
        raise SourceError("Only public repositories are supported.")
    size_mb = meta.get("size", 0) / 1024
    if size_mb > MAX_REPO_MB:
        raise SourceError(f"That repository is {size_mb:.0f} MB; the limit here is {MAX_REPO_MB} MB.")
    return meta


def _safe_member_path(name):
    # tarball entries look like "owner-repo-<sha>/pkg/mod.py"; drop the top folder
    parts = name.split("/")[1:]
    if not parts or any(p in ("", ".", "..") for p in parts) or name.startswith("/"):
        return None
    return os.path.join(*parts)


def download_repo(owner, repo, on_progress=None):
    """Download (or refresh) owner/repo into REPOS_DIR, keeping only .py files.
    Replaces the folder atomically so incremental re-indexing sees a consistent
    snapshot. Returns (local_path, metadata)."""
    emit = on_progress or (lambda event: None)
    emit({"type": "stage", "message": f"Checking github.com/{owner}/{repo}"})
    meta = repo_metadata(owner, repo)
    branch = meta.get("default_branch", "main")

    emit({"type": "stage", "message": f"Downloading {owner}/{repo}@{branch}"})
    max_bytes = MAX_REPO_MB * 1024 * 1024 * 2  # compressed tarball can't legitimately exceed this
    buf = io.BytesIO()
    try:
        with _request(f"https://api.github.com/repos/{owner}/{repo}/tarball/{branch}", timeout=60) as res:
            while True:
                block = res.read(1 << 16)
                if not block:
                    break
                buf.write(block)
                if buf.tell() > max_bytes:
                    raise SourceError(f"Download exceeded {MAX_REPO_MB} MB; the repository is too large.")
    except urllib.error.URLError:
        raise SourceError("Downloading the repository from GitHub failed. Please try again.")
    buf.seek(0)

    emit({"type": "stage", "message": "Extracting Python files"})
    os.makedirs(REPOS_DIR, exist_ok=True)
    staging = tempfile.mkdtemp(dir=REPOS_DIR, prefix=".staging-")
    count = 0
    try:
        with tarfile.open(fileobj=buf, mode="r:gz") as tar:
            for member in tar:
                if not member.isfile() or not member.name.endswith(".py") or member.size > MAX_PY_FILE_BYTES:
                    continue
                rel = _safe_member_path(member.name)
                if rel is None:
                    continue
                count += 1
                if count > MAX_PY_FILES:
                    raise SourceError(f"That repository has more than {MAX_PY_FILES} Python files; the limit here is {MAX_PY_FILES}.")
                dest = os.path.join(staging, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                src = tar.extractfile(member)
                with open(dest, "wb") as out:
                    shutil.copyfileobj(src, out)
        if count == 0:
            raise SourceError("No Python files were found in that repository. Only Python is supported right now.")

        target = local_path_for(owner, repo)
        old = None
        if os.path.exists(target):
            old = target + ".old"
            shutil.rmtree(old, ignore_errors=True)
            os.rename(target, old)
        os.rename(staging, target)
        if old:
            shutil.rmtree(old, ignore_errors=True)
        return target, {"default_branch": branch, "python_files": count, "description": meta.get("description"),
                        "stars": meta.get("stargazers_count")}
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
