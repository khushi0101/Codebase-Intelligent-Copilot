import os
import json
import hashlib

from read_repo import list_python_files, chunk_file
from db_connection import connection
from pgvector.psycopg2 import register_vector
from embedder import encodings
import sqlite3

register_vector(connection)

def ensure_sqlite_table():
    conn = sqlite3.connect("keyword_index.db")
    cursor = conn.cursor()
    try:
        cursor.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
            USING fts5(text, file_path, start_line, end_line)
        """)
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def get_hash_file_path(repo_path):
    """One hash-state file per repo, stored alongside this script, named by a hash of the repo path
    so different repos don't clobber each other's state."""
    repo_id = hashlib.md5(repo_path.encode("utf-8")).hexdigest()[:10]
    return f"index_state_{repo_id}.json"


def compute_hash(content):
    return hashlib.md5(content.encode("utf-8")).hexdigest()


def load_previous_hashes(hash_file):
    if os.path.exists(hash_file):
        with open(hash_file, "r") as f:
            return json.load(f)
    return {}


def save_hashes(hash_file, hashes):
    with open(hash_file, "w") as f:
        json.dump(hashes, f, indent=2)


def get_changed_files(python_files, previous_hashes):
    changed = []
    current_hashes = {}

    for path in python_files:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        file_hash = compute_hash(content)
        current_hashes[path] = file_hash

        if previous_hashes.get(path) != file_hash:
            changed.append(path)

    return changed, current_hashes


def get_deleted_files(python_files, previous_hashes):
    current_paths = set(python_files)
    previous_paths = set(previous_hashes.keys())
    return previous_paths - current_paths


def delete_old_chunks_postgres(file_path):
    cursor = connection.cursor()
    try:
        cursor.execute("DELETE FROM embeddings WHERE file_path = %s", (file_path,))
        connection.commit()
    except Exception as e:
        print(f"Error deleting old Postgres chunks for {file_path}: {e}")
    finally:
        cursor.close()


def delete_old_chunks_sqlite(file_path):
    conn = sqlite3.connect("keyword_index.db")
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM chunks_fts WHERE file_path = ?", (file_path,))
        conn.commit()
    except Exception as e:
        print(f"Error deleting old SQLite chunks for {file_path}: {e}")
    finally:
        cursor.close()
        conn.close()


def insert_chunk_postgres(chunk):
    cursor = connection.cursor()
    try:
        cursor.execute(
            "INSERT INTO embeddings (sentence, embedding, file_path, start_line, end_line, chunk_length) VALUES (%s, %s, %s, %s, %s, %s)",
            (chunk["text"], chunk["embedding"].tolist(), chunk["file_path"], chunk["start_line"], chunk["end_line"], chunk["length"])
        )
        connection.commit()
    except Exception as e:
        print(f"Error inserting Postgres chunk for '{chunk['file_path']}': {e}")
    finally:
        cursor.close()


def insert_chunk_sqlite(chunk):
    conn = sqlite3.connect("keyword_index.db")
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO chunks_fts (text, file_path, start_line, end_line) VALUES (?, ?, ?, ?)",
            (chunk["text"], chunk["file_path"], chunk["start_line"], chunk["end_line"])
        )
        conn.commit()
    except Exception as e:
        print(f"Error inserting SQLite chunk for '{chunk['file_path']}': {e}")
    finally:
        cursor.close()
        conn.close()


def reindex_file(path):
    print(f"Re-indexing: {path}")
    delete_old_chunks_postgres(path)
    delete_old_chunks_sqlite(path)

    chunks = chunk_file(path)
    for chunk in chunks:
        chunk["embedding"] = encodings(chunk["text"])
        insert_chunk_postgres(chunk)
        insert_chunk_sqlite(chunk)

    print(f"  -> {len(chunks)} chunks re-indexed")


def run_incremental_index(repo_path):
    ensure_sqlite_table()
    hash_file = get_hash_file_path(repo_path)
    python_files = list_python_files(repo_path)
    previous_hashes = load_previous_hashes(hash_file)

    changed_files, current_hashes = get_changed_files(python_files, previous_hashes)
    deleted_files = get_deleted_files(python_files, previous_hashes)

    if not changed_files and not deleted_files:
        print("No files changed or deleted since last index. Nothing to do.")
        return

    if deleted_files:
        print(f"{len(deleted_files)} file(s) deleted since last index.")
        for path in deleted_files:
            print(f"Removing chunks for deleted file: {path}")
            delete_old_chunks_postgres(path)
            delete_old_chunks_sqlite(path)

    if changed_files:
        print(f"{len(changed_files)} file(s) changed or added out of {len(python_files)} total.")
        for path in changed_files:
            reindex_file(path)

    save_hashes(hash_file, current_hashes)
    print("Index state updated.")


if __name__ == "__main__":
    import sys
    repo_path = sys.argv[1] if len(sys.argv) > 1 else "."
    run_incremental_index(repo_path)