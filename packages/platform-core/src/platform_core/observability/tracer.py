from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List

_TRACES: List[Dict[str, Any]] = []


def start_run(agent: str, thread_id: str | None, prompt: str) -> str:
    run_id = str(uuid.uuid4())
    _TRACES.append(
        {
            "run_id": run_id,
            "agent": agent,
            "thread_id": thread_id,
            "prompt": prompt,
            "steps": [],
            "start_time": time.time(),
        }
    )
    return run_id


def add_step(run_id: str, step_type: str, data: Any) -> None:
    for run in reversed(_TRACES):
        if run["run_id"] == run_id:
            run["steps"].append(
                {
                    "type": step_type,
                    "data": data,
                    "timestamp": time.time(),
                }
            )
            return


def finish_run(run_id: str) -> None:
    for run in reversed(_TRACES):
        if run["run_id"] == run_id:
            run["total_latency_ms"] = int((time.time() - run["start_time"]) * 1000)
            return


def list_traces() -> List[Dict[str, Any]]:
    return list(reversed(_TRACES[-20:]))