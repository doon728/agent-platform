"""Shared pytest fixtures + env setup for platform-services tests.

Sets a fake OPENAI_API_KEY before any module imports happen — the responder
module instantiates the OpenAI client at import time and would otherwise fail.
We never make real API calls in unit tests; LLM calls are mocked or skipped.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Set fake key before any test module imports the responder/executor
os.environ.setdefault("OPENAI_API_KEY", "test-fake-key-not-used")
os.environ.setdefault("ACTIVE_USECASE", "test")

# Make src/ importable as `src.services.*`
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
