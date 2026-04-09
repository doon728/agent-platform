from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List

from platform_core.tools.validation import validate_tool_input


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: Dict[str, Any]
    handler: Callable[[Dict[str, Any], Dict[str, Any]], Dict[str, Any]]
    mode: str = "read"          # "read" or "write"
    primary_arg: str = "query"  # default for single-arg tools
    tags: List[str] = field(default_factory=list)


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: Dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def get(self, name: str) -> ToolSpec:
        if name not in self._tools:
            raise RuntimeError(f"Unknown tool: {name}")
        return self._tools[name]

    def list_tools(self) -> list[str]:
        return sorted(self._tools.keys())

    def list_specs(self) -> list[ToolSpec]:
        return [self._tools[name] for name in sorted(self._tools.keys())]

    def get_spec(self, name: str) -> ToolSpec:
        return self.get(name)

    def invoke(self, name: str, tool_input: Dict[str, Any], ctx: Dict[str, Any]) -> Dict[str, Any]:
        spec = self.get(name)
        validate_tool_input(spec, tool_input)

        # Mode gate for write tools
        if spec.mode == "write":
            return {
                "approval_required": True,
                "tool_name": spec.name,
                "tool_input": tool_input,
                "ctx": ctx,
                "message": f"Approval required before executing write tool: {spec.name}",
            }

        return spec.handler(tool_input, ctx)

    def invoke_approved(self, name: str, tool_input: Dict[str, Any], ctx: Dict[str, Any]) -> Dict[str, Any]:
        spec = self.get(name)
        validate_tool_input(spec, tool_input)
        return spec.handler(tool_input, ctx)


registry = ToolRegistry()