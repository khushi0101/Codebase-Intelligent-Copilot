from google import genai
from search_query import vector_search, keyword_search
from prompt import build_prompt
from ranking import reciprocal_rank_fusion
from call_graph import build_call_graph, get_related_chunks
from tenacity import retry, stop_after_attempt, wait_exponential

from config import GEMINI_MODEL, RETRIEVAL_K, FINAL_K
from tracing import log_trace, timed

client = genai.Client()


def get_function_info_from_chunk(chunk):
    file_path = chunk[0]
    text = chunk[3]
    first_line = text.strip().split("\n")[0]
    function_name = None
    if first_line.startswith("def "):
        function_name = first_line[4:].split("(")[0].strip()
    return file_path, function_name


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=10))
def call_gemini(prompt):
    return client.models.generate_content(model=GEMINI_MODEL, contents=prompt)


def ask_gemini(question, repo_path, retrieval_k=RETRIEVAL_K, final_k=FINAL_K, expand_graph=True):
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

    prompt, prompt_version = build_prompt(question, top_chunks, related_chunks=related_chunks)

    with timed() as generation_time:
        response = call_gemini(prompt)

    usage = getattr(response, "usage_metadata", None)
    log_trace(
        function="ask_gemini",
        model=GEMINI_MODEL,
        prompt_version=prompt_version,
        repo_path=repo_path,
        retrieval_k=retrieval_k,
        final_k=final_k,
        num_chunks_retrieved=len(top_chunks),
        num_related_chunks=len(related_chunks),
        retrieval_latency_ms=round(retrieval_time.ms, 2),
        generation_latency_ms=round(generation_time.ms, 2),
        total_latency_ms=round(retrieval_time.ms + generation_time.ms, 2),
        input_tokens=getattr(usage, "prompt_token_count", None),
        output_tokens=getattr(usage, "candidates_token_count", None),
    )

    return response.text
