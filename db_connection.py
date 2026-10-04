import psycopg2

from config import DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME

connection = psycopg2.connect(
    user=DB_USER,
    password=DB_PASSWORD,
    host=DB_HOST,
    port=DB_PORT,
    database=DB_NAME,
)
