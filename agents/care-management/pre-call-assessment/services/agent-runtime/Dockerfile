FROM python:3.11-slim

WORKDIR /app
ENV PYTHONPATH=/app

RUN pip install --no-cache-dir poetry

# platform-core needed for: HITL approval_store, HITL adapters, auth, context utils
# Business logic (memory, RAG, tools, strategies) now lives in Container 2 (platform-services)
COPY packages/platform-core/ /platform-core/
RUN pip install --no-cache-dir -e /platform-core

# install agent-runtime-shell deps (adds httpx for HTTP clients)
COPY agents/care-management/pre-call-assessment/services/agent-runtime/pyproject.toml \
     agents/care-management/pre-call-assessment/services/agent-runtime/poetry.lock* /app/
RUN poetry config virtualenvs.create false \
 && poetry install --no-interaction --no-ansi --no-root

# copy shell source (thin app + 5 HTTP clients)
COPY agents/care-management/pre-call-assessment/services/agent-runtime/config/ /app/config
COPY agents/care-management/pre-call-assessment/services/agent-runtime/src/ /app/src

# overlays — thin graph topology only (strategy logic lives in Container 2)
COPY agents/care-management/pre-call-assessment/overlays/ /app/overlays

# domain scope — copied from capabilities/<cap>/domain.yaml at scaffold time
COPY agents/care-management/pre-call-assessment/domain.yaml /app/domain.yaml

EXPOSE 8080

CMD ["poetry", "run", "uvicorn", "src.platform.app:app", "--host", "0.0.0.0", "--port", "8080"]
