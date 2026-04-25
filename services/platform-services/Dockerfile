FROM python:3.11-slim

WORKDIR /app
ENV PYTHONPATH=/app

RUN pip install --no-cache-dir poetry

# Install platform-core shared library
COPY packages/platform-core/ /platform-core/
RUN pip install --no-cache-dir -e /platform-core

# Install platform-services deps
COPY services/platform-services/pyproject.toml \
     services/platform-services/poetry.lock* /app/
RUN poetry config virtualenvs.create false \
 && poetry install --no-interaction --no-ansi --no-root

# Copy platform-services source
COPY services/platform-services/src/ /app/src/

# Agent config (agent.yaml, memory.yaml, etc.) and domain.yaml
# must be mounted/copied per agent at deploy time:
# COPY agents/<cap>/<usecase>/services/agent-runtime/config/ /app/config/
# COPY capabilities/<cap>/domain.yaml /app/domain.yaml

EXPOSE 8080

CMD ["poetry", "run", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080"]
