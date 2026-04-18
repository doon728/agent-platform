from __future__ import annotations

from dotenv import load_dotenv
from fastapi import FastAPI

from src.services.config.router import router as config_router
from src.services.memory.router import router as memory_router
from src.services.observability.router import router as observability_router
from src.services.rag.router import router as rag_router
from src.services.reasoning.router import router as reasoning_router
from src.services.summarize.router import router as summarize_router
from src.services.tools.router import router as tools_router

load_dotenv()

app = FastAPI(title="Platform Services", version="v1")

app.include_router(config_router, prefix="/config", tags=["config"])
app.include_router(memory_router, prefix="/memory", tags=["memory"])
app.include_router(rag_router, prefix="/rag", tags=["rag"])
app.include_router(reasoning_router, prefix="/reasoning", tags=["reasoning"])
app.include_router(tools_router, prefix="/tools", tags=["tools"])
app.include_router(observability_router, prefix="/observability", tags=["observability"])
app.include_router(summarize_router, prefix="/summarize", tags=["summarize"])


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "platform-services", "version": "v1"}
