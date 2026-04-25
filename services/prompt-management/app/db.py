import os
from psycopg.rows import dict_row
import psycopg

def get_conn():
    return psycopg.connect(
        host=os.getenv("PROMPT_DB_HOST", "localhost"),
        port=os.getenv("PROMPT_DB_PORT", "5432"),
        dbname=os.getenv("PROMPT_DB_NAME", "agentdb"),
        user=os.getenv("PROMPT_DB_USER", "postgres"),
        password=os.getenv("PROMPT_DB_PASSWORD", "postgres"),
        row_factory=dict_row,
    )
