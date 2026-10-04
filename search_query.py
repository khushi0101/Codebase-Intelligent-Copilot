from db_connection import connection
from pgvector.psycopg2 import register_vector
from embedder import encodings
import sqlite3
import re


register_vector(connection)

def sanitize_query(text):
    
    return re.sub(r"[^\w\s]", "", text)

def vector_search(query, repo_path, top_k=3):
    query_embedding = encodings(query)
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT file_path, start_line, end_line, sentence,
                   embedding <-> %s AS distance
            FROM embeddings
            WHERE file_path LIKE %s
            ORDER BY distance
            LIMIT %s
            """,
            (query_embedding, f"{repo_path}%", top_k)
        )
        results = cursor.fetchall()
    except Exception as e:
        print(f"Vector Search Error for '{query}': {e}")
        results = []
    finally:
        cursor.close()
    return results


def keyword_search(query, repo_path, top_k=3):
    conn = sqlite3.connect("keyword_index.db")
    cursor = conn.cursor()
    clean_query = sanitize_query(query)
    try:
        cursor.execute(
            """
            SELECT file_path, start_line, end_line, text
            FROM chunks_fts
            WHERE chunks_fts MATCH ? AND file_path LIKE ?
            ORDER BY rank
            LIMIT ?
            """,
            (clean_query, f"{repo_path}%", top_k)
        )
        results = cursor.fetchall()
    except Exception as e:
        print(f"Keyword Search Error for '{clean_query}': {e}")
        results = []
    finally:
        cursor.close()
        conn.close()
    return results

# if __name__ == "__main__":
#     results = search("Where is the database connection set up?")
    # for file_path, start_line, end_line, sentence, distance in results:
    #     print(f"{distance:.4f} — {sentence}")