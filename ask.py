from google import genai
from search_query import vector_search, keyword_search
from prompt import build_prompt
from ranking import reciprocal_rank_fusion
from call_graph import build_call_graph, get_related_chunks
from tenacity import retry, stop_after_attempt, wait_exponential

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
    response = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
    return response.text


def ask_gemini(question, repo_path, retrieval_k=5, final_k=5, expand_graph=True):
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

    prompt = build_prompt(question, top_chunks, related_chunks=related_chunks)
    return call_gemini(prompt)