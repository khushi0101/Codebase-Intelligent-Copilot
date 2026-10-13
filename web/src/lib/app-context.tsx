import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Health, type Repo } from "./api";
import { load, save } from "./storage";

export interface CodeTarget {
  repoId: string;
  path: string; // absolute or repo-relative
  start?: number;
  end?: number;
  title?: string;
}

interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

interface AppState {
  repos: Repo[];
  reposLoaded: boolean;
  reposError: string | null;
  repo: Repo | null;
  setRepoId: (id: string) => void;
  refreshRepos: () => Promise<Repo[]>;
  health: Health | null;
  serverDown: boolean;
  codeTarget: CodeTarget | null;
  openCode: (t: CodeTarget) => void;
  closeCode: () => void;
  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"]) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [repoId, setRepoIdState] = useState<string | null>(() => load<string | null>("cc.repo", null));
  const [health, setHealth] = useState<Health | null>(null);
  const [serverDown, setServerDown] = useState(false);
  const [codeTarget, setCodeTarget] = useState<CodeTarget | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const refreshRepos = useCallback(async () => {
    try {
      const list = await api.repos();
      setRepos(list);
      setReposError(null);
      return list;
    } catch (e) {
      setReposError((e as Error).message);
      return [];
    } finally {
      setReposLoaded(true);
    }
  }, []);

  useEffect(() => {
    refreshRepos();
  }, [refreshRepos]);

  // Poll health; poll faster while the server is down (e.g. a hosted demo waking
  // from sleep) and reload repos the moment it comes back.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let wasDown = false;
    const check = async () => {
      try {
        const h = await api.health();
        if (cancelled) return;
        setHealth(h);
        setServerDown(false);
        if (wasDown) refreshRepos();
        wasDown = false;
      } catch {
        if (cancelled) return;
        setServerDown(true);
        wasDown = true;
      }
      timer = setTimeout(check, wasDown ? 4_000 : 30_000);
    };
    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refreshRepos]);

  // While anything is indexing, keep the list fresh so cards and the Ask page flip to ready on their own.
  const anyIndexing = repos.some((r) => r.indexing);
  useEffect(() => {
    if (!anyIndexing) return;
    const t = setInterval(refreshRepos, 3_000);
    return () => clearInterval(t);
  }, [anyIndexing, refreshRepos]);

  const setRepoId = useCallback((id: string) => {
    setRepoIdState(id);
    save("cc.repo", id);
  }, []);

  const repo = useMemo(() => {
    if (!repos.length) return null;
    return repos.find((r) => r.id === repoId) ?? repos.find((r) => r.indexed) ?? repos[0];
  }, [repos, repoId]);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const value: AppState = {
    repos,
    reposLoaded,
    reposError,
    repo,
    setRepoId,
    refreshRepos,
    health,
    serverDown,
    codeTarget,
    openCode: setCodeTarget,
    closeCode: () => setCodeTarget(null),
    toasts,
    toast,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}
