import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { ArrowDown, ChevronDown, ChevronRight, FileCode2, Folder, FolderGit2, MessageSquareText, Search } from "lucide-react";
import { api, type CallGraph, type GraphNode, type RepoFile } from "../lib/api";
import { useApp } from "../lib/app-context";
import { lineRange } from "../lib/format";
import { CodeView } from "../components/CodeView";
import { EmptyState, Spinner } from "../components/ui";

interface DirNode {
  name: string;
  path: string;
  dirs: Map<string, DirNode>;
  files: RepoFile[];
}

function buildTree(files: RepoFile[]): DirNode {
  const root: DirNode = { name: "", path: "", dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.rel_path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) {
        node.dirs.set(part, { name: part, path: node.path ? `${node.path}/${part}` : part, dirs: new Map(), files: [] });
      }
      node = node.dirs.get(part)!;
    }
    node.files.push(f);
  }
  return root;
}

function TreeDir({
  node,
  depth,
  selected,
  onSelect,
  forceOpen,
}: {
  node: DirNode;
  depth: number;
  selected: string | null;
  onSelect: (f: RepoFile) => void;
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isOpen = open || forceOpen;
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.rel_path.localeCompare(b.rel_path));
  const pad = { paddingLeft: 8 + depth * 14 };

  return (
    <>
      {depth >= 0 && node.name && (
        <button className="tree-row" style={pad} onClick={() => setOpen(!isOpen)}>
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Folder size={14} className="muted" />
          <span>{node.name}</span>
        </button>
      )}
      {(isOpen || !node.name) &&
        [
          ...dirs.map((d) => (
            <TreeDir key={d.path} node={d} depth={depth + 1} selected={selected} onSelect={onSelect} forceOpen={forceOpen} />
          )),
          ...files.map((f) => (
            <button
              key={f.file_path}
              className={`tree-row ${selected === f.rel_path ? "active" : ""}`}
              style={{ paddingLeft: 8 + (depth + 1) * 14 + 14 }}
              onClick={() => onSelect(f)}
              title={f.rel_path}
            >
              <FileCode2 size={14} className="muted" />
              <span className="truncate">{f.rel_path.split("/").pop()}</span>
              <span className="tree-count">{f.functions.length || ""}</span>
            </button>
          )),
        ]}
    </>
  );
}

function GraphNodeCard({ n, onOpen, focus }: { n: GraphNode; onOpen?: (n: GraphNode) => void; focus?: boolean }) {
  return (
    <button className={`gnode ${focus ? "focus" : ""}`} onClick={() => onOpen?.(n)} disabled={!onOpen}>
      <span className="mono strong">{n.function_name}</span>
      <span className="mono muted small truncate">
        {n.rel_path}:{lineRange(n.start_line, n.end_line)}
      </span>
    </button>
  );
}

