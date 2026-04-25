FROM python:3.11-slim

WORKDIR /app
ENV PYTHONPATH=/app

RUN pip install --no-cache-dir poetry

# platform-core only needed for HITL adapters, approval_store, auth, context utils
# Business logic (memory, RAG, tools, strategies) lives in Container 2
COPY packages/platform-core/ /platform-core/
RUN pip install --no-cache-dir -e /platform-core

# Install agent-runtime-shell deps
COPY templates/agent-runtime-shell/pyproject.toml \
     templates/agent-runtime-shell/poetry.lock* /app/
RUN poetry config virtualenvs.create false \
 && poetry install --no-interaction --no-ansi --no-root

# Copy shell source
COPY templates/agent-runtime-shell/src/ /app/src/

# Copy overlays — thin graph topology only (strategy logic is in Container 2)
COPY agents/{{CAPABILITY}}/{{USECASE}}/overlays/ /app/overlays/

# domain.yaml — copied from capabilities/<cap>/domain.yaml at scaffold time
COPY agents/{{CAPABILITY}}/{{USECASE}}/domain.yaml /app/domain.yaml

EXPOSE 8080

CMD ["poetry", "run", "uvicorn", "src.platform.app:app", "--host", "0.0.0.0", "--port", "8080"]
