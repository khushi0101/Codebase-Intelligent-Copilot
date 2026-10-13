-- One-time setup for the vector store (local Postgres or Neon).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS embeddings (
    id SERIAL PRIMARY KEY,
    sentence TEXT,              -- chunk text
    embedding vector(384),
    file_path TEXT,
    start_line INTEGER,
    end_line INTEGER,
    chunk_length INTEGER
);

-- Every query filters by repo path prefix; this keeps that cheap as repos accumulate.
CREATE INDEX IF NOT EXISTS embeddings_file_path_idx ON embeddings (file_path text_pattern_ops);
