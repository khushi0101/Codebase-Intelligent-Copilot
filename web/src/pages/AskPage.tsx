import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUp,
  Check,
  CheckCircle2,
  Copy,
  FolderGit2,
  MessageSquarePlus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  AlertTriangle,
  KeyRound,
} from "lucide-react";
import {
  streamAsk,
  api,
  type AnswerStats,
  type Citation,
  type RelatedChunk,
  type Repo,
  type SourceChunk,
} from "../lib/api";
import { useApp } from "../lib/app-context";
import { load, save } from "../lib/storage";
import { getUserKey } from "../lib/userKey";
import { fmtAgo, fmtMs, fmtNum } from "../lib/format";
import { AnswerMarkdown } from "../components/AnswerMarkdown";
import { SourceList } from "../components/SourceList";
import { EmptyState, Spinner } from "../components/ui";

interface UserMsg {
  role: "user";
  text: string;
}
interface AssistantMsg {
  role: "assistant";
  status: "retrieving" | "generating" | "done" | "error" | "stopped";
  text: string;
  sources: SourceChunk[];
  related: RelatedChunk[];
  citations: Citation[];
  stats?: AnswerStats;
  retrieval_ms?: number;
  error?: string;
}
type Msg = UserMsg | AssistantMsg;

interface Thread {
  id: string;
  title: string;
  updatedAt: number;
  messages: Msg[];
}

interface AskOptions {
  retrieval_k: number;
  final_k: number;
  expand_graph: boolean;
}

const DEFAULT_OPTIONS: AskOptions = { retrieval_k: 5, final_k: 5, expand_graph: true };
const threadsKey = (repoId: string) => `cc.threads.${repoId}`;
const newId = () => Math.random().toString(36).slice(2, 10);

