import { useEffect, useState } from "react";
import { Activity, CheckCircle2, FlaskConical, MinusCircle, Play, XCircle } from "lucide-react";
import { api, type EvalResult, type Traces } from "../lib/api";
import { useApp } from "../lib/app-context";
import { fmtMs, fmtNum, fmtPct, fmtTime, shortPath } from "../lib/format";
import { LatencyChart, RecallBars } from "../components/charts";
import { EmptyState, PageHeader, Segmented, Spinner, StatTile } from "../components/ui";

function EvalSection() {
  const { repo } = useApp();
  const [result, setResult] = useState<EvalResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!repo) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await api.evalRecall(repo.id, [3, 5, 10]));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="card section">
      <div className="section-head">
        <div>
          <h2>
            <FlaskConical size={17} /> Retrieval evaluation
          </h2>
          <p className="muted small">
            Runs the hand-labeled gold set (<code>gold_set.py</code>) through hybrid retrieval and checks whether the
            expected function lands in the top k. The gold set is written for <strong>this project's own code</strong>,
            so run it with the copilot's repo selected.
          </p>
        </div>
        <button className="btn btn-primary" onClick={run} disabled={running || !repo}>
          {running ? <Spinner size={14} /> : <Play size={14} />} {running ? "Running…" : "Run recall@k"}
        </button>
      </div>

      {error && <div className="callout callout-error">{error}</div>}

      {result && (
        <>
          <div className="eval-top">
            <RecallBars recall={result.recall} ks={result.ks} />
            <div className="muted small">
              {result.scored_total} scored questions · {result.rows.length - result.scored_total} trick question(s)
              excluded · {fmtMs(result.elapsed_ms)}
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Expected</th>
                  {result.ks.map((k) => (
                    <th key={k} className="num">
                      @{k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.question}</td>
                    <td className="mono small">
                      {r.expected_function ? (
                        <>
                          {r.expected_function} <span className="muted">· {r.expected_file}</span>
                        </>
                      ) : (
                        <span className="muted">nothing (trick question)</span>
                      )}
                    </td>
                    {result.ks.map((k) => {
                      const hit = r.hits[String(k)];
                      return (
                        <td key={k} className="num">
                          {hit == null ? (
                            <MinusCircle size={16} className="muted" aria-label="not scored" />
                          ) : hit ? (
                            <CheckCircle2 size={16} className="good-text" aria-label="hit" />
                          ) : (
                            <XCircle size={16} className="error-text" aria-label="miss" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function InsightsPage() {
  const { repo } = useApp();
  const [scope, setScope] = useState<"repo" | "all">("repo");
  const [traces, setTraces] = useState<Traces | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTraces(null);
    api
      .traces(scope === "repo" ? repo?.id : undefined)
      .then(setTraces)
      .catch((e) => setError(e.message));
  }, [scope, repo?.id]);

  const lat = traces?.latency;

  return (
    <div className="page page-wide">
      <PageHeader
        title="Insights"
        subtitle="Every answer is traced to traces.jsonl with model, prompt version, latency and token counts. This is the same log latency_report.py reads."
        actions={
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: "repo", label: repo ? repo.name : "This repo" },
              { value: "all", label: "All repos" },
            ]}
          />
        }
      />

      {error && <div className="callout callout-error">{error}</div>}

      {!traces ? (
        <div className="center-fill pad-l">
          <Spinner />
        </div>
      ) : traces.count === 0 ? (
        <EmptyState icon={<Activity size={26} />} title="No traced questions yet">
          Ask a few questions and latency and token usage will show up here.
        </EmptyState>
      ) : (
        <>
          <div className="stats-row">
            <StatTile label="Questions answered" value={fmtNum(traces.count)} />
            <StatTile label="Latency P50" value={fmtMs(lat?.total?.p50)} sub={`retrieval ${fmtMs(lat?.retrieval?.p50)}`} />
            <StatTile label="Latency P95" value={fmtMs(lat?.total?.p95)} sub={`generation ${fmtMs(lat?.generation?.p95)}`} />
            <StatTile
              label="Avg tokens / answer"
              value={fmtNum(Math.round(traces.tokens.input?.mean ?? 0))}
              sub={`in · ${fmtNum(Math.round(traces.tokens.output?.mean ?? 0))} out`}
            />
          </div>

          <section className="card section">
            <div className="section-head">
              <h2>Latency per question</h2>
              <span className="muted small">last {Math.min(40, traces.records.length)} · oldest → newest</span>
            </div>
            <LatencyChart records={traces.records} />
            <p className="muted small">
              Retrieval share of total at P50:{" "}
              <strong>{lat?.total && lat.retrieval ? fmtPct(lat.retrieval.p50 / lat.total.p50) : "—"}</strong>. Nearly all
              of the wait is the LLM, not search.
            </p>
          </section>

          <section className="card section">
            <div className="section-head">
              <h2>Trace log</h2>
              <span className="muted small">most recent first</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Time</th>
                    {scope === "all" && <th>Repo</th>}
                    <th>Model · prompt</th>
                    <th className="num">Chunks</th>
                    <th className="num">Retrieval</th>
                    <th className="num">Generation</th>
                    <th className="num">Tokens in → out</th>
                  </tr>
                </thead>
                <tbody>
                  {traces.records.slice(0, 50).map((r, i) => (
                    <tr key={i}>
                      <td className="nowrap">{fmtTime(r.timestamp)}</td>
                      {scope === "all" && <td className="mono small">{shortPath(r.repo_path ?? "", 1)}</td>}
                      <td className="mono small">
                        {r.model} · {r.prompt_version}
                      </td>
                      <td className="num">
                        {r.num_chunks_retrieved}
                        {r.num_related_chunks ? <span className="muted"> +{r.num_related_chunks}</span> : null}
                      </td>
                      <td className="num">{fmtMs(r.retrieval_latency_ms)}</td>
                      <td className="num">{fmtMs(r.generation_latency_ms)}</td>
                      <td className="num">
                        {fmtNum(r.input_tokens)} → {fmtNum(r.output_tokens)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <EvalSection />
    </div>
  );
}
