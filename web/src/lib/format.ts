export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function fmtPct(x: number | null | undefined): string {
  if (x == null) return "—";
  return `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`;
}

/** Unix seconds -> "3 min ago" / "Oct 4". */
export function fmtAgo(ts: number | null | undefined): string {
  if (!ts) return "never";
  const s = Date.now() / 1000 - ts;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function lineRange(start: number, end: number): string {
  return start === end ? `${start}` : `${start}–${end}`;
}

export function shortPath(path: string, keep = 3): string {
  const parts = path.split("/");
  return parts.length <= keep ? path : "…/" + parts.slice(-keep).join("/");
}
