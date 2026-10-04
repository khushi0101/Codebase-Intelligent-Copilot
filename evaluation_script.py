from gold_set import gold_set
from search_query import vector_search, keyword_search
from ranking import reciprocal_rank_fusion


def chunk_matches_expected(chunk, expected_function, expected_file):
    file_path, start_line, end_line, text = chunk[0], chunk[1], chunk[2], chunk[3]

    file_matches = expected_file in file_path
    function_matches = f"def {expected_function}" in text
    return file_matches and function_matches


def evaluate_recall(k=3, repo_path="."):
    """NOTE: vector_search/keyword_search require repo_path now (it scopes
    queries to one repo) — this previously called them without it and would
    raise a TypeError before ever running. Trick questions (expected_function
    is None) are reported but excluded from the recall denominator, since
    retrieval always returns *some* nearest chunks and "nothing should match"
    isn't a thing retrieval-recall can score on its own."""
    hits = 0
    scored_total = 0

    for item in gold_set:
        question = item["question"]
        expected_function = item["expected_function"]
        expected_file = item["expected_file"]

        vector_results = vector_search(question, repo_path, top_k=k)
        keyword_results = keyword_search(question, repo_path, top_k=k)
        fused = reciprocal_rank_fusion([vector_results, keyword_results])
        top_chunks = fused[:k]

        if expected_function is None:
            print(f"[SKIP] {question} (trick question — not scored for recall)")
            continue

        scored_total += 1
        found = any(
            chunk_matches_expected(chunk, expected_function, expected_file)
            for chunk in top_chunks
        )
        status = "HIT" if found else "MISS"
        print(f"[{status}] {question}")
        if found:
            hits += 1

    recall = hits / scored_total if scored_total else 0
    print(f"\nRecall@{k}: {recall:.2%} ({hits}/{scored_total})")
    return recall


if __name__ == "__main__":
    import sys

    repo_path = sys.argv[1] if len(sys.argv) > 1 else "."
    for k in [3, 5, 10]:
        evaluate_recall(k=k, repo_path=repo_path)
