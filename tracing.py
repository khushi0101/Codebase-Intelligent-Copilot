"""Minimal tracing: one JSON line per LLM/tool call, written now so there is
already a log to read once the Observability project (Project 05) exists.
No framework, no new infra — just a timer and an append-only file, by design:
retrofitting this across four apps later is the exact pain the build guide
warns about."""

import time
import json

from config import TRACE_LOG_PATH


def log_trace(**fields):
    """Append one span record. Call this once per traced operation with
    whatever fields matter (model, prompt_version, token counts, latency...)."""
    record = {"timestamp": time.time(), **fields}
    try:
        with open(TRACE_LOG_PATH, "a") as f:
            f.write(json.dumps(record) + "\n")
    except Exception as e:
        print(f"Trace logging failed: {e}")


class timed:
    """Context manager for measuring a block's wall-clock time.

    with timed() as t:
        do_work()
    # t.ms now holds the elapsed time in milliseconds
    """

    def __enter__(self):
        self._start = time.perf_counter()
        self.ms = None
        return self

    def __exit__(self, *exc_info):
        self.ms = (time.perf_counter() - self._start) * 1000
        return False
