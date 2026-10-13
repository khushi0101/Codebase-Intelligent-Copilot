import { useEffect, useMemo, useRef } from "react";
import { highlightLines } from "../lib/highlight";

interface Props {
  content: string;
  start?: number;
  end?: number;
  /** Bump to re-scroll to the highlighted range even if start/end didn't change. */
  scrollKey?: string | number;
  startLineNumber?: number;
}

export function CodeView({ content, start, end, scrollKey, startLineNumber = 1 }: Props) {
  const lines = useMemo(() => highlightLines(content), [content]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!start || !ref.current) return;
    const row = ref.current.querySelector<HTMLElement>(`[data-line="${start}"]`);
    if (!row) return;
    // Scroll the container, not the page: put the range a little below the top.
    const container = ref.current;
    container.scrollTo({ top: Math.max(0, row.offsetTop - 72), behavior: "smooth" });
  }, [start, end, scrollKey, lines]);

  return (
    <div className="code-view" ref={ref}>
      <table>
        <tbody>
          {lines.map((html, i) => {
            const n = i + startLineNumber;
            const hl = start != null && n >= start && n <= (end ?? start);
            return (
              <tr key={n} data-line={n} className={hl ? "hl" : undefined}>
                <td className="ln">{n}</td>
                <td className="src" dangerouslySetInnerHTML={{ __html: html || " " }} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
