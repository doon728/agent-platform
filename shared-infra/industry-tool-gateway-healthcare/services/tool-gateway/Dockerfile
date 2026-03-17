FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir poetry

COPY pyproject.toml poetry.lock /app/

RUN poetry config virtualenvs.create false \
 && poetry install --no-interaction --no-ansi --no-root

COPY src/ /app/src
COPY config/ /app/config
COPY data/ /app/data
COPY bootstrap_kb.py /app/bootstrap_kb.py
COPY bootstrap_structured.py /app/bootstrap_structured.py

# FastAPI default
EXPOSE 8080

CMD ["poetry", "run", "uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8080"]