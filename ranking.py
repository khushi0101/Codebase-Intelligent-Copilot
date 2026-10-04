def reciprocal_rank_fusion(result_lists, k=60):
    scores = {}
    chunk_data = {}

    for results in result_lists:
        for rank, chunk in enumerate(results, start=1):
            file_path, start_line, end_line = chunk[0], chunk[1], chunk[2]
            key = (file_path, start_line, end_line)
            scores[key] = scores.get(key, 0) + 1 / (k + rank)
            chunk_data[key] = chunk

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    return [chunk_data[key] for key, score in ranked]