FROM python:3.11-slim

WORKDIR /app
ENV PYTHONPATH=/app

RUN pip install --no-cache-dir poetry

# Install platform-core shared library
COPY platform-core/ /platform-core/
RUN pip install --no-cache-dir -e /platform-core

# Install platform-services deps
COPY templates/platform-services/pyproject.toml \
     templates/platform-services/poetry.lock* /app/
RUN poetry config virtualenvs.create false \
 && poetry install --no-interaction --no-ansi --no-root

# Copy platform-services source
COPY templates/platform-services/src/ /app/src/

# domain.yaml — loaded at runtime from agent config path or mounted volume
# COPY capabilities/<cap>/domain.yaml /app/domain.yaml

EXPOSE 8080

CMD ["poetry", "run", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080"]
