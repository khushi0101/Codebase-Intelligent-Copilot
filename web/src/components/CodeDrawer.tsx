import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Compass, X } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../lib/app-context";
import { lineRange } from "../lib/format";
import { CodeView } from "./CodeView";
import { Spinner } from "./ui";

export function CodeDrawer() {
  const { codeTarget, closeCode } = useApp();
  const navigate = useNavigate();
  const [file, setFile] = useState<{ key: string; rel_path: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!codeTarget) return;
    let cancelled = false;
    const key = `${codeTarget.repoId}:${codeTarget.path}`;
    setError(null);
    api
      .file(codeTarget.repoId, codeTarget.path)
      .then((f) => !cancelled && setFile({ key, ...f }))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [codeTarget?.repoId, codeTarget?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeCode();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeCode]);

  if (!codeTarget) return null;
  const loading = !error && file?.key !== `${codeTarget.repoId}:${codeTarget.path}`;

  const openInExplore = () => {
    const params = new URLSearchParams({ path: file?.rel_path ?? codeTarget.path });
    if (codeTarget.start) params.set("line", String(codeTarget.start));
    if (codeTarget.end) params.set("end", String(codeTarget.end));
    closeCode();
    navigate(`/explore?${params}`);
  };

  return (
    <>
      <div className="drawer-scrim" onClick={closeCode} />
      <aside className="drawer" role="dialog" aria-label="Source code">
        <header className="drawer-head">
          <div className="drawer-title">
            <span className="mono">{file && !loading ? file.rel_path : codeTarget.path}</span>
            {codeTarget.start != null && (
              <span className="pill">L{lineRange(codeTarget.start, codeTarget.end ?? codeTarget.start)}</span>
            )}
            {codeTarget.title && <span className="muted">{codeTarget.title}</span>}
          </div>
          <div className="row gap-s">
            <button className="btn btn-ghost btn-sm" onClick={openInExplore} disabled={!file}>
              <Compass size={15} /> Open in Explore
            </button>
            <button className="icon-btn" onClick={closeCode} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="drawer-body">
          {error ? (
            <div className="empty-inline error-text">{error}</div>
          ) : loading ? (
            <div className="center-fill">
              <Spinner />
            </div>
          ) : (
            <CodeView content={file!.content} start={codeTarget.start} end={codeTarget.end} />
          )}
        </div>
      </aside>
    </>
  );
}
