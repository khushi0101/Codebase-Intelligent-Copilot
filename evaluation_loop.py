import re

def extract_citations(answer_text):
    # matches patterns like (file.py:12-20) or (file.py:12)
    pattern = r"\(([\w/.\-]+\.py):(\d+)(?:-(\d+))?\)"
    matches = re.findall(pattern, answer_text)
    citations = []
    for file_path, start, end in matches:
        citations.append({
            "file_path": file_path,
            "start_line": int(start),
            "end_line": int(end) if end else int(start)
        })
    return citations


def citation_is_valid(citation, provided_chunks):
    for chunk in provided_chunks:
        chunk_file = chunk[0]
        chunk_start = chunk[1]
        chunk_end = chunk[2]

        # citation's file must match (allowing partial path match, since Gemini
        # might shorten the full path), and its line range must overlap the chunk's
        file_matches = citation["file_path"] in chunk_file or chunk_file.endswith(citation["file_path"])
        lines_overlap = (
            citation["start_line"] <= chunk_end and
            citation["end_line"] >= chunk_start
        )
        if file_matches and lines_overlap:
            return True
    return False


def check_citation_validity(answer_text, provided_chunks):
    citations = extract_citations(answer_text)
    if not citations:
        return {"total": 0, "valid": 0, "invalid": 0, "validity_rate": None}

    valid_count = sum(1 for c in citations if citation_is_valid(c, provided_chunks))
    total = len(citations)

    return {
        "total": total,
        "valid": valid_count,
        "invalid": total - valid_count,
        "validity_rate": valid_count / total
    }