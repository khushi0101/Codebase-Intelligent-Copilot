import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";

hljs.registerLanguage("python", python);

/** Highlight a whole file, then split into per-line HTML. Spans that cross a
 * newline (docstrings, multi-line strings) are closed and reopened per line so
 * every line renders independently. */
export function highlightLines(code: string, language = "python"): string[] {
  const html = hljs.getLanguage(language)
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value
    : escapeHtml(code);

  const lines: string[] = [];
  const stack: string[] = [];
  let current = "";
  const token = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(html))) {
    if (m[1]) {
      stack.push(m[1]);
      current += m[1];
    } else if (m[2]) {
      stack.pop();
      current += m[2];
    } else if (m[3]) {
      current += "</span>".repeat(stack.length);
      lines.push(current);
      current = stack.join("");
    } else {
      current += m[4];
    }
  }
  lines.push(current + "</span>".repeat(stack.length));
  return lines;
}

export function highlightSnippet(code: string, language = "python"): string {
  return hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escapeHtml(code);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
