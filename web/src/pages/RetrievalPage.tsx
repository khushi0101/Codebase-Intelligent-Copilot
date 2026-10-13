import { useState } from "react";
import { Info, Search } from "lucide-react";
import { api, type Chunk, type SearchResult } from "../lib/api";
import { useApp } from "../lib/app-context";
import { fmtMs, lineRange } from "../lib/format";
import { RetrieverBadges } from "../components/SourceList";
import { EmptyState, PageHeader, Spinner } from "../components/ui";

const EXAMPLES = [
  "How are two different search results combined into one ranking?",
  "reciprocal_rank_fusion",
  "Where is the database connection set up?",
  "What happens if inserting a chunk fails?",
];

function ResultItem({
  repoId,
  chunk,
  rank,
  right,
  inFinal,
}: {
  repoId: string;
  chunk: Chunk;
  rank: number;
  right?: React.ReactNode;
  inFinal?: boolean;
}) {
  const { openCode } = useApp();
  return (
    <button
      className={`result ${inFinal ? "final" : ""}`}
      onClick={() => openCode({ repoId, path: chunk.file_path, start: chunk.start_line, end: chunk.end_line })}
    >
      <span className="result-rank">{rank}</span>
      <span className="result-main">
        <span className="mono strong truncate">{chunk.function_name ?? "chunk"}</span>
        <span className="mono muted small truncate">
          {chunk.rel_path}:{lineRange(chunk.start_line, chunk.end_line)}
        </span>
        {right && <span className="result-right">{right}</span>}
      </span>
    </button>
  );
}

export function RetrievalPage() {
  const { repo } = useApp();
  const [query, setQuery] = useState("");
  const [k, setK] = useState(5);
  const [finalK, setFinalK] = useState(5);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState("");

  const run = async (q = query) => {
    if (!repo || !q.trim()) return;
    setQuery(q);
    setLoading(true);
    setError(null);
    try {
      setResult(await api.search(repo.id, q.trim(), k));
      setLastQuery(q.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!repo) {
    return (
      <div className="page">
        <EmptyState title="No repository selected" />
      </div>
    );
  }

  const both = result?.fused.filter((f) => f.vector_rank != null && f.keyword_rank != null).length ?? 0;

  return (
    <div className="page page-wide">
      <PageHeader
        title="Retrieval inspector"
        subtitle={
          <>
            See exactly what the copilot retrieves for a query before any LLM is involved: dense vector search and BM25
            keyword search, merged with Reciprocal Rank Fusion. Searching <strong>{repo.name}</strong>.
          </>
        }
      />

      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <div className="search-input lg">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try a question, or an exact function name"
          />
        </div>
        <label className="inline-field">
          <span className="muted small">k</span>
          <input type="number" min={1} max={50} value={k} onChange={(e) => setK(Math.max(1, Number(e.target.value)))} />
        </label>
        <label className="inline-field" title="How many fused results the Ask flow would send to the model">
          <span className="muted small">sent</span>
          <input
            type="number"
            min={1}
            max={50}
            value={finalK}
            onChange={(e) => setFinalK(Math.max(1, Number(e.target.value)))}
          />
        </label>
        <button className="btn btn-primary" disabled={loading || !query.trim()}>
          {loading ? <Spinner size={14} /> : "Search"}
        </button>
      </form>

      {!result && !loading && (
        <div className="examples">
          <span className="muted small">Try:</span>
          {EXAMPLES.map((e) => (
            <button key={e} className="chip chip-btn" onClick={() => run(e)}>
              {e}
            </button>
          ))}
        </div>
      )}

      {error && <div className="callout callout-error">{error}</div>}

      {result && (
        <>
          <div className="result-summary">
            <span>
              <strong>{result.fused.length}</strong> unique chunks for “{lastQuery}”
            </span>
            <span className="muted">·</span>
            <span>{both} found by both retrievers</span>
            <span className="muted">·</span>
            <span>{fmtMs(result.latency_ms)}</span>
            {result.keyword.length === 0 && (
              <span className="callout-inline">
                <Info size={14} /> BM25 found nothing. FTS5 requires every word to match, so long natural-language
                questions rarely hit. Try an exact identifier.
              </span>
            )}
          </div>

          <div className="results-grid">
            <div className="results-col">
              <div className="results-head">
                <span className="dot-key vector" /> Vector search
                <span className="muted small">all-MiniLM-L6-v2 · L2 distance (lower is closer)</span>
              </div>
              {result.vector.map((c, i) => (
                <ResultItem
                  key={i}
                  repoId={repo.id}
                  chunk={c}
                  rank={i + 1}
                  right={<span className="mono small">{c.distance.toFixed(3)}</span>}
                />
              ))}
              {result.vector.length === 0 && <div className="muted small pad-s">No results.</div>}
            </div>

            <div className="results-col">
              <div className="results-head">
                <span className="dot-key bm25" /> BM25 keyword
                <span className="muted small">SQLite FTS5 · exact identifiers</span>
              </div>
              {result.keyword.map((c, i) => (
                <ResultItem key={i} repoId={repo.id} chunk={c} rank={i + 1} />
              ))}
              {result.keyword.length === 0 && <div className="muted small pad-s">No keyword matches.</div>}
            </div>

            <div className="results-col fused">
              <div className="results-head">
                <span className="dot-key fused" /> Fused (RRF, k=60)
                <span className="muted small">top {finalK} go to the model</span>
              </div>
              {result.fused.map((c, i) => (
                <ResultItem
                  key={i}
                  repoId={repo.id}
                  chunk={c}
                  rank={i + 1}
                  inFinal={i < finalK}
                  right={<RetrieverBadges s={c} />}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
