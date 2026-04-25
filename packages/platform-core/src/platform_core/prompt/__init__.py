"""Prompt + skill loading utilities for the platform.

`SkillLoader` is dependency-light (only requires PyYAML) and imports eagerly.
`PromptServiceClient` requires `requests` and is loaded lazily — accessing
``platform_core.prompt.PromptServiceClient`` triggers the import on first use.
This keeps skill loading usable in environments that don't ship `requests`.
"""

from platform_core.prompt.skill_loader import Skill, SkillLoader

__all__ = ["PromptServiceClient", "Skill", "SkillLoader"]


def __getattr__(name: str):  # PEP 562 — module-level lazy attributes
    if name == "PromptServiceClient":
        from platform_core.prompt.prompt_client import PromptServiceClient
        return PromptServiceClient
    raise AttributeError(f"module 'platform_core.prompt' has no attribute {name!r}")
