FROM python:3.11-slim

WORKDIR /app
ENV PYTHONPATH=/app

RUN pip install --no-cache-dir poetry

COPY ./services/agent-runtime/pyproject.toml ./services/agent-runtime/poetry.lock* /app/

RUN poetry config virtualenvs.create false \
 && poetry install --no-interaction --no-ansi --no-root

COPY ./services/agent-runtime/config/ /app/config
COPY ./services/agent-runtime/src/ /app/src
COPY platform/ /app/platform
EXPOSE 8080

# Run a server (do NOT run the graph at container boot)
CMD ["poetry", "run", "uvicorn", "src.platform.app:app", "--host", "0.0.0.0", "--port", "8080"]