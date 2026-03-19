import json
from pathlib import Path

STORE = Path.home() / "agent-platform" / "platform-store"
STORE.mkdir(parents=True, exist_ok=True)

FILE = STORE / "usecase_contracts.json"


def _load():
    if not FILE.exists():
        return {}
    return json.loads(FILE.read_text())


def _save(data):
    FILE.write_text(json.dumps(data, indent=2))


def create_usecase_contract(contract: dict):
    data = _load()

    key = f"{contract['capability_name']}::{contract['usecase_name']}::{contract['agent_type']}"

    data[key] = contract
    _save(data)

    return contract


def get_usecase_contract(capability, usecase, agent_type):
    data = _load()
    key = f"{capability}::{usecase}::{agent_type}"
    return data.get(key)


def list_usecase_contracts():
    return _load()