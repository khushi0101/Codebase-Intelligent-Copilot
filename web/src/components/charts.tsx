import { useState } from "react";
import type { TraceRecord } from "../lib/api";
import { fmtMs, fmtPct, fmtTime } from "../lib/format";

/** Stacked bars per question: retrieval (series 1) + generation (series 2).
 * Single y-axis in ms; hover shows exact split. */
export function LatencyChart({ records }: { records: TraceRecord[] }) {
  const data = [...records].reverse().slice(-40); // oldest → newest, left → right
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return null;

  const W = 720;
  const H = 220;
  const pad = { l: 48, r: 8, t: 12, b: 24 };
  const max = Math.max(...data.map((d) => d.total_latency_ms ?? 0), 1);
  const niceMax = niceCeil(max);
  const ticks = [0, niceMax / 2, niceMax];
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const slot = innerW / data.length;
  const barW = Math.max(3, Math.min(22, slot - 2));
  const y = (v: number) => pad.t + innerH - (v / niceMax) * innerH;

  const h = hover != null ? data[hover] : null;

  return (
    <div className="chart">
      <div className="legend">
        <span>
          <i className="sw s1" /> Retrieval
        </span>
        <span>
          <i className="sw s2" /> Generation
        </span>
      </div>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Latency per question, retrieval and generation">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={pad.l - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                {t >= 1000 ? `${(t / 1000).toFixed(t % 1000 ? 1 : 0)}s` : `${t}ms`}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = pad.l + i * slot + (slot - barW) / 2;
            const r = d.retrieval_latency_ms ?? 0;
            const g = d.generation_latency_ms ?? 0;
            const gap = r > 0 && g > 0 ? 2 : 0; // surface gap between stacked segments
            const rTop = y(r);
            return (
              <g key={i} className={hover === i ? "bar hover" : "bar"}>
                <rect x={x} y={rTop} width={barW} height={Math.max(0, y(0) - rTop)} className="fill-s1" rx={1} />
                <path d={roundedTop(x, y(r + g), barW, Math.max(0, rTop - gap - y(r + g)), 3)} className="fill-s2" />
                <rect
                  x={pad.l + i * slot}
                  y={pad.t}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}
          <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="axis" />
        </svg>
        {h && hover != null && (
          <div
            className="tooltip"
            style={{ left: `${((pad.l + (hover + 0.5) * slot) / W) * 100}%`, top: 0 }}
          >
            <div className="tooltip-title">{fmtTime(h.timestamp)}</div>
            <div>
              <i className="sw s1" /> Retrieval <strong>{fmtMs(h.retrieval_latency_ms)}</strong>
            </div>
            <div>
              <i className="sw s2" /> Generation <strong>{fmtMs(h.generation_latency_ms)}</strong>
            </div>
            <div className="muted">Total {fmtMs(h.total_latency_ms)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** recall@k as horizontal bars; single series so no legend. */
export function RecallBars({ recall, ks }: { recall: Record<string, number>; ks: number[] }) {
  return (
    <div className="hbars">
      {ks.map((k) => {
        const v = recall[String(k)] ?? 0;
        return (
          <div key={k} className="hbar-row" title={`recall@${k} = ${fmtPct(v)}`}>
            <span className="hbar-label mono">recall@{k}</span>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `${v * 100}%` }} />
            </div>
            <span className="hbar-value">{fmtPct(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

function niceCeil(v: number): number {
  const steps = [100, 200, 500, 1000, 2000, 2500, 5000, 10000, 15000, 20000, 30000, 60000];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 10000) * 10000;
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}
