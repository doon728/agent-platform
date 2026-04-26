FROM python:3.11-slim

WORKDIR /app
ENV PYTHONPATH=/app/src

RUN pip install --no-cache-dir poetry

COPY services/rag/pyproject.toml services/rag/poetry.lock* /app/
RUN poetry config virtualenvs.create false \
 && poetry install --no-interaction --no-ansi --no-root

COPY services/rag/src/ /app/src/
COPY services/rag/data/ /app/data/
COPY services/rag/bootstrap_kb.py /app/bootstrap_kb.py

EXPOSE 8082

CMD ["poetry", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8082"]
