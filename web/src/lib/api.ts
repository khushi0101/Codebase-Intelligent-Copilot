import { getUserKey } from "./userKey";
import { visitorId } from "./visitor";

// Typed client for the FastAPI layer in ../api.py.

export interface Health {
  database: boolean;
  llm_key: boolean;
  llm_model: string;
  embedding_model: string;
  prompt_version: string;
  /** Public (hosted) mode: GitHub URLs only, rate-limited, no destructive actions. */
  public: boolean;
  source_url: string | null;
  limits?: { max_py_files: number; max_repo_mb: number; questions_per_hour: number };
}

export interface IndexSummary {
  total_files: number;
  changed_files: number;
  deleted_files: number;
  chunks_indexed: number;
}

export interface Repo {
  id: string;
  source_url?: string | null;
  demo?: boolean;
  path: string;
  name: string;
  indexed: boolean;
  exists: boolean;
  file_count: number;
  chunk_count: number | null;
  last_indexed_at: number | null;
  last_summary: IndexSummary | null;
  indexing: boolean;
  added_at?: number | null;
}

export interface JobEvent {
  type: "stage" | "start" | "file" | "deleted" | "done";
  t: number;
  message?: string;
  path?: string;
  chunks?: number;
  done?: number;
  total?: number;
  total_files?: number;
  changed_files?: number;
  deleted_files?: number;
}

export interface Job {
  id: string;
  repo_id: string;
  path: string;
  full: boolean;
  status: "running" | "done" | "error";
  events: JobEvent[];
  summary: IndexSummary | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

export interface Chunk {
  file_path: string;
  rel_path: string;
  start_line: number;
  end_line: number;
  text: string;
  function_name: string | null;
}

export interface SourceChunk extends Chunk {
  vector_rank: number | null;
  vector_distance: number | null;
  keyword_rank: number | null;
  rrf_score: number;
}

export interface RelatedChunk extends Chunk {
  label: string;
}

export interface Citation {
  file_path: string;
  rel_path: string;
  start_line: number;
  end_line: number;
  raw: string;
  valid: boolean;
}

export interface AnswerStats {
  prompt_version: string;
  model: string;
  generation_ms: number;
  retrieval_ms: number;
  total_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
}

export type AskEvent =
  | { type: "context"; sources: SourceChunk[]; related: RelatedChunk[]; retrieval_ms: number }
  | { type: "token"; text: string }
  | { type: "done"; citations: Citation[]; stats: AnswerStats }
  | { type: "error"; message: string };

export interface RepoFile {
  file_path: string;
  rel_path: string;
  functions: { name: string; start_line: number; end_line: number }[];
}

export interface GraphNode {
  file_path: string;
  rel_path: string;
  function_name: string;
  start_line: number;
  end_line: number;
}

export interface CallGraph {
  function: GraphNode;
  callers: GraphNode[];
  callees: GraphNode[];
  unresolved_calls: string[];
}

export interface SearchResult {
  vector: (Chunk & { distance: number })[];
  keyword: Chunk[];
  fused: SourceChunk[];
  latency_ms: number;
}

export interface LatencyStats {
  n: number;
  p50: number;
  p95: number;
  mean: number;
}

export interface TraceRecord {
  timestamp: number;
  function: string;
  model: string;
  prompt_version: string;
  repo_path: string;
  retrieval_k: number;
  final_k: number;
  num_chunks_retrieved: number;
  num_related_chunks: number;
  retrieval_latency_ms: number;
  generation_latency_ms: number;
  total_latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface Traces {
  count: number;
  latency: { total: LatencyStats | null; retrieval: LatencyStats | null; generation: LatencyStats | null };
  tokens: { input: LatencyStats | null; output: LatencyStats | null };
  records: TraceRecord[];
}

export interface EvalRow {
  question: string;
  expected_function: string | null;
  expected_file: string | null;
  scored: boolean;
  hits: Record<string, boolean | null>;
}

export interface EvalResult {
  rows: EvalRow[];
  recall: Record<string, number>;
  scored_total: number;
  ks: number[];
  elapsed_ms: number;
}

export interface AppConfig {
  settings: Record<string, string | number>;
  defaults: { retrieval_k: number; final_k: number };
  prompt_versions: string[];
  prompts: Record<string, string>;
}

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", "X-Visitor-Id": visitorId(), ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("Can't reach the Copilot server. Is `codecopilot serve` running?");
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail);
  }
  return res.json() as Promise<T>;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  health: () => request<Health>("/api/health"),
  config: () => request<AppConfig>("/api/config"),
  repos: () => request<Repo[]>("/api/repos"),
  addRepo: (source: string) => request<{ repo_id: string; job_id: string | null }>("/api/repos", post({ path: source })),
  indexRepo: (id: string, full = false) => request<{ job_id: string }>(`/api/repos/${id}/index`, post({ full })),
  deleteRepo: (id: string) => request<{ ok: boolean }>(`/api/repos/${id}`, { method: "DELETE" }),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
  jobs: () => request<Job[]>("/api/jobs"),
  files: (id: string) => request<RepoFile[]>(`/api/repos/${id}/files`),
  file: (id: string, path: string) =>
    request<{ file_path: string; rel_path: string; content: string }>(
      `/api/repos/${id}/file?path=${encodeURIComponent(path)}`,
    ),
  graph: (id: string, path: string, fn: string) =>
    request<CallGraph>(
      `/api/repos/${id}/graph?path=${encodeURIComponent(path)}&function=${encodeURIComponent(fn)}`,
    ),
  search: (repo_id: string, query: string, k: number) => request<SearchResult>("/api/search", post({ repo_id, query, k })),
  traces: (repo_id?: string) => request<Traces>(`/api/traces?limit=200${repo_id ? `&repo_id=${repo_id}` : ""}`),
  evalRecall: (repo_id: string, ks: number[]) => request<EvalResult>("/api/eval/recall", post({ repo_id, ks })),
};

export interface AskParams {
  repo_id: string;
  question: string;
  retrieval_k: number;
  final_k: number;
  expand_graph: boolean;
}

/** POSTs the question and yields server-sent events as they arrive. */
export async function* streamAsk(params: AskParams, signal?: AbortSignal): AsyncGenerator<AskEvent> {
  let res: Response;
  try {
    const key = getUserKey();
    res = await fetch("/api/ask", {
      ...post(params),
      headers: {
        "Content-Type": "application/json",
        "X-Visitor-Id": visitorId(),
        ...(key ? { "X-Gemini-Key": key } : {}),
      },
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Can't reach the Copilot server. Is `codecopilot serve` running?");
  }
  if (!res.ok || !res.body) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      if (data) yield JSON.parse(data) as AskEvent;
    }
  }
}
