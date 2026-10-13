import { useState } from "react";
import { ChevronRight, GitBranch } from "lucide-react";
import type { RelatedChunk, SourceChunk } from "../lib/api";
import { lineRange } from "../lib/format";
import { highlightSnippet } from "../lib/highlight";
import { useApp } from "../lib/app-context";

export function RetrieverBadges({ s }: { s: SourceChunk }) {
  return (
    <span className="row gap-xs wrap">
      {s.vector_rank != null && (
        <span className="badge badge-vector" title={`Vector search rank ${s.vector_rank}, L2 distance ${s.vector_distance?.toFixed(3)}`}>
          Vector #{s.vector_rank}
          <span className="badge-dim">d {s.vector_distance?.toFixed(2)}</span>
        </span>
      )}
      {s.keyword_rank != null && (
        <span className="badge badge-bm25" title={`BM25 keyword search rank ${s.keyword_rank}`}>
          BM25 #{s.keyword_rank}
        </span>
      )}
      <span className="badge badge-plain" title="Reciprocal Rank Fusion score (k=60)">
        RRF {s.rrf_score.toFixed(4)}
      </span>
    </span>
  );
}

function SourceRow({
  repoId,
  chunk,
  rank,
  meta,
}: {
  repoId: string;
  chunk: SourceChunk | RelatedChunk;
  rank?: number;
  meta: React.ReactNode;
}) {
  const { openCode } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <div className={`source ${open ? "open" : ""}`}>
      <div className="source-head">
        <button className="icon-btn sm" onClick={() => setOpen((o) => !o)} aria-label="Preview" aria-expanded={open}>
          <ChevronRight size={15} className="chev" />
        </button>
        {rank != null && <span className="source-rank">{rank}</span>}
        <button
          className="source-title"
          onClick={() =>
            openCode({ repoId, path: chunk.file_path, start: chunk.start_line, end: chunk.end_line })
          }
        >
          <span className="mono strong">{chunk.function_name ?? "chunk"}</span>
          <span className="mono muted">
            {chunk.rel_path}:{lineRange(chunk.start_line, chunk.end_line)}
          </span>
        </button>
        <span className="source-meta">{meta}</span>
      </div>
      {open && (
        <pre className="source-preview">
          <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightSnippet(chunk.text) }} />
        </pre>
      )}
    </div>
  );
}

export function SourceList({
  repoId,
  sources,
  related = [],
}: {
  repoId: string;
  sources: SourceChunk[];
  related?: RelatedChunk[];
}) {
  return (
    <div className="sources">
      {sources.map((s, i) => (
        <SourceRow key={`${s.file_path}:${s.start_line}`} repoId={repoId} chunk={s} rank={i + 1} meta={<RetrieverBadges s={s} />} />
      ))}
      {related.map((r) => (
        <SourceRow
          key={`rel:${r.file_path}:${r.start_line}`}
          repoId={repoId}
          chunk={r}
          meta={
            <span className="badge badge-graph">
              <GitBranch size={11} /> {r.label.includes("calls this") ? "Caller" : "Callee"}
            </span>
          }
        />
      ))}
    </div>
  );
}
