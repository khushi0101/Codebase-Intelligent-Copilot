from db_connection import connection
from pgvector.psycopg2 import register_vector
from embedder import encodings
from read_repo import get_all_chunks

register_vector(connection)


def clear_embeddings_table():
    cursor = connection.cursor()
    try:
        cursor.execute("TRUNCATE TABLE embeddings")
        connection.commit()
        print("Cleared existing embeddings table.")
    except Exception as e:
        print(f"Error clearing embeddings table: {e}")
        connection.rollback()
    finally:
        cursor.close()


def insert_embeddings(chunk):
    cursor = connection.cursor()
    try:
        cursor.execute(
            "INSERT INTO embeddings (sentence, embedding, file_path, start_line, end_line, chunk_length) VALUES (%s, %s, %s, %s, %s, %s)",
            (chunk["text"], chunk["embedding"].tolist(), chunk["file_path"], chunk["start_line"], chunk["end_line"], chunk["length"])
        )
        connection.commit()
    except Exception as e:
        print(f"Error inserting embedding for '{chunk['text']}': {e}")
    finally:
        cursor.close()


def seed(repo_path):
    clear_embeddings_table()
    chunks = get_all_chunks(repo_path)
    print(f"Seeding {len(chunks)} chunks from {repo_path}")
    for chunk in chunks:
        chunk["embedding"] = encodings(chunk["text"])
        insert_embeddings(chunk)
    print("Done.")


if __name__ == "__main__":
    import sys
    repo_path = sys.argv[1] if len(sys.argv) > 1 else "."
    seed(repo_path)