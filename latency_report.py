"""Reads traces.jsonl (written by tracing.log_trace) and prints P50/P95
latency — the metric the README currently lists as not yet measured.
Run this after asking a handful of questions through `codecopilot ask`."""

import json
import statistics

from config import TRACE_LOG_PATH


def percentile(values, pct):
    values = sorted(values)
    if not values:
        return None
    k = (len(values) - 1) * (pct / 100)
    f, c = int(k), min(int(k) + 1, len(values) - 1)
    if f == c:
        return values[f]
    return values[f] + (values[c] - values[f]) * (k - f)


def main():
    total_latencies, retrieval_latencies, generation_latencies = [], [], []

    try:
        with open(TRACE_LOG_PATH) as f:
            for line in f:
                record = json.loads(line)
                if "total_latency_ms" in record:
                    total_latencies.append(record["total_latency_ms"])
                if "retrieval_latency_ms" in record:
                    retrieval_latencies.append(record["retrieval_latency_ms"])
                if "generation_latency_ms" in record:
                    generation_latencies.append(record["generation_latency_ms"])
    except FileNotFoundError:
        print(f"No trace log yet at {TRACE_LOG_PATH} — ask a few questions first.")
        return

    def report(name, values):
        if not values:
            print(f"{name}: no data yet")
            return
        print(
            f"{name}: n={len(values)}  "
            f"P50={percentile(values, 50):.0f}ms  "
            f"P95={percentile(values, 95):.0f}ms  "
            f"mean={statistics.mean(values):.0f}ms"
        )

    report("Total (retrieval + generation)", total_latencies)
    report("Retrieval only", retrieval_latencies)
    report("Generation only", generation_latencies)


if __name__ == "__main__":
    main()
