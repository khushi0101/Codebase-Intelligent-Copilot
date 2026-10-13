import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Check,
  ChevronsUpDown,
  Compass,
  FolderGit2,
  MessageSquareText,
  CodeXml,
  Moon,
  Plus,
  ScanSearch,
  Settings,
  Sun,
} from "lucide-react";
import { useApp } from "../lib/app-context";
import { shortPath } from "../lib/format";

const NAV = [
  { to: "/", label: "Ask", icon: MessageSquareText, end: true },
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/retrieval", label: "Retrieval", icon: ScanSearch },
  { to: "/insights", label: "Insights", icon: BarChart3 },
  { to: "/repos", label: "Repositories", icon: FolderGit2 },
  { to: "/settings", label: "Settings", icon: Settings },
];

function RepoSwitcher() {
  const { repos, repo, setRepoId } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="repo-switch" ref={ref}>
      <button className="repo-switch-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="repo-avatar">{(repo?.name ?? "?").slice(0, 1).toUpperCase()}</span>
        <span className="repo-switch-text">
          <span className="repo-switch-name">{repo?.name ?? "No repository"}</span>
          <span className="repo-switch-sub">
            {repo ? `${repo.chunk_count ?? 0} functions indexed` : "Add one to get started"}
          </span>
        </span>
        <ChevronsUpDown size={15} className="muted" />
      </button>
      {open && (
        <div className="menu">
          <div className="menu-label">Repositories</div>
          {repos.map((r) => (
            <button
              key={r.id}
              className="menu-item"
              onClick={() => {
                setRepoId(r.id);
                setOpen(false);
              }}
            >
              <span className="repo-avatar sm">{r.name.slice(0, 1).toUpperCase()}</span>
              <span className="menu-item-text">
                <span>{r.name}</span>
                <span className="menu-item-sub mono">{shortPath(r.path)}</span>
              </span>
              {r.id === repo?.id && <Check size={15} />}
            </button>
          ))}
          <div className="menu-sep" />
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false);
              navigate("/repos?add=1");
            }}
          >
            <Plus size={15} /> Add repository…
          </button>
        </div>
      )}
    </div>
  );
}

// Stored raw (not JSON) because index.html reads it before first paint to avoid a theme flash.
function readTheme(): string | null {
  try {
    return localStorage.getItem("cc.theme");
  } catch {
    return null;
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(readTheme);
  const isDark = theme === "dark" || (!theme && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const toggle = () => {
    const next = isDark ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("cc.theme", next);
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <button className="icon-btn" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export function Sidebar() {
  const { health, serverDown } = useApp();
  const status = serverDown
    ? { cls: "warn", text: import.meta.env.VITE_HOSTED ? "Waking up server…" : "Server offline" }
    : !health
      ? { cls: "", text: "Connecting…" }
      : !health.database
        ? { cls: "bad", text: "Database unreachable" }
        : !health.llm_key
          ? { cls: "warn", text: health.public ? "Demo · bring your own key" : "No GEMINI_API_KEY" }
          : { cls: "good", text: "All systems ready" };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <path
              d="M12 10l-5 6 5 6M20 10l5 6-5 6"
              stroke="#fff"
              strokeWidth="2.6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div>
          <div className="brand-name">Codebase Copilot</div>
          <div className="brand-sub">Grounded answers, cited</div>
        </div>
      </div>

      <RepoSwitcher />

      <nav className="nav">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
            <Icon size={17} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {health?.source_url && (
        <a className="nav-item source-link" href={health.source_url} target="_blank" rel="noreferrer">
          <CodeXml size={17} />
          <span>View source</span>
        </a>
      )}

      <div className="sidebar-foot">
        <div className="health" title={health ? `${health.llm_model} · ${health.embedding_model}` : undefined}>
          <span className={`dot ${status.cls}`} />
          <span>{status.text}</span>
        </div>
        <ThemeToggle />
      </div>
    </aside>
  );
}
