def format_chunk_block(file_path, start_line, end_line, text, label=None):
    header = f"File: {file_path} (lines {start_line}-{end_line})"
    if label:
        header = f"{label} — {header}"
    return f"{header}\n```\n{text}\n```"


def build_prompt(question, chunks, related_chunks=None):
    context_blocks = []

    for file_path, start_line, end_line, text, *_ in chunks:
        context_blocks.append(format_chunk_block(file_path, start_line, end_line, text))

    if related_chunks:
        for chunk, label in related_chunks:
            context_blocks.append(format_chunk_block(
                chunk["file_path"], chunk["start_line"], chunk["end_line"], chunk["text"], label=label
            ))

    context = "\n\n".join(context_blocks)

    prompt = f"""You are a codebase assistant. Answer the question using ONLY the code context below.
        Always cite the file path and line numbers for any claim you make, in the format (file.py:12-20).
        Some context is marked as "Related" — this is supplementary (callers or callees), not the primary match. Use it to enrich your answer, not as the main subject unless the question specifically asks about relationships.
        If the context doesn't contain enough information to answer, say so — do not guess.

        Context:
        {context}

        Question: {question}

        Answer:"""
    return prompt