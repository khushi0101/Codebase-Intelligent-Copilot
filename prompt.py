from config import PROMPT_VERSION
from prompt_registry import load_prompt_template


def format_chunk_block(file_path, start_line, end_line, text, label=None):
    header = f"File: {file_path} (lines {start_line}-{end_line})"
    if label:
        header = f"{label} — {header}"
    return f"{header}\n```\n{text}\n```"


def build_prompt(question, chunks, related_chunks=None, prompt_version=None):
    """Returns (prompt_text, prompt_version) so the caller can log exactly
    which template produced this answer."""
    version = prompt_version or PROMPT_VERSION
    context_blocks = []

    for file_path, start_line, end_line, text, *_ in chunks:
        context_blocks.append(format_chunk_block(file_path, start_line, end_line, text))

    if related_chunks:
        for chunk, label in related_chunks:
            context_blocks.append(format_chunk_block(
                chunk["file_path"], chunk["start_line"], chunk["end_line"], chunk["text"], label=label
            ))

    context = "\n\n".join(context_blocks)
    template = load_prompt_template(version)
    prompt = template.format(context=context, question=question)
    return prompt, version