function OptionsPopover({ options, onChange }: { options: AskOptions; onChange: (o: AskOptions) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="popover-wrap" ref={ref}>
      <button className={`btn btn-ghost btn-sm ${open ? "pressed" : ""}`} onClick={() => setOpen((o) => !o)}>
        <SlidersHorizontal size={15} /> Retrieval
      </button>
      {open && (
        <div className="popover">
          <label className="field">
            <span className="field-label">
              Candidates per retriever <span className="mono muted">{options.retrieval_k}</span>
            </span>
            <input
              type="range"
              min={1}
              max={20}
              value={options.retrieval_k}
              onChange={(e) => onChange({ ...options, retrieval_k: Number(e.target.value) })}
            />
            <span className="field-hint">Top-k pulled from vector search and from BM25 before fusion.</span>
          </label>
          <label className="field">
            <span className="field-label">
              Chunks sent to the model <span className="mono muted">{options.final_k}</span>
            </span>
            <input
              type="range"
              min={1}
              max={20}
              value={options.final_k}
              onChange={(e) => onChange({ ...options, final_k: Number(e.target.value) })}
            />
            <span className="field-hint">Kept after Reciprocal Rank Fusion. recall@5 = 100% on the gold set.</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={options.expand_graph}
              onChange={(e) => onChange({ ...options, expand_graph: e.target.checked })}
            />
            <span>
              <span className="field-label">Call-graph expansion</span>
              <span className="field-hint">Adds up to 2 callers and 2 callees of the top match.</span>
            </span>
          </label>
          <button className="btn btn-ghost btn-sm" onClick={() => onChange(DEFAULT_OPTIONS)}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

function AssistantMessage({
  msg,
  repoId,
  onRetry,
}: {
  msg: AssistantMsg;
  repoId: string;
  onRetry: () => void;
}) {
  const { openCode } = useApp();
  const [copied, setCopied] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const validCount = msg.citations.filter((c) => c.valid).length;

  const onCite = useCallback(
    (c: Citation) => openCode({ repoId, path: c.file_path, start: c.start_line, end: c.end_line }),
    [openCode, repoId],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="msg msg-assistant">
      <div className="msg-avatar">
        <Sparkles size={15} />
      </div>
      <div className="msg-body">
        {msg.status === "retrieving" && (
          <div className="stage">
            <Spinner size={14} /> Searching the index: vector + BM25, fused with RRF…
          </div>
        )}
        {msg.status === "generating" && !msg.text && (
          <div className="stage">
            <Spinner size={14} /> Retrieved {msg.sources.length} chunks
            {msg.related.length ? ` + ${msg.related.length} from the call graph` : ""} in {fmtMs(msg.retrieval_ms)}.
            Writing a grounded answer…
          </div>
        )}

        {msg.text && (
          <AnswerMarkdown text={msg.text} citations={msg.status === "done" ? msg.citations : undefined} onCite={onCite} />
        )}
        {msg.status === "generating" && msg.text && <span className="caret" />}

        {msg.status === "error" && (
          <div className="callout callout-error">
            <AlertTriangle size={16} />
            <div>
              <strong>Couldn't answer.</strong> {msg.error}
            </div>
            {/Settings/.test(msg.error ?? "") ? (
              <Link className="btn btn-primary btn-sm" to="/settings">
                <KeyRound size={14} /> Add your key
              </Link>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={onRetry}>
                <RotateCcw size={14} /> Retry
              </button>
            )}
          </div>
        )}
        {msg.status === "stopped" && <div className="muted small">Stopped.</div>}

        {(msg.status === "done" || msg.status === "stopped") && (
          <div className="msg-foot">
            {msg.status === "done" && (
              <span
                className={`chip ${msg.citations.length === 0 ? "" : validCount === msg.citations.length ? "chip-good" : "chip-warn"}`}
                title="A citation is verified when its lines overlap a chunk that was actually given to the model."
              >
                {msg.citations.length === 0 ? (
                  "No citations"
                ) : (
                  <>
                    <CheckCircle2 size={13} /> {validCount}/{msg.citations.length} citations verified
                  </>
                )}
              </span>
            )}
            {msg.stats && (
              <span className="muted small" title={`retrieval ${fmtMs(msg.stats.retrieval_ms)} · generation ${fmtMs(msg.stats.generation_ms)}`}>
                {fmtMs(msg.stats.total_ms)} · {fmtNum(msg.stats.input_tokens)} → {fmtNum(msg.stats.output_tokens)} tokens ·{" "}
                <span className="mono">{msg.stats.prompt_version}</span>
              </span>
            )}
            <span className="spacer" />
            <button className="icon-btn sm" onClick={copy} title="Copy answer">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <button className="icon-btn sm" onClick={onRetry} title="Ask again">
              <RotateCcw size={14} />
            </button>
          </div>
        )}

        {msg.sources.length > 0 && (
          <div className="sources-block">
            <button className="sources-toggle" onClick={() => setShowSources((s) => !s)} aria-expanded={showSources}>
              {showSources ? "Hide" : "Show"} evidence · {msg.sources.length} retrieved
              {msg.related.length > 0 && ` · ${msg.related.length} via call graph`}
            </button>
            {showSources && <SourceList repoId={repoId} sources={msg.sources} related={msg.related} />}
          </div>
        )}
      </div>
    </div>
  );
}

function useSuggestions(repo: Repo | null) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (!repo?.indexed) return;
    let cancelled = false;
    api
      .files(repo.id)
      .then((files) => {
        if (cancelled) return;
        const fns = files
          .flatMap((f) => f.functions.map((fn) => ({ ...fn, file: f.rel_path })))
          .filter((fn) => !fn.name.startsWith("_") && !fn.file.includes("test"));
        // Prefer longer functions: they tend to be the interesting ones.
        fns.sort((a, b) => b.end_line - b.start_line - (a.end_line - a.start_line));
        const pick = fns.slice(0, 6);
        const out = ["What are the main entry points of this codebase?"];
        if (pick[0]) out.push(`What calls \`${pick[0].name}\`, and what would break if I changed it?`);
        if (pick[1]) out.push(`How does \`${pick[1].name}\` in ${pick[1].file} work?`);
        out.push("Where is the database connection set up?");
        setSuggestions(out);
      })
      .catch(() => setSuggestions([]));
    return () => {
      cancelled = true;
    };
  }, [repo?.id, repo?.indexed]);
  return suggestions;
}

export function AskPage() {
  const { repo, reposLoaded, serverDown, health } = useApp();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [options, setOptionsState] = useState<AskOptions>(() => load("cc.askOptions", DEFAULT_OPTIONS));
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestions = useSuggestions(repo);
  const location = useLocation();
  const navigate = useNavigate();

  // "Ask about this" from Explore arrives as router state: start a fresh thread with it prefilled.
  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill;
    if (!prefill) return;
    setActiveId(null);
    setInput(prefill);
    navigate(".", { replace: true, state: null });
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [location.state, navigate]);

  const setOptions = (o: AskOptions) => {
    setOptionsState(o);
    save("cc.askOptions", o);
  };

  // Threads are per repository.
  useEffect(() => {
    abortRef.current?.abort();
    if (!repo) return;
    const stored = load<Thread[]>(threadsKey(repo.id), []);
    setThreads(stored);
    setActiveId(null);
  }, [repo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = threads.some((t) =>
    t.messages.some((m) => m.role === "assistant" && (m.status === "retrieving" || m.status === "generating")),
  );

  // Persist when nothing is streaming (avoid writing on every token).
  useEffect(() => {
    if (repo && !busy) save(threadsKey(repo.id), threads.slice(0, 50));
  }, [threads, busy, repo]);

  const active = useMemo(() => threads.find((t) => t.id === activeId) ?? null, [threads, activeId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [active?.messages]);

  const patchLast = (threadId: string, patch: (m: AssistantMsg) => AssistantMsg) =>
    setThreads((ts) =>
      ts.map((t) => {
        if (t.id !== threadId) return t;
        const msgs = [...t.messages];
        const last = msgs[msgs.length - 1];
        if (last?.role === "assistant") msgs[msgs.length - 1] = patch(last);
        return { ...t, messages: msgs, updatedAt: Date.now() };
      }),
    );

  const ask = async (question: string, threadId?: string, replaceLast = false) => {
    if (!repo || !question.trim() || busy) return;
    const q = question.trim();
    let tid = threadId ?? activeId;
    const pending: AssistantMsg = { role: "assistant", status: "retrieving", text: "", sources: [], related: [], citations: [] };

    if (!tid) {
      tid = newId();
      const thread: Thread = {
        id: tid,
        title: q.length > 60 ? q.slice(0, 57) + "…" : q,
        updatedAt: Date.now(),
        messages: [{ role: "user", text: q }, pending],
      };
      setThreads((ts) => [thread, ...ts]);
      setActiveId(tid);
    } else {
      setThreads((ts) =>
        ts.map((t) => {
          if (t.id !== tid) return t;
          const msgs = replaceLast ? t.messages.slice(0, -1) : [...t.messages, { role: "user", text: q } as Msg];
          return { ...t, messages: [...msgs, pending], updatedAt: Date.now() };
        }),
      );
    }
    setInput("");
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });

    const controller = new AbortController();
    abortRef.current = controller;
    const id = tid;
    try {
      for await (const ev of streamAsk({ repo_id: repo.id, question: q, ...options }, controller.signal)) {
        if (ev.type === "context") {
          patchLast(id, (m) => ({ ...m, status: "generating", sources: ev.sources, related: ev.related, retrieval_ms: ev.retrieval_ms }));
        } else if (ev.type === "token") {
          patchLast(id, (m) => ({ ...m, text: m.text + ev.text }));
        } else if (ev.type === "done") {
          patchLast(id, (m) => ({ ...m, status: "done", citations: ev.citations, stats: ev.stats }));
        } else if (ev.type === "error") {
          patchLast(id, (m) => ({ ...m, status: "error", error: ev.message }));
        }
      }
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") patchLast(id, (m) => ({ ...m, status: "stopped" }));
      else patchLast(id, (m) => ({ ...m, status: "error", error: err.message }));
    } finally {
      abortRef.current = null;
      inputRef.current?.focus();
    }
  };

  const retry = (threadId: string, msgIndex: number) => {
    const t = threads.find((x) => x.id === threadId);
    const prev = t?.messages[msgIndex - 1];
    if (prev?.role === "user") ask(prev.text, threadId, msgIndex === t!.messages.length - 1);
  };

  const deleteThread = (id: string) => {
    setThreads((ts) => ts.filter((t) => t.id !== id));
    if (activeId === id) setActiveId(null);
  };

  if (serverDown && !repo && import.meta.env.VITE_HOSTED) {
    return (
      <div className="page">
        <EmptyState icon={<Spinner size={26} />} title="Waking up the demo server…">
          The backend runs on a free tier that sleeps when nobody's using it. It usually takes about a minute to start,
          and this page will continue on its own.
        </EmptyState>
      </div>
    );
  }

  if (reposLoaded && !repo) {
    return (
      <div className="page">
        <EmptyState
          icon={<FolderGit2 size={28} />}
          title={serverDown ? "Can't reach the Copilot server" : "No repositories yet"}
          action={
            !serverDown && (
              <Link to="/repos?add=1" className="btn btn-primary">
                Add a repository
              </Link>
            )
          }
        >
          {serverDown
            ? "Start it with `codecopilot serve` from the project folder, then reload."
            : "Point the copilot at a Python codebase. It parses every function, embeds it locally, and builds a keyword index."}
        </EmptyState>
      </div>
    );
  }

  const notIndexed = repo && !repo.indexed;

  return (
    <div className="ask-layout">
      <aside className="threads">
        <button className="btn btn-secondary btn-block" onClick={() => setActiveId(null)} disabled={busy}>
          <MessageSquarePlus size={16} /> New question
        </button>
        <div className="threads-list">
          {threads.length === 0 && <div className="muted small pad-s">Your questions about {repo?.name} will show up here.</div>}
          {threads.map((t) => (
            <div key={t.id} className={`thread ${t.id === activeId ? "active" : ""}`}>
              <button className="thread-btn" onClick={() => !busy && setActiveId(t.id)}>
                <span className="thread-title">{t.title}</span>
                <span className="thread-sub">{fmtAgo(t.updatedAt / 1000)}</span>
              </button>
              <button className="icon-btn sm thread-del" onClick={() => deleteThread(t.id)} aria-label="Delete" disabled={busy}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="chat">
        <div className="chat-scroll" ref={scrollRef}>
          {!active ? (
            <div className="chat-hero">
              <div className="hero-mark">
                <Sparkles size={22} />
              </div>
              <h1>Ask anything about {repo?.name ?? "your code"}</h1>
              <p className="muted">
                Answers come only from indexed code, with <span className="mono">path:line</span> citations you can
                click and verify. If the code doesn't support an answer, the copilot says so instead of guessing.
              </p>
              {health?.public && !getUserKey() && (
                <div className="demo-note">
                  Public demo · {health.limits?.questions_per_hour} questions/hour on the shared free-tier key ·{" "}
                  <Link to="/settings">use your own key</Link> for more ·{" "}
                  <Link to="/repos?add=1">try your own GitHub repo</Link>
                </div>
              )}
              {notIndexed && repo?.indexing ? (
                <div className="stage">
                  <Spinner size={14} /> Indexing {repo.name}: parsing and embedding every function. This takes a few
                  seconds…
                </div>
              ) : notIndexed ? (
                <div className="callout callout-warn">
                  <AlertTriangle size={16} />
                  <div>This repository hasn't been indexed yet.</div>
                  <Link className="btn btn-primary btn-sm" to="/repos">
                    Index it now
                  </Link>
                </div>
              ) : (
                <div className="suggestions">
                  {suggestions.map((s) => (
                    <button key={s} className="suggestion" onClick={() => ask(s)} disabled={busy}>
                      {s.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="messages">
              {active.messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="msg msg-user">
                    <div className="bubble">{m.text}</div>
                  </div>
                ) : (
                  <AssistantMessage key={i} msg={m} repoId={repo!.id} onRetry={() => retry(active.id, i)} />
                ),
              )}
            </div>
          )}
        </div>

        <div className="composer-wrap">
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              placeholder={notIndexed ? "Index this repository to start asking…" : `Ask about ${repo?.name ?? "this repo"}…`}
              disabled={!repo || !!notIndexed}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask(input);
                }
              }}
            />
            <div className="composer-bar">
              <OptionsPopover options={options} onChange={setOptions} />
              <span className="muted small hide-sm">
                k={options.retrieval_k} → {options.final_k}
                {options.expand_graph ? " · call graph on" : ""}
              </span>
              <span className="spacer" />
              {busy ? (
                <button type="button" className="send-btn stop" onClick={() => abortRef.current?.abort()} aria-label="Stop">
                  <Square size={14} />
                </button>
              ) : (
                <button type="submit" className="send-btn" disabled={!input.trim() || !repo || !!notIndexed} aria-label="Send">
                  <ArrowUp size={17} />
                </button>
              )}
            </div>
          </form>
          <div className="composer-note muted">
            Each question is answered independently from retrieved code; earlier turns aren't sent to the model.
          </div>
        </div>
      </section>
    </div>
  );
}
