"""Cedar policy compiler — STUB.

Reads a YAML policy declaration (per-agent allow/deny rules, PHI masking, etc.)
and emits a Cedar policy bundle that can be pushed to AgentCore Tool Gateway
(which acts as the PEP).

This is a stub. Real Cedar emission + AgentCore push is gated on backlog A1.
For now, the compiler:
  1. Validates the input YAML against a minimal schema.
  2. Emits a placeholder Cedar text bundle to a local file or returns it as a string.
  3. Logs what would be pushed to AgentCore.

Real implementation will:
  - Use the Cedar Python bindings (or shell out to the cedar-policy CLI).
  - Push compiled bundles to AgentCore Tool Gateway via the PolicyStore API.
  - Validate policies against AgentCore's schema before push.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class CompiledPolicy:
    """Output of compiling a single policy declaration."""

    name: str
    cedar_text: str
    metadata: dict[str, Any]


class CedarCompileError(ValueError):
    """Raised when a policy declaration is malformed or cannot be compiled."""


def compile_policy(declaration: dict[str, Any]) -> CompiledPolicy:
    """Compile a single YAML-loaded policy declaration to Cedar text.

    Expected declaration shape:
        name: str
        principal: str   (e.g., "Agent::um_pre_call")
        action: str      (e.g., "Action::call_tool")
        resource: str    (e.g., "Tool::jira/get_issue")
        effect: "permit" | "forbid"
        when: list[str]  (optional Cedar conditions, raw strings)

    This stub does NOT validate the Cedar text — it emits what real Cedar
    syntax would look like and leaves validation to the compile step downstream.
    """
    required = {"name", "principal", "action", "resource", "effect"}
    missing = required - declaration.keys()
    if missing:
        raise CedarCompileError(f"missing required fields: {sorted(missing)}")

    effect = declaration["effect"]
    if effect not in ("permit", "forbid"):
        raise CedarCompileError(f"effect must be 'permit' or 'forbid', got {effect!r}")

    name = str(declaration["name"])
    principal = str(declaration["principal"])
    action = str(declaration["action"])
    resource = str(declaration["resource"])
    when_clauses = declaration.get("when") or []

    when_block = ""
    if when_clauses:
        joined = " &&\n        ".join(str(c) for c in when_clauses)
        when_block = f"\nwhen {{\n        {joined}\n}}"

    cedar_text = (
        f"// Compiled from declaration {name!r}\n"
        f"{effect} (\n"
        f"    principal == {principal},\n"
        f"    action == {action},\n"
        f"    resource == {resource}\n"
        f"){when_block};\n"
    )

    return CompiledPolicy(
        name=name,
        cedar_text=cedar_text,
        metadata={
            "source_declaration": declaration,
            "stub": True,
            "ready_for_agentcore": False,
        },
    )


def compile_bundle(declarations: list[dict[str, Any]]) -> list[CompiledPolicy]:
    """Compile a list of policy declarations into a bundle of Cedar policies."""
    return [compile_policy(d) for d in declarations]


def write_bundle(policies: list[CompiledPolicy], output_dir: Path | str) -> Path:
    """Write a compiled bundle to a directory: <name>.cedar files + a manifest.json."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest = []
    for policy in policies:
        cedar_path = output_dir / f"{policy.name}.cedar"
        cedar_path.write_text(policy.cedar_text, encoding="utf-8")
        manifest.append({"name": policy.name, "file": cedar_path.name, "metadata": policy.metadata})

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    logger.info(
        "cedar_compiler.write_bundle: wrote %d policies to %s (STUB — not pushed to AgentCore yet)",
        len(policies),
        output_dir,
    )
    return manifest_path


def push_to_agentcore(_policies: list[CompiledPolicy]) -> None:
    """Push compiled policies to AgentCore Tool Gateway (PEP). STUB.

    Real implementation will use AgentCore's PolicyStore API. Today this
    is a no-op that logs what would have been pushed.
    """
    logger.warning(
        "cedar_compiler.push_to_agentcore: STUB — AgentCore integration not wired (backlog A1). "
        "%d policies would be pushed.",
        len(_policies),
    )
