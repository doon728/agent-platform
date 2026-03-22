from usecase_registry_store import list_registry_records
from usecase_contract_store import list_usecase_contracts


def get_usecase_metadata(capability_name: str, usecase_name: str):
    contracts = list_usecase_contracts() or {}
    matching_contracts = [
        c
        for c in contracts.values()
        if c.get("capability_name") == capability_name
        and c.get("usecase_name") == usecase_name
    ]

    if matching_contracts:
        supported_agent_types = sorted(
            {c.get("agent_type") for c in matching_contracts if c.get("agent_type")}
        )
        default_agent_type = supported_agent_types[0] if supported_agent_types else None
        default_contract = next(
            (c for c in matching_contracts if c.get("agent_type") == default_agent_type),
            matching_contracts[0],
        )

        return {
            "capability_name": capability_name,
            "usecase_name": usecase_name,
            "default_agent_type": default_agent_type,
            "supported_agent_types": supported_agent_types,
            "components": default_contract.get("components", {}),
            "prompt_types": default_contract.get("prompt_types", []),
            "features": default_contract.get("features", {}),
            "default_model": default_contract.get("default_model"),
        }

    records = list_registry_records() or []
    matching_records = [
        r
        for r in records
        if r.get("capability_name") == capability_name
        and r.get("usecase_name") == usecase_name
    ]

    if not matching_records:
        return None

    supported_agent_types = sorted(
        {r.get("agent_type") for r in matching_records if r.get("agent_type")}
    )
    default_agent_type = supported_agent_types[0] if supported_agent_types else None
    default_record = next(
        (r for r in matching_records if r.get("agent_type") == default_agent_type),
        matching_records[0],
    )

    return {
        "capability_name": capability_name,
        "usecase_name": usecase_name,
        "default_agent_type": default_agent_type,
        "supported_agent_types": supported_agent_types,
        "components": default_record.get("components", {}),
        "prompt_types": default_record.get("prompt_types", []),
        "features": default_record.get("features", {}),
        "default_model": default_record.get("default_model"),
    }