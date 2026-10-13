import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import type { Citation } from "../lib/api";
import { highlightSnippet } from "../lib/highlight";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Turn each resolved citation (e.g. "ask.py:12-20") into a markdown link the
 * renderer below swaps for a clickable chip. One regex pass, longest first, so
 * "ask.py:3" can never match inside an already-linked "my_ask.py:3". */
function linkCitations(text: string, citations: Citation[]): string {
  if (!citations.length) return text;
  const order = citations.map((c, i) => ({ raw: c.raw, i })).sort((a, b) => b.raw.length - a.raw.length);
  const re = new RegExp(`(?<![\\w/.])\`?(${order.map((o) => escapeRe(o.raw)).join("|")})\`?`, "g");
  const index = new Map(citations.map((c, i) => [c.raw, i]));
  return text.replace(re, (_m, raw: string) => `[${raw}](#cite-${index.get(raw)})`);
}

interface Props {
  text: string;
  citations?: Citation[];
  onCite?: (c: Citation) => void;
}

export const AnswerMarkdown = memo(function AnswerMarkdown({ text, citations = [], onCite }: Props) {
  const source = useMemo(() => linkCitations(text, citations), [text, citations]);

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            const m = href?.match(/^#cite-(\d+)$/);
            if (m) {
              const c = citations[Number(m[1])];
              return (
                <button
                  className={`cite ${c.valid ? "valid" : "invalid"}`}
                  onClick={() => onCite?.(c)}
                  title={
                    c.valid
                      ? "Verified: these lines were in the retrieved context. Click to view."
                      : "Not in the retrieved context. The model may have guessed these lines. Click to view."
                  }
                >
                  {c.valid ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          code({ className, children }) {
            const lang = /language-(\w+)/.exec(className ?? "")?.[1];
            const code = String(children ?? "");
            if (!lang && !code.includes("\n")) return <code className="inline">{children}</code>;
            return (
              <code
                className="hljs block"
                dangerouslySetInnerHTML={{ __html: highlightSnippet(code.replace(/\n$/, ""), lang ?? "python") }}
              />
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
