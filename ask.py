from google import genai
from search_query import vector_search, keyword_search
from prompt import build_prompt
from ranking import reciprocal_rank_fusion
from call_graph import build_call_graph, get_related_chunks
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from config import GEMINI_MODEL, RETRIEVAL_K, FINAL_K
from tracing import log_trace, timed

_client = None


def get_client(api_key=None):
    """A visitor-supplied key gets its own short-lived client; otherwise share one
    built from GEMINI_API_KEY. Created lazily so a server can start (and serve
    bring-your-own-key users) even when it has no key of its own."""
    global _client
    if api_key:
        return genai.Client(api_key=api_key)
    if _client is None:
        _client = genai.Client()
    return _client


def get_function_info_from_chunk(chunk):
    file_path = chunk[0]
    text = chunk[3]
    first_line = text.strip().split("\n")[0]
    function_name = None
    if first_line.startswith("def "):
        function_name = first_line[4:].split("(")[0].strip()
    return file_path, function_name


def _is_retryable(e):
    # Bad requests / bad keys won't succeed on retry; rate limits (429) and server errors might.
    code = getattr(e, "code", None)
    return not (isinstance(code, int) and 400 <= code < 500 and code != 429)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=10), retry=retry_if_exception(_is_retryable))
def call_gemini(prompt):
    return get_client().models.generate_content(model=GEMINI_MODEL, contents=prompt)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=10), retry=retry_if_exception(_is_retryable))
def call_gemini_stream(prompt, client):
    # Only opening the stream is retried; a failure mid-stream surfaces to the caller.
    return client.models.generate_content_stream(model=GEMINI_MODEL, contents=prompt)


def retrieve_context(question, repo_path, retrieval_k=RETRIEVAL_K, final_k=FINAL_K, expand_graph=True):
    """Hybrid retrieval + call-graph expansion, without the LLM call. Returned
    as a dict so callers (CLI, web API) can show the evidence, not just the answer."""
    with timed() as retrieval_time:
        vector_results = vector_search(question, repo_path, top_k=retrieval_k)
        keyword_results = keyword_search(question, repo_path, top_k=retrieval_k)
        fused = reciprocal_rank_fusion([vector_results, keyword_results])
        top_chunks = fused[:final_k]

        related_chunks = []
        if expand_graph and top_chunks:
            function_index, callers_of = build_call_graph(repo_path)
            best_chunk = top_chunks[0]
            file_path, function_name = get_function_info_from_chunk(best_chunk)

            if function_name:
                callees, callers = get_related_chunks(function_index, callers_of, file_path, function_name)
                for c in callees:
                    related_chunks.append((c, "Related (called by this function)"))
                for c in callers:
                    related_chunks.append((c, "Related (calls this function)"))

    return {
        "vector_results": vector_results,
        "keyword_results": keyword_results,
        "top_chunks": top_chunks,
        "related_chunks": related_chunks,
        "retrieval_ms": retrieval_time.ms,
    }


def _log_answer_trace(repo_path, retrieval_k, final_k, context, prompt_version, generation_ms, usage):
    log_trace(
        function="ask_gemini",
        model=GEMINI_MODEL,
        prompt_version=prompt_version,
        repo_path=repo_path,
        retrieval_k=retrieval_k,
        final_k=final_k,
        num_chunks_retrieved=len(context["top_chunks"]),
        num_related_chunks=len(context["related_chunks"]),
        retrieval_latency_ms=round(context["retrieval_ms"], 2),
        generation_latency_ms=round(generation_ms, 2),
        total_latency_ms=round(context["retrieval_ms"] + generation_ms, 2),
        input_tokens=getattr(usage, "prompt_token_count", None),
        output_tokens=getattr(usage, "candidates_token_count", None),
    )


def ask_gemini(question, repo_path, retrieval_k=RETRIEVAL_K, final_k=FINAL_K, expand_graph=True):
    context = retrieve_context(question, repo_path, retrieval_k, final_k, expand_graph)
    prompt, prompt_version = build_prompt(question, context["top_chunks"], related_chunks=context["related_chunks"])

    with timed() as generation_time:
        response = call_gemini(prompt)

    usage = getattr(response, "usage_metadata", None)
    _log_answer_trace(repo_path, retrieval_k, final_k, context, prompt_version, generation_time.ms, usage)

    return response.text


def ask_gemini_stream(question, repo_path, context, retrieval_k=RETRIEVAL_K, final_k=FINAL_K, api_key=None):
    """Streaming variant for the web UI. Takes an already-retrieved `context`
    (from retrieve_context) so the caller can show sources before the answer.
    Yields text pieces; returns a stats dict via StopIteration.value. api_key, if
    given, is used for this call only and never logged."""
    prompt, prompt_version = build_prompt(question, context["top_chunks"], related_chunks=context["related_chunks"])

    usage = None
    # Hold the client for the whole stream: a per-request client that gets garbage
    # collected mid-iteration closes its HTTP connection under the stream.
    client = get_client(api_key)
    with timed() as generation_time:
        for piece in call_gemini_stream(prompt, client):
            if getattr(piece, "usage_metadata", None):
                usage = piece.usage_metadata
            if piece.text:
                yield piece.text

    _log_answer_trace(repo_path, retrieval_k, final_k, context, prompt_version, generation_time.ms, usage)

    return {
        "prompt_version": prompt_version,
        "model": GEMINI_MODEL,
        "generation_ms": generation_time.ms,
        "input_tokens": getattr(usage, "prompt_token_count", None),
        "output_tokens": getattr(usage, "candidates_token_count", None),
    }
