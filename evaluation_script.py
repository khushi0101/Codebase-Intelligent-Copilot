from gold_set import gold_set
from search_query import vector_search, keyword_search
from ranking import reciprocal_rank_fusion

def chunk_matches_expected(chunk, expected_function, expected_file):
    file_path, start_line, end_line, text = chunk[0], chunk[1], chunk[2], chunk[3]
    
    file_matches = expected_file in file_path
    function_matches = f"def {expected_function}" in text
    return file_matches and function_matches

def evaluate_recall(k=3):
    hits = 0
    total = len(gold_set)

    for item in gold_set:
        question = item["question"]
        expected_function = item["expected_function"]
        expected_file = item["expected_file"]

        vector_results = vector_search(question, top_k=k)
        keyword_results = keyword_search(question, top_k=k)
        fused = reciprocal_rank_fusion([vector_results, keyword_results])
        top_chunks = fused[:k]

        found = any(
            chunk_matches_expected(chunk, expected_function, expected_file)
            for chunk in top_chunks
        )

        status = "HIT" if found else "MISS"
        print(f"[{status}] {question}")

        if found:
            hits += 1

    recall = hits / total
    print(f"\nRecall@{k}: {recall:.2%} ({hits}/{total})")
    return recall

if __name__ == "__main__":
    for k in [3, 5, 10]:
        evaluate_recall(k=k)