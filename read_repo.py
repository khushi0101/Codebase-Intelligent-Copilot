import os
from tree_sitter import Language, Parser
import tree_sitter_python as tspython

PY_LANGUAGE = Language(tspython.language())
parser = Parser(PY_LANGUAGE)


def list_python_files(repo_path):
    python_files = []
    for root, dirs, files in os.walk(repo_path):
        for file in files:
            if file.endswith(".py"):
                python_files.append(os.path.join(root, file))
    return python_files


def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def get_function_name(node):
    for child in node.children:
        if child.type == "identifier":
            return child.text.decode("utf-8")
    return None


def walk_tree(node, source_bytes, chunks, file_path=None):
    if node.type == "function_definition":
        start_line = node.start_point.row + 1
        end_line = node.end_point.row + 1
        chunk_text = source_bytes[node.start_byte:node.end_byte].decode("utf-8")
        function_name = get_function_name(node)
        chunks.append({
            "text": chunk_text,
            "start_line": start_line,
            "end_line": end_line,
            "file_path": file_path,
            "length": end_line - start_line + 1,
            "function_name": function_name
        })
        return

    for child in node.children:
        walk_tree(child, source_bytes, chunks, file_path=file_path)


def chunk_file(path):
    content = read_file(path)
    content_bytes = bytes(content, "utf-8")
    tree = parser.parse(content_bytes)
    chunks = []
    walk_tree(tree.root_node, content_bytes, chunks, file_path=path)
    return chunks


def get_all_chunks(repo_path):
    """Replaces the old module-level all_chunks — now an explicit function call."""
    python_files = list_python_files(repo_path)
    all_chunks = []
    for path in python_files:
        all_chunks.extend(chunk_file(path))
    return all_chunks