import sqlite3
from read_repo import all_chunks

conn = sqlite3.connect("keyword_index.db")
cursor = conn.cursor()

try:
    # drop first so every run starts clean — no leftover/duplicate rows from previous runs
    cursor.execute("DROP TABLE IF EXISTS chunks_fts")

    cursor.execute("""
        CREATE VIRTUAL TABLE chunks_fts
        USING fts5(text, file_path, start_line, end_line)
    """)

    for chunk in all_chunks:
        try:
            cursor.execute(
                "INSERT INTO chunks_fts (text, file_path, start_line, end_line) VALUES (?, ?, ?, ?)",
                (chunk["text"], chunk["file_path"], chunk["start_line"], chunk["end_line"])
            )
        except Exception as e:
            print(f"Error inserting chunk from {chunk['file_path']} (lines {chunk['start_line']}-{chunk['end_line']}): {e}")

    conn.commit()

except Exception as e:
    print(f"Error setting up FTS table: {e}")
    conn.rollback()

finally:
    cursor.execute("SELECT COUNT(*) FROM chunks_fts")
    print(f"Total rows inserted: {cursor.fetchone()[0]}")
    conn.close()