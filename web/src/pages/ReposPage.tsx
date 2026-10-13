import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, FolderGit2, FolderPlus, Hammer, RefreshCw, Trash2, X } from "lucide-react";
import { api, type Job, type Repo } from "../lib/api";
import { useApp } from "../lib/app-context";
import { fmtAgo, fmtMs } from "../lib/format";
import { EmptyState, PageHeader, Spinner } from "../components/ui";

function JobPanel({ job, onClose }: { job: Job; onClose: () => void }) {
  const start = [...job.events].reverse().find((e) => e.type === "start");
  const files = job.events.filter((e) => e.type === "file");
  const total = start?.changed_files ?? 0;
  const pct = job.status === "done" ? 100 : total ? Math.round((files.length / total) * 100) : 4;
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job.events.length]);

  const elapsed = ((job.finished_at ?? Date.now() / 1000) - job.started_at) * 1000;

  return (
    <div className={`card job ${job.status}`}>
      <div className="job-head">
        {job.status === "running" ? (
          <Spinner size={16} />
        ) : job.status === "done" ? (
          <CheckCircle2 size={18} className="good-text" />
        ) : (
          <AlertTriangle size={18} className="error-text" />
        )}
        <div className="job-title">
          <strong>
            {job.status === "running" && !start
              ? [...job.events].reverse().find((e) => e.type === "stage")?.message ?? "Starting…"
              : job.status === "running"
              ? job.full
                ? "Rebuilding index…"
                : "Indexing…"
              : job.status === "done"
                ? "Index up to date"
                : "Indexing failed"}
          </strong>
          <span className="mono muted small truncate">{job.path}</span>
        </div>
        <span className="muted small">{fmtMs(elapsed)}</span>
        {job.status !== "running" && (
          <button className="icon-btn sm" onClick={onClose} aria-label="Dismiss">
            <X size={15} />
          </button>
        )}
      </div>

      <div className="progress">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="job-stats">
        {start ? (
          <>
            <span>{start.total_files} Python files</span>
            <span>
              {files.length}/{start.changed_files} changed or new re-indexed
            </span>
            <span>{start.deleted_files} deleted</span>
            <span>{files.reduce((n, f) => n + (f.chunks ?? 0), 0)} functions embedded</span>
          </>
        ) : (
          <span className="muted">Scanning…</span>
        )}
      </div>
      {job.status === "done" && start && start.changed_files === 0 && start.deleted_files === 0 && (
        <div className="muted small">Nothing changed since the last run. Content hashes all match, so no work was needed.</div>
      )}
      {job.error && <div className="callout callout-error">{job.error}</div>}

      {files.length > 0 && (
        <div className="job-log" ref={logRef}>
          {job.events
            .filter((e) => e.type === "file" || e.type === "deleted")
            .map((e, i) => (
              <div key={i} className="job-log-row">
                <span className={e.type === "deleted" ? "error-text" : "good-text"}>{e.type === "deleted" ? "−" : "+"}</span>
                <span className="mono truncate">{e.path?.replace(job.path + "/", "")}</span>
                {e.type === "file" && <span className="muted">{e.chunks} fn</span>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function ConfirmRemove({ repo, onCancel, onConfirm }: { repo: Repo; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <h3>Remove {repo.name} from the index?</h3>
        <p className="muted">
          This deletes its {repo.chunk_count ?? 0} embedded functions from Postgres and the keyword index, plus its
          index-state file. Your source files are not touched. You can re-add it any time.
        </p>
        <div className="row gap-s end">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            <Trash2 size={15} /> Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReposPage() {
  const { repos, repo: selected, setRepoId, refreshRepos, toast, reposLoaded, health } = useApp();
  const isPublic = !!health?.public;
  const [params, setParams] = useSearchParams();
  const [path, setPath] = useState("");
  const [adding, setAdding] = useState(params.get("add") === "1");
  const [job, setJob] = useState<Job | null>(null);
  const [confirm, setConfirm] = useState<Repo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (params.get("add") === "1") setAdding(true);
  }, [params]);

  // Resume showing a job that is still running (e.g. after navigating away and back).
  useEffect(() => {
    api
      .jobs()
      .then((jobs) => {
        const running = jobs.find((j) => j.status === "running");
        if (running) setJob(running);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const t = setInterval(async () => {
      try {
        const next = await api.job(job.id);
        setJob(next);
        if (next.status !== "running") {
          refreshRepos();
          if (next.status === "done") toast(`Indexed ${next.path.split("/").pop()}`, "success");
          else toast(`Indexing failed: ${next.error}`, "error");
        }
      } catch {
        /* transient; keep polling */
      }
    }, 600);
    return () => clearInterval(t);
  }, [job?.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const startJob = async (fn: () => Promise<{ job_id: string }>, repoId?: string) => {
    try {
      const { job_id } = await fn();
      setJob(await api.job(job_id));
      if (repoId) setRepoId(repoId);
      refreshRepos();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;
    setSubmitting(true);
    try {
      const res = await api.addRepo(path.trim());
      setRepoId(res.repo_id);
      if (res.job_id) setJob(await api.job(res.job_id));
      else toast("Already indexed. Switched to it.", "success");
      setPath("");
      setAdding(false);
      setParams({}, { replace: true });
      refreshRepos();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (r: Repo) => {
    setConfirm(null);
    try {
      await api.deleteRepo(r.id);
      toast(`Removed ${r.name} from the index`, "success");
      refreshRepos();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const busy = job?.status === "running";

  return (
    <div className="page">
      <PageHeader
        title="Repositories"
        subtitle={
          isPublic
            ? `Index any public Python repository on GitHub (up to ${health?.limits?.max_py_files} .py files). Re-indexing is incremental: only files whose content hash changed are re-embedded.`
            : "Index a local folder or a public GitHub repository. Re-indexing is incremental: only files whose content hash changed are re-parsed and re-embedded."
        }
        actions={
          !adding && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <FolderPlus size={16} /> Add repository
            </button>
          )
        }
      />

      {adding && (
        <form className="card add-form" onSubmit={add}>
          <label className="field">
            <span className="field-label">{isPublic ? "Public GitHub repository" : "Folder path or GitHub URL"}</span>
            <input
              autoFocus
              className="input mono"
              placeholder={isPublic ? "https://github.com/owner/repo" : "~/code/my-project  or  https://github.com/owner/repo"}
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <span className="field-hint">
              {isPublic ? (
                <>
                  Only <code>.py</code> files are downloaded. Nothing in the repo is executed. Each function is parsed
                  with tree-sitter and embedded with a local model. Repositories added here are temporary and may be
                  cleared when the demo restarts.
                </>
              ) : (
                <>
                  Every <code>.py</code> file underneath is parsed with tree-sitter, and each function is embedded
                  locally. Nothing leaves your machine during indexing.
                </>
              )}
            </span>
          </label>
          <div className="row gap-s end">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setAdding(false);
                setParams({}, { replace: true });
              }}
            >
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!path.trim() || submitting || busy}>
              {submitting ? <Spinner size={14} /> : <FolderPlus size={15} />} Add &amp; index
            </button>
          </div>
        </form>
      )}

      {job && <JobPanel job={job} onClose={() => setJob(null)} />}

      {reposLoaded && repos.length === 0 && !adding && (
        <EmptyState
          icon={<FolderGit2 size={28} />}
          title="No repositories indexed"
          action={
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              Add your first repository
            </button>
          }
        >
          You can also index from the terminal with <code>codecopilot index</code>; those repos show up here
          automatically.
        </EmptyState>
      )}

      <div className="repo-grid">
        {repos.map((r) => (
          <div key={r.id} className={`card repo-card ${r.id === selected?.id ? "selected" : ""}`}>
            <div className="repo-card-head">
              <span className="repo-avatar">{r.name.slice(0, 1).toUpperCase()}</span>
              <div className="repo-card-title">
                <strong>{r.name}</strong>
                {r.source_url ? (
                  <a className="mono small truncate" href={r.source_url} target="_blank" rel="noreferrer" title={r.source_url}>
                    {r.source_url.replace("https://", "")} <ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="mono muted small truncate" title={r.path}>
                    {r.path}
                  </span>
                )}
              </div>
              {r.demo && <span className="pill">Demo</span>}
              {r.id === selected?.id ? (
                <span className="pill pill-accent">Active</span>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => setRepoId(r.id)}>
                  Use
                </button>
              )}
            </div>

            <div className="repo-stats">
              <div>
                <span className="repo-stat-value">{r.file_count}</span>
                <span className="muted small">files</span>
              </div>
              <div>
                <span className="repo-stat-value">{r.chunk_count ?? "—"}</span>
                <span className="muted small">functions</span>
              </div>
              <div>
                <span className="repo-stat-value small-value">{fmtAgo(r.last_indexed_at)}</span>
                <span className="muted small">last indexed</span>
              </div>
            </div>

            {!r.exists && !r.source_url && (
              <div className="callout callout-warn small">
                <AlertTriangle size={14} /> Folder not found on disk. It may have moved.
              </div>
            )}

            <div className="repo-actions">
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy || (!r.exists && !r.source_url)}
                onClick={() => startJob(() => api.indexRepo(r.id), r.id)}
                title={r.source_url ? "Pull the latest snapshot from GitHub and re-index changed files" : "Re-index only files whose content changed"}
              >
                <RefreshCw size={14} /> Update index
              </button>
              {!isPublic && (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy || (!r.exists && !r.source_url)}
                  onClick={() => startJob(() => api.indexRepo(r.id, true), r.id)}
                  title="Ignore saved hashes and re-embed every file"
                >
                  <Hammer size={14} /> Full rebuild
                </button>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setRepoId(r.id);
                  navigate("/");
                }}
                disabled={!r.indexed}
              >
                Ask
              </button>
              <span className="spacer" />
              {!isPublic && (
                <button className="icon-btn sm danger" onClick={() => setConfirm(r)} disabled={busy} aria-label="Remove">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {confirm && <ConfirmRemove repo={confirm} onCancel={() => setConfirm(null)} onConfirm={() => remove(confirm)} />}
    </div>
  );
}
