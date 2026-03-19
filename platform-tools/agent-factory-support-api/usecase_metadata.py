from usecase_registry import USECASE_REGISTRY


def get_usecase_metadata(capability_name: str, usecase_name: str):

    capability = USECASE_REGISTRY.get(capability_name)
    if not capability:
        return None

    usecase = capability.get(usecase_name)
    if not usecase:
        return None

    agents = usecase.get("agents", {})

    supported_agent_types = list(agents.keys())

    # Default agent type = first one
    default_agent_type = supported_agent_types[0] if supported_agent_types else None

    default_agent_config = agents.get(default_agent_type)

    return {
        "capability_name": capability_name,
        "usecase_name": usecase_name,
        "default_agent_type": default_agent_type,
        "supported_agent_types": supported_agent_types,
        "components": default_agent_config.get("components"),
        "prompt_types": default_agent_config.get("prompt_types"),
        "features": default_agent_config.get("features"),
        "default_model": default_agent_config.get("default_model")
    }