function CallGraphPanel({ graph, onOpen }: { graph: CallGraph; onOpen: (n: GraphNode) => void }) {
  return (
    <div className="graph">
      <div className="graph-group">
        <div className="graph-label">Called by · {graph.callers.length}</div>
        {graph.callers.length ? (
          graph.callers.map((n) => <GraphNodeCard key={n.file_path + n.function_name} n={n} onOpen={onOpen} />)
        ) : (
          <div className="graph-none">No callers found in this repo. It may be an entry point.</div>
        )}
      </div>
      <div className="graph-arrow">
        <ArrowDown size={14} />
      </div>
      <GraphNodeCard n={graph.function} focus />
      <div className="graph-arrow">
        <ArrowDown size={14} />
      </div>
      <div className="graph-group">
        <div className="graph-label">Calls · {graph.callees.length}</div>
        {graph.callees.length ? (
          graph.callees.map((n) => <GraphNodeCard key={n.file_path + n.function_name} n={n} onOpen={onOpen} />)
        ) : (
          <div className="graph-none">Doesn't call any other function defined in this repo.</div>
        )}
        {graph.unresolved_calls.length > 0 && (
          <div className="graph-external">
            <span className="muted small">Outside this repo:</span>{" "}
            {graph.unresolved_calls.slice(0, 18).map((n) => (
              <code key={n}>{n}</code>
            ))}
            {graph.unresolved_calls.length > 18 && <span className="muted small"> +{graph.unresolved_calls.length - 18}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export function ExplorePage() {
  const { repo } = useApp();
  const [params, setParams] = useSearchParams();
  const [files, setFiles] = useState<RepoFile[] | null>(null);
  const [filter, setFilter] = useState("");
  const [content, setContent] = useState<{ key: string; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [graph, setGraph] = useState<CallGraph | null>(null);
  const [graphState, setGraphState] = useState<"idle" | "loading" | "error">("idle");

  const path = params.get("path");
  const fn = params.get("fn");
  const line = params.get("line") ? Number(params.get("line")) : undefined;
  const end = params.get("end") ? Number(params.get("end")) : undefined;

  useEffect(() => {
    if (!repo) return;
    setFiles(null);
    api.files(repo.id).then(setFiles).catch(() => setFiles([]));
  }, [repo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default to the first file once the list arrives.
  useEffect(() => {
    if (files?.length && !path) {
      const first = [...files].sort((a, b) => b.functions.length - a.functions.length)[0];
      setParams({ path: first.rel_path }, { replace: true });
    }
  }, [files, path, setParams]);

  useEffect(() => {
    if (!repo || !path) return;
    let cancelled = false;
    setFileError(null);
    api
      .file(repo.id, path)
      .then((f) => !cancelled && setContent({ key: `${repo.id}:${path}`, text: f.content }))
      .catch((e) => !cancelled && setFileError(e.message));
    return () => {
      cancelled = true;
    };
  }, [repo?.id, path]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = useMemo(
    () => files?.find((f) => f.rel_path === path || f.file_path === path) ?? null,
    [files, path],
  );

  // If we arrived with only a line range (from a citation), select the function containing it.
  const selectedFn = useMemo(() => {
    if (!current) return null;
    if (fn) return current.functions.find((f) => f.name === fn) ?? null;
    if (line) return current.functions.find((f) => line >= f.start_line && line <= f.end_line) ?? null;
    return null;
  }, [current, fn, line]);

  useEffect(() => {
    if (!repo || !current || !selectedFn) {
      setGraph(null);
      return;
    }
    let cancelled = false;
    setGraphState("loading");
    api
      .graph(repo.id, current.rel_path, selectedFn.name)
      .then((g) => {
        if (cancelled) return;
        setGraph(g);
        setGraphState("idle");
      })
      .catch(() => !cancelled && setGraphState("error"));
    return () => {
      cancelled = true;
    };
  }, [repo?.id, current?.rel_path, selectedFn?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!files) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.rel_path.toLowerCase().includes(q) || f.functions.some((fn) => fn.name.toLowerCase().includes(q)));
  }, [files, filter]);
  const tree = useMemo(() => buildTree(filtered), [filtered]);

  const openFile = (f: RepoFile) => setParams({ path: f.rel_path });
  const openFn = (name: string, start: number, stop: number) =>
    setParams({ path: current!.rel_path, fn: name, line: String(start), end: String(stop) });
  const openNode = (n: GraphNode) =>
    setParams({ path: n.rel_path, fn: n.function_name, line: String(n.start_line), end: String(n.end_line) });

  if (!repo) {
    return (
      <div className="page">
        <EmptyState icon={<FolderGit2 size={28} />} title="No repository selected" />
      </div>
    );
  }

  const hlStart = selectedFn?.start_line ?? line;
  const hlEnd = selectedFn?.end_line ?? end;
  const contentReady = content?.key === `${repo.id}:${path}`;

  return (
    <div className="explore">
      <aside className="explore-tree">
        <div className="search-input sm">
          <Search size={14} />
          <input placeholder="Filter files & functions" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="tree">
          {!files ? (
            <div className="center-fill pad-m">
              <Spinner />
            </div>
          ) : files.length === 0 ? (
            <div className="muted small pad-s">
              Nothing indexed yet. <Link to="/repos">Index this repo</Link>.
            </div>
          ) : (
            <TreeDir node={tree} depth={-1} selected={current?.rel_path ?? null} onSelect={openFile} forceOpen={!!filter} />
          )}
        </div>
        <div className="tree-foot muted small">
          {files?.length ?? 0} files · {files?.reduce((n, f) => n + f.functions.length, 0) ?? 0} functions
        </div>
      </aside>

      <section className="explore-code">
        <div className="code-head">
          <span className="mono">{current?.rel_path ?? path ?? ""}</span>
          {selectedFn && (
            <span className="pill">
              {selectedFn.name} · L{lineRange(selectedFn.start_line, selectedFn.end_line)}
            </span>
          )}
          <span className="spacer" />
          {selectedFn && (
            <Link className="btn btn-ghost btn-sm" to="/" state={{ prefill: `What would break if I changed \`${selectedFn.name}\`?` }}>
              <MessageSquareText size={14} /> Ask about this
            </Link>
          )}
        </div>
        {fileError ? (
          <div className="empty-inline error-text">{fileError}</div>
        ) : !contentReady ? (
          <div className="center-fill">
            <Spinner />
          </div>
        ) : (
          <CodeView content={content!.text} start={hlStart} end={hlEnd} scrollKey={`${path}:${hlStart}`} />
        )}
      </section>

      <aside className="explore-side">
        <div className="side-section">
          <div className="side-title">Functions in this file</div>
          {current?.functions.length ? (
            <div className="fn-list">
              {current.functions.map((f) => (
                <button
                  key={`${f.name}:${f.start_line}`}
                  className={`fn-row ${selectedFn?.name === f.name && selectedFn.start_line === f.start_line ? "active" : ""}`}
                  onClick={() => openFn(f.name, f.start_line, f.end_line)}
                >
                  <span className="mono truncate">{f.name}</span>
                  <span className="muted small mono">{lineRange(f.start_line, f.end_line)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="muted small">No function definitions indexed in this file. Module-level code isn't chunked.</div>
          )}
        </div>

        <div className="side-section">
          <div className="side-title">Call graph</div>
          {!selectedFn ? (
            <div className="muted small">Select a function to see what calls it and what it calls.</div>
          ) : graphState === "loading" && !graph ? (
            <Spinner />
          ) : graphState === "error" ? (
            <div className="muted small">Couldn't build the call graph for this function.</div>
          ) : graph ? (
            <CallGraphPanel graph={graph} onOpen={openNode} />
          ) : null}
        </div>
      </aside>
    </div>
  );
}
