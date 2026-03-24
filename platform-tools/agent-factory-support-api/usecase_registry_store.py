from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List


DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

REGISTRY_FILE = DATA_DIR / "usecase_registry.json"


def _read_registry() -> List[Dict[str, Any]]:
    if not REGISTRY_FILE.exists():
        return []
    with REGISTRY_FILE.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        return []
    return data


def _write_registry(records: List[Dict[str, Any]]) -> None:
    with REGISTRY_FILE.open("w", encoding="utf-8") as f:
        json.dump(records, f, indent=2)


def save_registry_record(record: Dict[str, Any]) -> Dict[str, Any]:
    records = _read_registry()

    capability_name = record["capability_name"]
    usecase_name = record["usecase_name"]
    agent_type = record["agent_type"]

    replaced = False
    for i, existing in enumerate(records):
        if (
            existing.get("capability_name") == capability_name
            and existing.get("usecase_name") == usecase_name
            and existing.get("agent_type") == agent_type
        ):
            records[i] = record
            replaced = True
            break

    if not replaced:
        records.append(record)

    _write_registry(records)
    return record


def list_registry_records() -> List[Dict[str, Any]]:
    return _read_registry()


def list_capabilities() -> List[str]:
    records = _read_registry()
    return sorted({r["capability_name"] for r in records if r.get("capability_name")})


def list_usecases(capability_name: str) -> List[str]:
    records = _read_registry()
    return sorted(
        {
            r["usecase_name"]
            for r in records
            if r.get("capability_name") == capability_name and r.get("usecase_name")
        }
    )


def list_agents(capability_name: str, usecase_name: str) -> List[Dict[str, Any]]:
    records = _read_registry()
    filtered = [
        {
            "agent_type": r.get("agent_type"),
            "agent_repo_name": r.get("agent_repo_name"),
            "app_repo_name": r.get("app_repo_name"),
            "agent_name": r.get("agent_name"),
            "app_name": r.get("app_name"),
        }
        for r in records
        if r.get("capability_name") == capability_name
        and r.get("usecase_name") == usecase_name
    ]
    filtered.sort(key=lambda x: (x.get("agent_type") or "", x.get("agent_repo_name") or ""))
    return filtered


def get_app_by_capability(capability_name: str) -> dict | None:
    records = _read_registry()

    for r in records:
        if r.get("capability_name") == capability_name:
            return {
                "app_name": r.get("app_name"),
                "app_repo_name": r.get("app_repo_name"),
            }

    return None