FROM python:3.11-slim

WORKDIR /app
ENV PYTHONPATH=/app

RUN pip install --no-cache-dir poetry

# install platform-core shared library
COPY platform-core/ /platform-core/
RUN pip install --no-cache-dir -e /platform-core

# install agent-runtime deps
COPY agents/care-management/pre-call-assessment/services/agent-runtime/pyproject.toml \
     agents/care-management/pre-call-assessment/services/agent-runtime/poetry.lock* /app/
RUN poetry config virtualenvs.create false \
 && poetry install --no-interaction --no-ansi --no-root

# copy runtime
COPY agents/care-management/pre-call-assessment/services/agent-runtime/config/ /app/config
COPY agents/care-management/pre-call-assessment/services/agent-runtime/src/ /app/src
COPY agents/care-management/pre-call-assessment/overlays/ /app/overlays

# domain scope — copied from capabilities/<cap>/domain.yaml at scaffold time
COPY agents/care-management/pre-call-assessment/domain.yaml /app/domain.yaml


EXPOSE 8080

CMD ["poetry", "run", "uvicorn", "src.platform.app:app", "--host", "0.0.0.0", "--port", "8080"]
