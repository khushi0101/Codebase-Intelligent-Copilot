from tree_sitter import Language, Parser
import tree_sitter_python as tspython
from read_repo import get_all_chunks

PY_LANGUAGE = Language(tspython.language())
parser = Parser(PY_LANGUAGE)


def extract_called_names(node, names):
    if node.type == "call":
        func_node = node.children[0]
        if func_node.type == "identifier":
            names.append(func_node.text.decode("utf-8"))
        elif func_node.type == "attribute":
            for child in func_node.children:
                if child.type == "identifier":
                    names.append(child.text.decode("utf-8"))

    for child in node.children:
        extract_called_names(child, names)


def get_callees_for_chunk(chunk_text):
    tree = parser.parse(bytes(chunk_text, "utf-8"))
    names = []
    extract_called_names(tree.root_node, names)
    return names


def build_call_graph(repo_path):
    """Builds function_index and callers_of for one specific repo, on demand."""
    all_chunks = get_all_chunks(repo_path)

    for chunk in all_chunks:
        chunk["callees"] = get_callees_for_chunk(chunk["text"])

    # function_index: (file_path, function_name) -> chunk
    function_index = {
        (chunk["file_path"], chunk["function_name"]): chunk
        for chunk in all_chunks
        if chunk["function_name"] is not None
    }

    # callers_of: called_function_name -> list of (file_path, caller_name) that call it
    callers_of = {}
    for chunk in all_chunks:
        if chunk["function_name"] is None:
            continue
        caller_key = (chunk["file_path"], chunk["function_name"])
        for called_name in chunk["callees"]:
            callers_of.setdefault(called_name, []).append(caller_key)

    return function_index, callers_of


def get_related_chunks(function_index, callers_of, file_path, function_name, max_each=2):
    """Given a specific (file_path, function_name), return (callees, callers) as chunk dicts."""
    key = (file_path, function_name)
    chunk = function_index.get(key)
    if chunk is None:
        return [], []

    callee_chunks = []
    for name in chunk["callees"][:max_each]:
        # prefer a same-file match first
        same_file_match = function_index.get((file_path, name))
        if same_file_match and (file_path, name) != key:
            callee_chunks.append(same_file_match)
            continue

        # fallback: any file with this function name
        other_matches = [c for (fp, fn), c in function_index.items() if fn == name and (fp, fn) != key]
        if other_matches:
            callee_chunks.append(other_matches[0])

    caller_keys = callers_of.get(function_name, [])[:max_each]
    caller_chunks = [
        function_index[k] for k in caller_keys
        if k in function_index and k != key
    ]

    return callee_chunks, caller_chunks