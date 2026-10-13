import time

import psycopg2
from pgvector.psycopg2 import register_vector

from config import DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME, DATABASE_URL


def _connect():
    if DATABASE_URL:
        conn = psycopg2.connect(DATABASE_URL)
    else:
        conn = psycopg2.connect(
            user=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
        )
    register_vector(conn)
    return conn


class _ReconnectingConnection:
    """Behaves like the psycopg2 connection every module imports, but reconnects
    when the server has dropped it. A one-shot CLI never notices; a long-running
    web server on a serverless Postgres (Neon suspends idle compute and closes
    connections) otherwise fails every query after the first idle period."""

    PING_AFTER_IDLE_S = 60

    def __init__(self):
        self._conn = _connect()
        self._last_used = time.monotonic()

    def _ensure(self):
        if self._conn.closed:
            self._conn = _connect()
        elif time.monotonic() - self._last_used > self.PING_AFTER_IDLE_S:
            try:
                with self._conn.cursor() as cur:
                    cur.execute("SELECT 1")
                self._conn.rollback()
            except (psycopg2.OperationalError, psycopg2.InterfaceError):
                self._conn = _connect()
        self._last_used = time.monotonic()

    def cursor(self, *args, **kwargs):
        self._ensure()
        return self._conn.cursor(*args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._conn, name)


connection = _ReconnectingConnection()
