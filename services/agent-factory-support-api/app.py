from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from dotenv import load_dotenv
import os
import subprocess
import socket
import yaml
from pathlib import Path
import shutil 
from typing import Any
from usecase_contract_store import create_usecase_contract
import time
from usecase_metadata import get_usecase_metadata
from pydantic import BaseModel

from usecase_registry_store import (
    save_registry_record,
    list_registry_records,
    list_capabilities,
    list_usecases,
    list_agents,
    get_app_by_capability,
)

load_dotenv(Path(__file__).resolve().parent / ".env")

# Resolve docker binary — uvicorn may run without /usr/local/bin in PATH
_DOCKER_CANDIDATES = [
    "/usr/local/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
    "/opt/homebrew/bin/docker",
    "docker",
]
DOCKER_BIN = next(
    (p for p in _DOCKER_CANDIDATES if Path(p).exists() or p == "docker"),
    "docker"
)

AGENTS_ROOT = Path(
    os.getenv("AGENTS_ROOT", str(Path.home() / "agent-platform" / "agents"))
)

def resolve_repo_path(repo_name: str) -> Path:
    """
    Finds agent repo anywhere under agents/ (capability/agent-name structure)
    """
    direct = AGENTS_ROOT / repo_name
    if direct.exists():
        return direct

    matches = list(AGENTS_ROOT.rglob(repo_name))
    if matches:
        return matches[0]

    return direct


PLATFORM_ROOT = Path(
    os.getenv("AGENT_PLATFORM_ROOT", str(Path.home() / "agent-platform"))
)

SHARED_INFRA_ROOT = PLATFORM_ROOT / "shared-infra" / "industry-tool-gateway-healthcare" / "services" / "tool-gateway"

_DATA_DIR = Path(__file__).resolve().parent / "data"
_WORKSPACE_STATE_FILE = _DATA_DIR / "workspace_state.json"

def _load_workspace_state() -> dict[str, Any]:
    try:
        if _WORKSPACE_STATE_FILE.exists():
            import json as _json
            return _json.loads(_WORKSPACE_STATE_FILE.read_text()) or {}
    except Exception:
        pass
    return {}

def _save_workspace_state(state: dict[str, Any]):
    try:
        import json as _json
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        _WORKSPACE_STATE_FILE.write_text(_json.dumps(state, indent=2))
    except Exception:
        pass

LAST_WORKSPACE_STATE: dict[str, Any] = _load_workspace_state()
app = FastAPI(title="Agent Factory Support API", version="v1")

TEMPLATES_ROOT = PLATFORM_ROOT / "templates"
AGENT_TEMPLATE_ROOT = TEMPLATES_ROOT / "overlay-templates"
APP_TEMPLATE_ROOT = TEMPLATES_ROOT / "capability-ui-template"

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def copy_template_repo(src: Path, dest: Path):
    if dest.exists():
        return {
            "ok": False,
            "error": f"Target repo already exists: {dest}",
            "path": str(dest),
        }

    if not src.exists():
        return {
            "ok": False,
            "error": f"Template repo not found: {src}",
            "path": str(src),
        }

    shutil.copytree(src, dest)

    git_dir = dest / ".git"
    if git_dir.exists():
        shutil.rmtree(git_dir, ignore_errors=True)

    return {
        "ok": True,
        "repo_root": str(dest),
        "template_root": str(src),
    }


def assemble_agent_repo_from_template(
    dest: Path,
    agent_type: str,
):
    if dest.exists():
        return {
            "ok": False,
            "error": f"Target repo already exists: {dest}",
            "path": str(dest),
        }

    common_root = AGENT_TEMPLATE_ROOT / "common"
    overlay_root = AGENT_TEMPLATE_ROOT / "overlays" / agent_type

    if not common_root.exists():
        return {
            "ok": False,
            "error": f"Common agent template not found: {common_root}",
            "path": str(common_root),
        }

    if not overlay_root.exists():
        return {
            "ok": False,
            "error": f"Overlay template not found for agent_type '{agent_type}': {overlay_root}",
            "path": str(overlay_root),
        }

    shutil.copytree(common_root, dest)

    dest_overlay_root = dest / "overlays" / agent_type
    dest_overlay_root.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(overlay_root, dest_overlay_root)

    return {
        "ok": True,
        "repo_root": str(dest),
        "common_root": str(common_root),
        "overlay_root": str(overlay_root),
    }

def ensure_capability_app_repo(
    capability_name: str,
    app_repo_name: str,
    app_name: str,
):
    capability_root = AGENTS_ROOT / capability_name
    capability_root.mkdir(parents=True, exist_ok=True)

    app_repo_root = capability_root / app_repo_name

    if app_repo_root.exists():
        return {
            "ok": True,
            "repo_root": str(app_repo_root),
            "app_created": False,
            "app_reused": True,
        }

    # Use capability-specific UI template if one exists, otherwise fall back to root template
    capability_slug = capability_name.replace("-", "_").lower()
    capability_ui_template = APP_TEMPLATE_ROOT / capability_slug
    ui_template_src = capability_ui_template if capability_ui_template.exists() else APP_TEMPLATE_ROOT

    app_copy = copy_template_repo(ui_template_src, app_repo_root)
    if not app_copy["ok"]:
        return app_copy

    inject_app_config(
        repo_root=app_repo_root,
        app_name=app_name,
    )

    inject_repo_env(
        repo_root=app_repo_root,
        env_values={
            "VITE_API_PROXY_TARGET": "http://host.docker.internal:8081",
        },
    )

    return {
        "ok": True,
        "repo_root": str(app_repo_root),
        "app_created": True,
        "app_reused": False,
    }


def copy_platform_assets_into_agent_repo(repo_root: Path):
    src = PLATFORM_ROOT / "platform"
    dest = repo_root / "platform"

    if not src.exists():
        return {
            "ok": False,
            "error": f"Platform assets not found: {src}",
            "path": str(src),
        }

    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)

    shutil.copytree(src, dest)

    return {
        "ok": True,
        "platform_root": str(dest),
    }

def materialize_usecase_pack(
    repo_root: Path,
    capability_name: str,
    usecase_name: str,
    agent_type: str,
    create_cfg: dict[str, Any],
):
    usecase_dir = (
        repo_root
        / "platform"
        / "capability-packs"
        / capability_name
        / "usecases"
        / usecase_name
    )
    usecase_dir.mkdir(parents=True, exist_ok=True)

    prompts_cfg = create_cfg.get("prompts") or {}
    memory_cfg = create_cfg.get("memory") or {}
    rag_cfg = create_cfg.get("rag") or {}
    approval_cfg = create_cfg.get("approval") or {}
    tool_policy_cfg = create_cfg.get("tool_policy") or {}

    allowed_tools = tool_policy_cfg.get("allowed_tools") or []

    if not allowed_tools:
        allowed_tools = [
            "get_member_summary",
            "get_member",
            "get_assessment_summary",
            "search_kb",
            "write_case_note",
        ]

    usecase_yaml = {
        "usecase": {
            "name": usecase_name,
            "description": create_cfg.get("description") or f"{usecase_name} generated use case",
        },
        "agent": {
            "type": agent_type,
            "planner_mode": "llm",
        },
        "tools": {
            "mode": "selected",
            "allowed": allowed_tools,
        },
        "retrieval": {
            "enabled": bool(rag_cfg.get("enabled", True)),
            "default_tool": rag_cfg.get("default_tool", "search_kb"),
            "strategy": rag_cfg.get("strategy", "semantic"),
            "top_k": int(rag_cfg.get("top_k", 5)),
            "similarity_threshold": float(rag_cfg.get("score_threshold") or rag_cfg.get("similarity_threshold", 0.35)),
            "fallback": {
                "allow_no_results_response": True,
            },
        },
        "risk": {
            "approval_required": bool(approval_cfg.get("enabled", False)),
        },
        "features": {
            "memory": bool(memory_cfg.get("enabled", False)),
            "rag": bool(rag_cfg.get("enabled", True)),
            "hitl": bool(approval_cfg.get("enabled", False)),
            "observability": True,
            "prompt_versioning": True,
        },
    }

    # Build generic prompts from capability + tool names — no hardcoded domain language
    tool_list = ", ".join(allowed_tools) if allowed_tools else "search_kb"
    capability_label = capability_name.replace("-", " ").title()
    persona_label = create_cfg.get("persona", "assistant").replace("_", " ")

    prompt_defaults_yaml = {
        "planner_system_prompt": prompts_cfg.get("planner_system_prompt")
        or (
            f"You are a {capability_label} planning agent acting as a {persona_label}.\n"
            f"Your job is to decide which tool to call based on the user's message and the active context.\n"
            f"Available tools: {tool_list}.\n"
            f"Hard routing rules are defined in agent.yaml under hard_routes — follow those first.\n"
            f"If no hard route matches, use your best judgment based on tool descriptions.\n"
            f"Use the search tool for knowledge base questions. Return exactly one tool call."
        ),
        "responder_system_prompt": prompts_cfg.get("responder_system_prompt")
        or (
            f"You are a {capability_label} {persona_label}.\n"
            f"Answer using only the information from the tool output provided.\n"
            f"Be concise and relevant. Use bullet points where appropriate.\n"
            f"Do not invent facts. If the tool output is insufficient, say so clearly."
        ),
    }

    memory_yaml = {
        "enabled": bool(memory_cfg.get("enabled", True)),
        "scope_taxonomy": memory_cfg.get("scope_taxonomy") or [
            "conversation",
            "user",
            "member",
            "case",
            "assessment",
            "care_plan",
        ],
        "scope_resolution": {
            "priority": (
                (memory_cfg.get("scope_resolution") or {}).get("priority")
                or [
                    "explicit_request",
                    "ui_context",
                    "domain_lookup",
                    "prompt_inference",
                    "conversation_fallback",
                ]
            )
        },
        "write_policies": {
            "short_term": {
                "enabled": (
                    ((memory_cfg.get("write_policies") or {}).get("short_term") or {}).get("enabled", True)
                ),
                "trigger": (
                    ((memory_cfg.get("write_policies") or {}).get("short_term") or {}).get("trigger", "every_turn")
                ),
                "primary_scope": (
                    ((memory_cfg.get("write_policies") or {}).get("short_term") or {}).get("primary_scope", "conversation")
                ),
                "retain_last_n_turns": (
                    ((memory_cfg.get("write_policies") or {}).get("short_term") or {}).get("retain_last_n_turns", 12)
                ),
            },
            "episodic": {
                "enabled": (
                    ((memory_cfg.get("write_policies") or {}).get("episodic") or {}).get("enabled", True)
                ),
                "triggers": (
                    ((memory_cfg.get("write_policies") or {}).get("episodic") or {}).get("triggers")
                    or ["tool_success", "workflow_checkpoint", "assessment_completed"]
                ),
                "allowed_scopes": (
                    ((memory_cfg.get("write_policies") or {}).get("episodic") or {}).get("allowed_scopes")
                    or ["case", "assessment"]
                ),
                "link_to_parent_scope": (
                    ((memory_cfg.get("write_policies") or {}).get("episodic") or {}).get("link_to_parent_scope", True)
                ),
                "link_to_root_scope": (
                    ((memory_cfg.get("write_policies") or {}).get("episodic") or {}).get("link_to_root_scope", True)
                ),
                "link_to_member_scope": (
                    ((memory_cfg.get("write_policies") or {}).get("episodic") or {}).get("link_to_member_scope", True)
                ),
            },
            "semantic": {
                "enabled": (
                    ((memory_cfg.get("write_policies") or {}).get("semantic") or {}).get("enabled", False)
                ),
                "trigger": (
                    ((memory_cfg.get("write_policies") or {}).get("semantic") or {}).get("trigger", "extractor")
                ),
                "extractor_profile": (
                    ((memory_cfg.get("write_policies") or {}).get("semantic") or {}).get(
                        "extractor_profile", "stable_fact_extractor_v1"
                    )
                ),
                "confidence_threshold": (
                    ((memory_cfg.get("write_policies") or {}).get("semantic") or {}).get(
                        "confidence_threshold", 0.85
                    )
                ),
                "allowed_scopes": (
                    ((memory_cfg.get("write_policies") or {}).get("semantic") or {}).get("allowed_scopes")
                    or ["member", "user"]
                ),
            },
            "summary": {
                "enabled": (
                    ((memory_cfg.get("write_policies") or {}).get("summary") or {}).get("enabled", True)
                ),
                "triggers": (
                    ((memory_cfg.get("write_policies") or {}).get("summary") or {}).get("triggers")
                    or {
                        "every_n_turns": 10,
                        "on_session_end": True,
                        "on_workflow_end": True,
                    }
                ),
                "allowed_scopes": (
                    ((memory_cfg.get("write_policies") or {}).get("summary") or {}).get("allowed_scopes")
                    or ["conversation", "case"]
                ),
            },
        },
        "retrieval_policies": (
            memory_cfg.get("retrieval_policies")
            or {
                "conversation": {
                    "short_term": {
                        "include": True,
                        "max_turns": 8,
                    },
                    "summary": {
                        "include": True,
                        "max_items": 1,
                    },
                },
                "case": {
                    "episodic": {
                        "include": True,
                        "top_k": 5,
                        "include_parent_scope": True,
                        "include_root_scope": True,
                    },
                    "summary": {
                        "include": True,
                        "max_items": 1,
                    },
                },
                "member": {
                    "semantic": {
                        "include": True,
                        "top_k": 3,
                    },
                },
            }
        ),
        "context_assembly": (
            memory_cfg.get("context_assembly")
            or {
                "max_total_items": 12,
                "prefer_summaries_over_raw": True,
                "deduplicate": True,
            }
        ),
    }

    workflow_rules_yaml = {
        "rules": create_cfg.get("workflow_rules") or []
    }

    (usecase_dir / "usecase.yaml").write_text(yaml.safe_dump(usecase_yaml, sort_keys=False))
    (usecase_dir / "prompt-defaults.yaml").write_text(yaml.safe_dump(prompt_defaults_yaml, sort_keys=False))
    (usecase_dir / "memory.yaml").write_text(yaml.safe_dump(memory_yaml, sort_keys=False))
    (usecase_dir / "workflow-rules.yaml").write_text(yaml.safe_dump(workflow_rules_yaml, sort_keys=False))


def derive_generation_metadata(
    agent_type: str,
    create_cfg: dict[str, Any],
):
    prompts_cfg = create_cfg.get("prompts") or {}
    memory_cfg = create_cfg.get("memory") or {}
    rag_cfg = create_cfg.get("rag") or {}
    approval_cfg = create_cfg.get("approval") or {}

    planner_prompt = prompts_cfg.get("planner_system_prompt") or (
        "You are a care management planner.\n"
        "Use get_member_summary for member ids like m-100001.\n"
        "Use get_assessment_summary only for assessment ids like asmt-100001.\n"
        "If no direct member or assessment lookup fits, use search_kb."
    )

    responder_prompt = prompts_cfg.get("responder_system_prompt") or (
        "You are a care management nurse assistant.\n"
        "Answer clearly and briefly using tool output only."
    )

    components = {
        "planner": bool(planner_prompt),
        "responder": bool(responder_prompt),
        "workflow": agent_type == "workflow_agent",
        "router": agent_type in ("supervisor_agent", "multi_agent"),
    }

    prompt_types = []
    if components["planner"]:
        prompt_types.append("planner")
    if components["responder"]:
        prompt_types.append("responder")

    features = {
        "memory": bool(memory_cfg.get("enabled", False)),
        "rag": bool(rag_cfg.get("enabled", True)),
        "hitl": bool(approval_cfg.get("enabled", False)),
        "observability": True,
        "prompt_versioning": True,
    }

    default_model = (
        (create_cfg.get("model") or {}).get("model")
        or "gpt-4o-mini"
    )

    return {
        "components": components,
        "prompt_types": prompt_types,
        "features": features,
        "default_model": default_model,
    }


def inject_agent_usecase_and_prompt_config(
    repo_root: Path,
    app_name: str,
    agent_type: str,
    capability_name: str,
    usecase: str,
):
    cfg_file = repo_root / "services" / "agent-runtime" / "config" / "base.yaml"

    if not cfg_file.exists():
        return

    data = yaml.safe_load(cfg_file.read_text()) or {}

    # -------- APP SECTION ----------
    data["app"] = data.get("app", {})
    data["app"]["active_usecase"] = usecase
    data["app"]["capability_name"] = capability_name
    data["app"]["contract_version"] = "v1"

    # -------- PROMPT SERVICE ----------
    data["prompt_service"] = {
        "url": "http://host.docker.internal:8101",
        "app_name": app_name,
        "agent_type": agent_type,
        "usecase_name": usecase,
        "environment": "dev",
    }

    # -------- TOOL GATEWAY ----------
    data["tool_gateway"] = {
        "url": "http://healthcare-tool-gateway:8080"
    }

    # -------- IMPORTANT ----------
    # REMOVE ANY TOOL POLICY OR FEATURE OVERRIDES
    data.pop("tools", None)
    data.pop("features", None)
    data.pop("planner_mode", None)

    cfg_file.write_text(
        yaml.safe_dump(data, sort_keys=False)
    )


def inject_app_config(
    repo_root: Path,
    app_name: str,
):
    cfg_file = repo_root / "app-config" / "agents.yaml"
    if cfg_file.exists():
        data = yaml.safe_load(cfg_file.read_text()) or {}
        data["app_name"] = app_name
        cfg_file.write_text(yaml.safe_dump(data, sort_keys=False))




def inject_repo_env(repo_root: Path, env_values: dict[str, str]):
    env_file = repo_root / ".env"

    existing: dict[str, str] = {}
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                existing[k.strip()] = v.strip()

    merged = {**existing, **env_values}

    lines = [f"{k}={v}" for k, v in merged.items()]
    env_file.write_text("\n".join(lines) + "\n")





def run_cmd(cmd: list[str], cwd: str | None = None, env: dict | None = None):
    return subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )

def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def find_free_port(start_port: int) -> int:
    port = start_port
    while is_port_in_use(port):
        port += 1
    return port

def docker_compose_down(repo_root: Path):
    if not repo_root.exists():
        return {
            "ok": False,
            "repo_root": str(repo_root),
            "returncode": 1,
            "stdout": "",
            "stderr": f"Repo path does not exist: {repo_root}",
        }

    result = run_cmd([DOCKER_BIN, "compose", "down", "--remove-orphans"], cwd=str(repo_root))
    return {
        "ok": result.returncode == 0,
        "repo_root": str(repo_root),
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }




@app.get("/health")
def health():
    return {"ok": True, "service": "agent-factory-support-api"}


@app.get("/infra/status")
def infra_status():
    try:
        result = run_cmd(
            [DOCKER_BIN, "compose", "ps", "--format", "json"],
            cwd=str(SHARED_INFRA_ROOT),
        )

        lines = [line for line in result.stdout.splitlines() if line.strip()]
        services = []
        for line in lines:
            services.append(line)

        return {
            "ok": True,
            "shared_infra_root": str(SHARED_INFRA_ROOT),
            "services_found": len(services),
            "services": services,
        }
    except Exception as e:
        return {
            "ok": False,
            "shared_infra_root": str(SHARED_INFRA_ROOT),
            "error": str(e),
        }


@app.post("/create-application")
def create_application(payload: dict[str, Any]):
    try:
        app_cfg = payload.get("app") or {}
        agents = payload.get("agents") or []

        if not app_cfg:
            return {"ok": False, "error": "Missing app config"}
        if not agents:
            return {"ok": False, "error": "Missing agents config"}

        first_agent = agents[0]
        create_cfg = first_agent.get("create_config") or {}

        app_repo_name = app_cfg.get("repo_name")
        app_name = app_cfg.get("app_name") or app_repo_name

        agent_repo_name = create_cfg.get("repo_name")
        agent_name = first_agent.get("agent_name") or agent_repo_name
        agent_type = first_agent.get("agent_type", "chat_agent_simple")

        capability_name = create_cfg.get("capability_name", "care-management")
        usecase_name = create_cfg.get("usecase_name", "cm_assistant")

        if not agent_repo_name:
            return {"ok": False, "error": "Missing agent repo name"}

        # app_repo_name is no longer required — UI is in capabilities/, not generated
        if not app_repo_name:
            app_repo_name = agent_repo_name

        # ======================================================
        # STRUCTURE: agents/<capability>/<agent-name>/
        # ======================================================

        capability_root = AGENTS_ROOT / capability_name
        capability_root.mkdir(parents=True, exist_ok=True)

        # ---------- create agent repo ----------
        agent_repo_root = capability_root / agent_repo_name

        agent_copy = assemble_agent_repo_from_template(agent_repo_root, agent_type)
        if not agent_copy["ok"]:
            return agent_copy

        # ---------- copy domain.yaml from capability ----------
        domain_src = PLATFORM_ROOT / "capabilities" / capability_name / "domain.yaml"
        if domain_src.exists():
            shutil.copy2(domain_src, agent_repo_root / "domain.yaml")
            print(f"[scaffold] copied domain.yaml from {domain_src}", flush=True)
        else:
            print(f"[scaffold] no domain.yaml found at {domain_src} — agent will run without domain scope", flush=True)

        materialize_usecase_pack(
            repo_root=agent_repo_root,
            capability_name=capability_name,
            usecase_name=usecase_name,
            agent_type=agent_type,
            create_cfg=create_cfg,
        )
        # ---------- agent env ----------
        inject_repo_env(
            repo_root=agent_repo_root,
            env_values={
                "OPENAI_API_KEY": os.getenv("OPENAI_API_KEY", ""),
                "OPENAI_MODEL": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                "TOOL_GATEWAY_URL": os.getenv(
                    "TOOL_GATEWAY_URL",
                    "http://host.docker.internal:8080"
                ),
            },
        )

        # ---------- inject runtime config ----------
        inject_agent_usecase_and_prompt_config(
            repo_root=agent_repo_root,
            app_name=app_name,
            agent_type=agent_type,
            capability_name=capability_name,
            usecase=usecase_name,
        )

        # ======================================================
        # AUTO REGISTRY SAVE
        # ======================================================

        generation_meta = derive_generation_metadata(
            agent_type=agent_type,
            create_cfg=create_cfg,
        )

        components = generation_meta["components"]
        prompt_types = generation_meta["prompt_types"]
        features = generation_meta["features"]
        default_model = generation_meta["default_model"]

        save_registry_record({
            "capability_name": capability_name,
            "usecase_name": usecase_name,
            "agent_type": agent_type,
            "app_name": app_name,
            "app_repo_name": app_repo_name,
            "agent_name": agent_name,
            "agent_repo_name": agent_repo_name,
            "components": components,
            "prompt_types": prompt_types,
            "features": features,
            "default_model": default_model,
        })

        # ======================================================
        # AUTO CONTRACT GENERATION (DYNAMIC)
        # ======================================================

        contract = {
            "capability_name": capability_name,
            "usecase_name": usecase_name,
            "agent_type": agent_type,
            "app_name": app_name,
            "app_repo_name": app_repo_name,
            "agent_repo_name": agent_repo_name,
            "components": components,
            "prompt_types": prompt_types,
            "features": features,
            "default_model": default_model,
        }

        create_usecase_contract(contract)

        return {
            "ok": True,
            "status": "application_generated",
            "capability_name": capability_name,
            "agent_name": agent_name,
            "agent_repo_name": agent_repo_name,
            "agent_repo_url": str(agent_repo_root),
            "agents": [
                {
                    "agent_name": agent_name,
                    "agent_type": agent_type,
                    "repo_name": agent_repo_name,
                    "repo_url": str(agent_repo_root),
                    "status": "generated_local_agent_repo",
                }
            ],
        }

    except Exception as e:
        return {"ok": False, "error": str(e)}




@app.post("/infra/start")
def infra_start():
    try:
        env = os.environ.copy()
        env.pop("VIRTUAL_ENV", None)
        env.pop("PYTHONHOME", None)
        env.pop("PYTHONPATH", None)

        path_parts = [
            str(Path.home() / ".local" / "bin"),
            "/opt/homebrew/bin",
            "/opt/homebrew/opt/python@3.11/Frameworks/Python.framework/Versions/3.11/bin",
            env.get("PATH", ""),
        ]
        env["PATH"] = ":".join([p for p in path_parts if p])

        docker_up = run_cmd(
            [DOCKER_BIN, "compose", "up", "-d", "--build", "--force-recreate"],
            cwd=str(SHARED_INFRA_ROOT),
            env=env,
        )

        poetry_install = run_cmd(
            ["poetry", "install"],
            cwd=str(SHARED_INFRA_ROOT),
            env=env,
        )

        structured_bootstrap = run_cmd(
            ["poetry", "run", "python", "bootstrap_structured.py"],
            cwd=str(SHARED_INFRA_ROOT),
            env=env,
        )

        kb_bootstrap = run_cmd(
            [
                "docker", "exec", "-i", "tool-gateway-tool-gateway-1",
                "sh", "-lc",
                "cd /app && "
                "KB_PG_HOST=postgres "
                "KB_PG_PORT=5432 "
                "KB_PG_DB=agentdb "
                "KB_PG_USER=postgres "
                "KB_PG_PASSWORD=postgres "
                "poetry run python bootstrap_kb.py"
            ],
            cwd=str(SHARED_INFRA_ROOT),
            env=env,
        )

        kb_verify = run_cmd(
            [
                "docker", "exec", "tool-gateway-postgres-1",
                "psql", "-U", "postgres", "-d", "agentdb",
                "-t", "-c", "select count(*) from kb_documents;"
            ],
            cwd=str(SHARED_INFRA_ROOT),
            env=env,
        )

        kb_count = (kb_verify.stdout or "").strip()

        ok = (
            docker_up.returncode == 0 and
            poetry_install.returncode == 0 and
            structured_bootstrap.returncode == 0 and
            kb_bootstrap.returncode == 0 and
            kb_verify.returncode == 0 and
            kb_count not in ("", "0")
        )

        return {
            "ok": ok,
            "shared_infra_root": str(SHARED_INFRA_ROOT),
            "steps": {
                "docker_up": {
                    "returncode": docker_up.returncode,
                    "stdout": docker_up.stdout,
                    "stderr": docker_up.stderr,
                },
                "poetry_install": {
                    "returncode": poetry_install.returncode,
                    "stdout": poetry_install.stdout,
                    "stderr": poetry_install.stderr,
                },
                "structured_bootstrap": {
                    "returncode": structured_bootstrap.returncode,
                    "stdout": structured_bootstrap.stdout,
                    "stderr": structured_bootstrap.stderr,
                },
                "kb_bootstrap": {
                    "returncode": kb_bootstrap.returncode,
                    "stdout": kb_bootstrap.stdout,
                    "stderr": kb_bootstrap.stderr,
                },
                "kb_verify": {
                    "returncode": kb_verify.returncode,
                    "stdout": kb_verify.stdout,
                    "stderr": kb_verify.stderr,
                },
            },
            "kb_rows": kb_count,
        }
    except Exception as e:
        return {
            "ok": False,
            "shared_infra_root": str(SHARED_INFRA_ROOT),
            "error": str(e),
        }

@app.post("/runtime/stop")
def runtime_stop(repo_name: str):
    try:
        repo_root = resolve_repo_path(repo_name)

        down = docker_compose_down(repo_root)

        return {
            "ok": down["ok"],
            "repo": repo_name,
            "repo_root": str(repo_root),
            "returncode": down["returncode"],
            "stdout": down["stdout"],
            "stderr": down["stderr"],
        }
    except Exception as e:
        return {
            "ok": False,
            "repo": repo_name,
            "error": str(e),
        }


@app.post("/app/stop")
def app_stop(repo_name: str):
    try:
        repo_root = resolve_repo_path(repo_name)

        down = docker_compose_down(repo_root)

        return {
            "ok": down["ok"],
            "repo": repo_name,
            "repo_root": str(repo_root),
            "returncode": down["returncode"],
            "stdout": down["stdout"],
            "stderr": down["stderr"],
        }
    except Exception as e:
        return {
            "ok": False,
            "repo": repo_name,
            "error": str(e),
        }


@app.post("/runtime/start")
def runtime_start(repo_name: str, port: int = 8081):
    try:
        repo_root = resolve_repo_path(repo_name)

        if not repo_root.exists():
            return {
                "ok": False,
                "error": f"Repo not found: {repo_name}",
                "path": str(repo_root),
            }

        env = os.environ.copy()
        env.pop("VIRTUAL_ENV", None)
        env.pop("PYTHONHOME", None)
        env.pop("PYTHONPATH", None)

        path_parts = [
            "/Applications/Docker.app/Contents/Resources/bin",
            str(Path.home() / ".local" / "bin"),
            "/opt/homebrew/bin",
            "/opt/homebrew/opt/python@3.11/Frameworks/Python.framework/Versions/3.11/bin",
            env.get("PATH", ""),
        ]
        env["PATH"] = ":".join([p for p in path_parts if p])

        env["AGENT_RUNTIME_PORT"] = str(port)

        if "OPENAI_API_KEY" not in env:
            env["OPENAI_API_KEY"] = os.getenv("OPENAI_API_KEY", "")

        result = run_cmd(
            [
                "docker",
                "compose",
                "up",
                "-d",
                "--build",
                "--force-recreate",
                "--remove-orphans",
            ],
            cwd=str(repo_root),
            env=env,
)

        return {
            "ok": result.returncode == 0,
            "repo": repo_name,
            "repo_root": str(repo_root),
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }

    except Exception as e:
        return {
            "ok": False,
            "repo": repo_name,
            "error": str(e),
        }


@app.post("/app/start")
def app_start(repo_name: str, port: int = 3000, runtime_url: str = "http://localhost:8081"):
    try:
        repo_root = resolve_repo_path(repo_name)

        if not repo_root.exists():
            return {
                "ok": False,
                "error": f"Repo not found: {repo_name}",
                "path": str(repo_root),
            }

        runtime_port = runtime_url.rsplit(":", 1)[-1]

        env = os.environ.copy()
        env.pop("VIRTUAL_ENV", None)
        env.pop("PYTHONHOME", None)
        env.pop("PYTHONPATH", None)

        path_parts = [
            "/Applications/Docker.app/Contents/Resources/bin",
            str(Path.home() / ".local" / "bin"),
            "/opt/homebrew/bin",
            "/opt/homebrew/opt/python@3.11/Frameworks/Python.framework/Versions/3.11/bin",
            env.get("PATH", ""),
        ]
        env["PATH"] = ":".join([p for p in path_parts if p])

        env["APP_UI_PORT"] = str(port)
        env["VITE_API_PROXY_TARGET"] = f"http://host.docker.internal:{runtime_port}"

        result = run_cmd(
            [
                "docker",
                "compose",
                "up",
                "-d",
                "--build",
                "--force-recreate",
                "--remove-orphans",
            ],
            cwd=str(repo_root),
            env=env,
        )

        return {
            "ok": result.returncode == 0,
            "repo": repo_name,
            "repo_root": str(repo_root),
            "port": port,
            "runtime_url": runtime_url,
            "vite_api_proxy_target": env["VITE_API_PROXY_TARGET"],
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }

    except Exception as e:
        return {
            "ok": False,
            "repo": repo_name,
            "error": str(e),
        }


@app.post("/workspace/start")
def workspace_start(
    agent_repo: str,
    app_repo: str = "",
    runtime_port: int = 8081,
    app_port: int = 3000,
):
    resolved_runtime_port = find_free_port(runtime_port)
    app_cleanup = app_stop(repo_name=app_repo)
    time.sleep(2)
    
    runtime_cleanup = runtime_stop(repo_name=agent_repo)
    resolved_app_port = find_free_port(app_port)
    
    

    infra = infra_status()
    if not infra.get("ok") or int(infra.get("services_found", 0)) == 0:
        infra = infra_start()

    runtime_cleanup = runtime_stop(repo_name=agent_repo)
    app_cleanup = app_stop(repo_name=app_repo)

    agent_repo_root = resolve_repo_path(agent_repo)



    runtime = runtime_start(repo_name=agent_repo, port=resolved_runtime_port)
    app_result = app_start(
        repo_name=app_repo,
        port=resolved_app_port,
        runtime_url=f"http://localhost:{resolved_runtime_port}",
    )

    global LAST_WORKSPACE_STATE

    LAST_WORKSPACE_STATE = {
        "agent_repo": agent_repo,
        "app_repo": app_repo,
        "status": "running",
        "requested_runtime_port": runtime_port,
        "requested_app_port": app_port,
        "resolved_runtime_port": resolved_runtime_port,
        "resolved_app_port": resolved_app_port,
        "tool_gateway_url": "http://localhost:8080",
        "agent_runtime_url": f"http://localhost:{resolved_runtime_port}",
        "platform_services_url": "http://localhost:8002",
        "app_ui_url": f"http://localhost:{resolved_app_port}",
    }
    _save_workspace_state(LAST_WORKSPACE_STATE)
    return {
        "ok": infra.get("ok") and runtime.get("ok") and app_result.get("ok"),
        "infra": infra,
        "cleanup": {
            "runtime": runtime_cleanup,
            "app": app_cleanup,
        },
        "runtime": runtime,
        "app": app_result,
        "ports": {
            "requested_runtime_port": runtime_port,
            "requested_app_port": app_port,
            "resolved_runtime_port": resolved_runtime_port,
            "resolved_app_port": resolved_app_port,
        },
        "urls": {
            "tool_gateway_url": "http://localhost:8080",
            "agent_runtime_url": f"http://localhost:{resolved_runtime_port}",
            "platform_services_url": "http://localhost:8002",
            "app_ui_url": f"http://localhost:{resolved_app_port}",
        },
    }

def _detect_running_workspace() -> dict[str, Any]:
    """Fallback: detect running agents by probing well-known ports, reconstruct workspace state."""
    import urllib.request as _req
    import re

    records = list_registry_records()
    real_agents = [
        r for r in records
        if r.get("usecase_name") != "__capability__" and r.get("agent_type") != "__app__"
        and r.get("agent_repo_name")
    ]

    probe_ports = [8081, 8082, 8083, 8084, 8085]
    for agent in real_agents:
        for port in probe_ports:
            try:
                req = _req.Request(f"http://localhost:{port}/health", headers={"User-Agent": "factory-detect"})
                with _req.urlopen(req, timeout=1) as resp:
                    if resp.getcode() == 200:
                        app_repo = agent.get("app_repo_name")
                        # Probe common app UI ports
                        detected_app_port = None
                        for app_port in [3000, 3001, 3002, 4173]:
                            try:
                                ar = _req.Request(f"http://localhost:{app_port}/", headers={"User-Agent": "factory-detect"})
                                with _req.urlopen(ar, timeout=1):
                                    detected_app_port = app_port
                                    break
                            except Exception:
                                pass
                        return {
                            "agent_repo": agent["agent_repo_name"],
                            "app_repo": app_repo,
                            "resolved_runtime_port": port,
                            "resolved_app_port": detected_app_port,
                            "tool_gateway_url": "http://localhost:8080",
                            "agent_runtime_url": f"http://localhost:{port}",
                            "app_ui_url": f"http://localhost:{detected_app_port}" if detected_app_port else None,
                            "_source": "port_detect",
                        }
            except Exception:
                continue
    return {}


@app.get("/workspace/status")
def workspace_status():
    global LAST_WORKSPACE_STATE

    state = LAST_WORKSPACE_STATE
    # If state is empty (API restarted with no saved state), try to detect from docker
    if not state.get("agent_repo"):
        state = _detect_running_workspace()
        if state.get("agent_repo"):
            # Populate in-memory state so stop/delete work without re-detection
            LAST_WORKSPACE_STATE = {**state, "status": "running"}
            _save_workspace_state(LAST_WORKSPACE_STATE)
            state = LAST_WORKSPACE_STATE

    return {
        "ok": True,
        "status": state.get("status", "running") if state.get("agent_repo") else "none",
        "repos": {
            "agent_repo": state.get("agent_repo"),
            "app_repo": state.get("app_repo"),
        },
        "ports": {
            "requested_runtime_port": state.get("requested_runtime_port"),
            "requested_app_port": state.get("requested_app_port"),
            "resolved_runtime_port": state.get("resolved_runtime_port"),
            "resolved_app_port": state.get("resolved_app_port"),
        },
        "urls": {
            "tool_gateway_url": state.get("tool_gateway_url"),
            "agent_runtime_url": state.get("agent_runtime_url"),
            "app_ui_url": state.get("app_ui_url"),
        },
        "runtime_model": {
            "gateway": "shared_external_local",
            "postgres": "shared_external_local",
            "agent_runtime": "repo_local",
            "ui": "repo_local",
        },
        "source": state.get("_source", "saved_state"),
    }


@app.post("/workspace/stop")
def workspace_stop(agent_repo: str = ""):
    """Stop a specific agent by repo name. Falls back to LAST_WORKSPACE_STATE if no agent_repo given."""
    global LAST_WORKSPACE_STATE

    # If agent_repo given directly, use it
    if agent_repo:
        records = list_registry_records()
        record = next((r for r in records if r.get("agent_repo_name") == agent_repo), None)
        app_repo = record.get("app_repo_name", "") if record else ""
        runtime_result = runtime_stop(repo_name=agent_repo)
        app_result = app_stop(repo_name=app_repo) if app_repo else {"ok": True}
        if LAST_WORKSPACE_STATE.get("agent_repo") == agent_repo:
            LAST_WORKSPACE_STATE["status"] = "stopped"
            _save_workspace_state(LAST_WORKSPACE_STATE)
        return {"ok": True, "agent_repo": agent_repo, "app_repo": app_repo, "runtime": runtime_result, "app": app_result}

    # Fallback: use LAST_WORKSPACE_STATE
    state = LAST_WORKSPACE_STATE
    repo = state.get("agent_repo")
    app_repo = state.get("app_repo")

    if not repo:
        detected = _detect_running_workspace()
        if not detected.get("agent_repo"):
            return {"ok": False, "error": "No active workspace to stop"}
        repo = detected["agent_repo"]
        app_repo = detected.get("app_repo")
        LAST_WORKSPACE_STATE = {**detected, "status": "running"}

    runtime_result = runtime_stop(repo_name=repo)
    app_result = app_stop(repo_name=app_repo) if app_repo else {"ok": True}

    LAST_WORKSPACE_STATE["status"] = "stopped"
    _save_workspace_state(LAST_WORKSPACE_STATE)

    return {"ok": True, "agent_repo": repo, "app_repo": app_repo, "runtime": runtime_result, "app": app_result}


@app.delete("/workspace/delete")
def workspace_delete():
    global LAST_WORKSPACE_STATE
    state = LAST_WORKSPACE_STATE
    agent_repo = state.get("agent_repo")
    app_repo = state.get("app_repo")

    if not agent_repo:
        return {"ok": False, "error": "No workspace to delete"}

    if state.get("status") != "stopped":
        return {"ok": False, "error": "Workspace must be stopped before deleting"}

    # Stop containers just in case
    runtime_stop(repo_name=agent_repo)
    if app_repo:
        app_stop(repo_name=app_repo)

    deleted = []
    errors = []

    # Delete generated repo dirs
    for repo in [agent_repo, app_repo]:
        if not repo:
            continue
        repo_path = resolve_repo_path(repo)
        try:
            if repo_path.exists():
                shutil.rmtree(repo_path)
                deleted.append(str(repo_path))
        except Exception as e:
            errors.append(f"Failed to delete {repo_path}: {e}")

    # Remove registry records for this agent repo
    try:
        import json as _json
        registry_file = _DATA_DIR / "usecase_registry.json"
        if registry_file.exists():
            records = _json.loads(registry_file.read_text()) or []
            records = [r for r in records if r.get("agent_repo_name") != agent_repo]
            registry_file.write_text(_json.dumps(records, indent=2))
    except Exception as e:
        errors.append(f"Registry cleanup failed: {e}")

    # Clear workspace state
    LAST_WORKSPACE_STATE = {}
    _save_workspace_state(LAST_WORKSPACE_STATE)

    return {
        "ok": len(errors) == 0,
        "deleted": deleted,
        "errors": errors,
    }

@app.delete("/registry/agent")
def registry_agent_delete(agent_repo: str):
    """Delete a specific agent by repo name — stops containers, deletes files, removes from registry."""
    import json as _json

    # Look up the agent in the registry to find its app_repo
    records = list_registry_records()
    agent_record = next(
        (r for r in records if r.get("agent_repo_name") == agent_repo),
        None,
    )
    app_repo = agent_record.get("app_repo_name") if agent_record else None

    # Stop containers (best-effort)
    runtime_stop(repo_name=agent_repo)
    if app_repo:
        app_stop(repo_name=app_repo)

    deleted = []
    errors = []

    # Delete generated repo dirs
    for repo in [r for r in [agent_repo, app_repo] if r]:
        repo_path = resolve_repo_path(repo)
        try:
            if repo_path.exists():
                shutil.rmtree(repo_path)
                deleted.append(str(repo_path))
        except Exception as e:
            errors.append(f"Failed to delete {repo_path}: {e}")

    # Remove all registry records tied to this agent_repo
    try:
        registry_file = _DATA_DIR / "usecase_registry.json"
        if registry_file.exists():
            all_records = _json.loads(registry_file.read_text()) or []
            all_records = [r for r in all_records if r.get("agent_repo_name") != agent_repo]
            registry_file.write_text(_json.dumps(all_records, indent=2))
    except Exception as e:
        errors.append(f"Registry cleanup failed: {e}")

    # Clear workspace state if it pointed to this agent
    global LAST_WORKSPACE_STATE
    if LAST_WORKSPACE_STATE.get("agent_repo") == agent_repo:
        LAST_WORKSPACE_STATE = {}
        _save_workspace_state(LAST_WORKSPACE_STATE)

    return {
        "ok": len(errors) == 0,
        "agent_repo": agent_repo,
        "app_repo": app_repo,
        "deleted": deleted,
        "errors": errors,
    }


@app.get("/repo-exists")
def repo_exists(name: str):
    matches = list(AGENTS_ROOT.rglob(name))

    return {
        "ok": True,
        "name": name,
        "exists": len(matches) > 0,
        "paths": [str(p) for p in matches],
        "backend": "local_filesystem"
    }    


@app.get("/next-available-repo-name")
def next_available_repo_name(base: str):
    base_slug = base.strip()

    candidate = base_slug
    counter = 2

    existing_names = {p.name for p in AGENTS_ROOT.rglob("*") if p.is_dir()}

    while candidate in existing_names:
        candidate = f"{base_slug}-{counter}"
        counter += 1

    return {
        "ok": True,
        "base": base_slug,
        "suggested": candidate
    }

@app.get("/usecases/metadata")
def usecase_metadata(capability_name: str, usecase_name: str):
    record = get_usecase_metadata(capability_name, usecase_name)
    if not record:
        return {
            "ok": False,
            "error": f"No metadata found for capability={capability_name} usecase={usecase_name}",
        }
    return {
        "ok": True,
        "metadata": record,
    }

@app.get("/contracts/usecase")
def get_contract(capability_name: str, usecase_name: str, agent_type: str):
    from usecase_contract_store import get_usecase_contract

    c = get_usecase_contract(capability_name, usecase_name, agent_type)

    if not c:
        return {"ok": False}

    return {"ok": True, "contract": c}

# =========================================================
# USE CASE REGISTRY ENDPOINTS (NEW)
# =========================================================

class UsecaseRegistryRecord(BaseModel):
    capability_name: str
    usecase_name: str
    agent_type: str
    app_name: str
    app_repo_name: str
    agent_name: str
    agent_repo_name: str
    components: dict
    prompt_types: list[str]
    features: dict
    default_model: str

class CreateCapabilityRequest(BaseModel):
    capability_name: str
    app_name: str
    app_repo_name: str
    description: str | None = None


@app.get("/registry/usecases")
def get_registry_records():
    return {
        "ok": True,
        "records": list_registry_records(),
    }


@app.post("/registry/usecases")
def create_or_update_registry_record(payload: UsecaseRegistryRecord):
    saved = save_registry_record(payload.model_dump())
    return {
        "ok": True,
        "record": saved,
    }


@app.get("/registry/capabilities")
def get_registry_capabilities():
    return {
        "ok": True,
        "capabilities": list_capabilities(),
    }


@app.get("/registry/usecases/by-capability")
def get_registry_usecases(capability_name: str):
    return {
        "ok": True,
        "usecases": list_usecases(capability_name),
    }


@app.get("/registry/agents")
def get_registry_agents(capability_name: str, usecase_name: str):
    return {
        "ok": True,
        "agents": list_agents(capability_name, usecase_name),
    }

    @app.get("/registry/app-by-capability")
    def get_registry_app_by_capability(capability_name: str):
        app_record = get_app_by_capability(capability_name)
        return {
            "ok": True,
            "app": app_record,
        }

@app.post("/capability/create")
def create_capability(payload: CreateCapabilityRequest):
    try:
        capability_name = payload.capability_name.strip()
        app_name = payload.app_name.strip()
        app_repo_name = payload.app_repo_name.strip()

        if not capability_name:
            return {"ok": False, "error": "capability_name is required"}
        if not app_name:
            return {"ok": False, "error": "app_name is required"}
        if not app_repo_name:
            return {"ok": False, "error": "app_repo_name is required"}

        app_result = ensure_capability_app_repo(
            capability_name=capability_name,
            app_repo_name=app_repo_name,
            app_name=app_name,
        )
        if not app_result["ok"]:
            return app_result


        save_registry_record({
            "capability_name": capability_name,
            "usecase_name": "__capability__",
            "agent_type": "__app__",
            "app_name": app_name,
            "app_repo_name": app_repo_name,
            "agent_name": "",
            "agent_repo_name": "",
            "components": {},
            "prompt_types": [],
            "features": {},
            "default_model": "",
        })
        return {
            "ok": True,
            "status": "capability_created",
            "capability_name": capability_name,
            "app_name": app_name,
            "app_repo_name": app_repo_name,
            "app_repo_url": app_result["repo_root"],
            "app_created": app_result.get("app_created", False),
            "app_reused": app_result.get("app_reused", False),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/registry/app-by-capability")
def get_registry_app_by_capability(capability_name: str):
    app_record = get_app_by_capability(capability_name)
    return {
        "ok": True,
        "app": app_record,
    }


# =========================================================
# AGENT CONFIG READ / WRITE
# =========================================================

def _get_agent_config_dir(capability_name: str, usecase_name: str, agent_type: str, agent_repo_name: str) -> Path:
    return (
        AGENTS_ROOT
        / capability_name
        / agent_repo_name
        / "overlays"
        / agent_type
        / "config"
    )


def _deep_merge(base: dict, override: dict):
    for key, val in override.items():
        if key in base and isinstance(base[key], dict) and isinstance(val, dict):
            _deep_merge(base[key], val)
        else:
            base[key] = val


@app.get("/registry/agent-config")
def get_agent_config(capability_name: str, usecase_name: str, agent_type: str):
    agents = list_agents(capability_name, usecase_name)
    agent_record = next((a for a in agents if a.get("agent_type") == agent_type), None)
    if not agent_record:
        return {"ok": False, "error": "Agent not found in registry"}

    agent_repo_name = agent_record.get("agent_repo_name", "")
    config_dir = _get_agent_config_dir(capability_name, usecase_name, agent_type, agent_repo_name)

    result = {}
    file_keys = {
        "agent.yaml": "agent",
        "memory.yaml": "memory",
        "prompt-defaults.yaml": "prompts",
    }
    for filename, key in file_keys.items():
        filepath = config_dir / filename
        result[key] = yaml.safe_load(filepath.read_text()) or {} if filepath.exists() else {}

    # domain.yaml lives at agent root (capability-level, copied at scaffold)
    domain_path = AGENTS_ROOT / capability_name / agent_repo_name / "domain.yaml"
    result["domain"] = yaml.safe_load(domain_path.read_text()) or {} if domain_path.exists() else {}

    # agent_manifest.yaml lives at overlay root
    manifest_path = AGENTS_ROOT / capability_name / agent_repo_name / "overlays" / agent_type / "agent_manifest.yaml"
    result["manifest"] = yaml.safe_load(manifest_path.read_text()) or {} if manifest_path.exists() else {}

    return {
        "ok": True,
        "capability_name": capability_name,
        "usecase_name": usecase_name,
        "agent_type": agent_type,
        "agent_repo_name": agent_repo_name,
        "config": result,
        "config_dir": str(config_dir),
    }


class PatchAgentConfigRequest(BaseModel):
    capability_name: str
    usecase_name: str
    agent_type: str
    section: str  # "agent", "memory", "prompts"
    changes: dict


@app.get("/registry/agent-manifest")
def get_agent_manifest(capability_name: str, usecase_name: str, agent_type: str):
    agents = list_agents(capability_name, usecase_name)
    agent_record = next((a for a in agents if a.get("agent_type") == agent_type), None)
    if not agent_record:
        return {"ok": False, "error": "Agent not found in registry"}

    agent_repo_name = agent_record.get("agent_repo_name", "")
    manifest_path = (
        AGENTS_ROOT
        / capability_name
        / agent_repo_name
        / "overlays"
        / agent_type
        / "agent_manifest.yaml"
    )

    if not manifest_path.exists():
        return {"ok": False, "error": f"Manifest not found: {manifest_path}"}

    manifest = yaml.safe_load(manifest_path.read_text()) or {}
    return {"ok": True, "manifest": manifest}


@app.get("/registry/template-manifest")
def get_template_manifest(agent_type: str):
    """Read agent_manifest.yaml from the template overlay (before any repo is created)."""
    manifest_path = AGENT_TEMPLATE_ROOT / "overlays" / agent_type / "agent_manifest.yaml"
    if not manifest_path.exists():
        return {"ok": False, "error": f"No template manifest for agent_type '{agent_type}'"}
    manifest = yaml.safe_load(manifest_path.read_text()) or {}
    return {"ok": True, "manifest": manifest}


@app.patch("/registry/agent-config")
def patch_agent_config(payload: PatchAgentConfigRequest):
    agents = list_agents(payload.capability_name, payload.usecase_name)
    agent_record = next((a for a in agents if a.get("agent_type") == payload.agent_type), None)
    if not agent_record:
        return {"ok": False, "error": "Agent not found in registry"}

    agent_repo_name = agent_record.get("agent_repo_name", "")
    config_dir = _get_agent_config_dir(
        payload.capability_name, payload.usecase_name, payload.agent_type, agent_repo_name
    )

    file_map = {"agent": "agent.yaml", "memory": "memory.yaml", "prompts": "prompt-defaults.yaml"}
    filename = file_map.get(payload.section)
    if not filename:
        return {"ok": False, "error": f"Unknown section '{payload.section}'. Must be one of: {list(file_map.keys())}"}

    filepath = config_dir / filename
    if not filepath.exists():
        return {"ok": False, "error": f"Config file not found: {filepath}"}

    existing = yaml.safe_load(filepath.read_text()) or {}
    _deep_merge(existing, payload.changes)
    filepath.write_text(yaml.safe_dump(existing, sort_keys=False))

    return {
        "ok": True,
        "section": payload.section,
        "file": filename,
        "config_dir": str(config_dir),
    }


# =========================================================
# AGENT STATUS (health check per registered agent)
# =========================================================

@app.get("/registry/agent-status")
def get_agent_status():
    import urllib.request as _urllib_req

    records = list_registry_records()
    real_agents = [
        r for r in records
        if r.get("usecase_name") != "__capability__" and r.get("agent_type") != "__app__"
    ]

    workspace_agent_repo = LAST_WORKSPACE_STATE.get("agent_repo", "")
    workspace_runtime_url = LAST_WORKSPACE_STATE.get("agent_runtime_url", "http://localhost:8081")

    result = []
    for agent in real_agents:
        agent_repo = agent.get("agent_repo_name", "")
        runtime_url = workspace_runtime_url if agent_repo == workspace_agent_repo else "http://localhost:8081"

        status = "stopped"
        try:
            req = _urllib_req.Request(f"{runtime_url}/health", headers={"User-Agent": "factory-status-check"})
            with _urllib_req.urlopen(req, timeout=2) as resp:
                if resp.getcode() == 200:
                    status = "running"
        except Exception:
            status = "stopped"

        result.append({
            "capability_name": agent.get("capability_name"),
            "usecase_name": agent.get("usecase_name"),
            "agent_type": agent.get("agent_type"),
            "agent_repo_name": agent_repo,
            "app_repo_name": agent.get("app_repo_name"),
            "status": status,
            "runtime_url": runtime_url,
            "features": agent.get("features", {}),
            "locked_features": agent.get("locked_features", []),
        })

    return {"ok": True, "agents": result}

# =========================================================
# FILESYSTEM DISCOVERY — reads capabilities/ and agents/ directories
# =========================================================

@app.get("/filesystem/capabilities")
def filesystem_capabilities():
    """List capabilities that developers have created under capabilities/"""
    caps_root = PLATFORM_ROOT / "capabilities"
    if not caps_root.exists():
        return {"ok": True, "capabilities": []}
    caps = sorted([d.name for d in caps_root.iterdir() if d.is_dir()])
    return {"ok": True, "capabilities": caps}


@app.get("/filesystem/agents")
def filesystem_agents(capability_name: str):
    """List agent folders under agents/<capability>/"""
    agents_dir = AGENTS_ROOT / capability_name
    if not agents_dir.exists():
        return {"ok": True, "agents": []}
    agents = sorted([d.name for d in agents_dir.iterdir() if d.is_dir()])
    return {"ok": True, "agents": agents}


# =========================================================
# CONFIG LAB — read/write overlay YAML files for the test harness
# ================================================================

_ALLOWED_CONFIG_FILES = {"agent.yaml", "prompt-defaults.yaml", "memory.yaml"}


class WriteConfigFileRequest(BaseModel):
    capability_name: str
    usecase_name: str
    agent_type: str
    filename: str   # agent.yaml | prompt-defaults.yaml | memory.yaml
    content: str    # raw YAML text


@app.get("/config-lab/file")
def config_lab_read_file(capability_name: str, usecase_name: str, agent_type: str, filename: str):
    if filename not in _ALLOWED_CONFIG_FILES:
        raise HTTPException(status_code=400, detail=f"filename must be one of {_ALLOWED_CONFIG_FILES}")
    agents = list_agents(capability_name, usecase_name)
    agent_record = next((a for a in agents if a.get("agent_type") == agent_type), None)
    if not agent_record:
        raise HTTPException(status_code=404, detail="Agent not found")
    config_dir = _get_agent_config_dir(capability_name, usecase_name, agent_type, agent_record["agent_repo_name"])
    filepath = config_dir / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail=f"{filename} not found at {filepath}")
    return {"ok": True, "filename": filename, "content": filepath.read_text()}


@app.post("/config-lab/file")
def config_lab_write_file(payload: WriteConfigFileRequest):
    if payload.filename not in _ALLOWED_CONFIG_FILES:
        raise HTTPException(status_code=400, detail=f"filename must be one of {_ALLOWED_CONFIG_FILES}")
    # Validate YAML before writing
    try:
        yaml.safe_load(payload.content)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=422, detail=f"Invalid YAML: {e}")
    agents = list_agents(payload.capability_name, payload.usecase_name)
    agent_record = next((a for a in agents if a.get("agent_type") == payload.agent_type), None)
    if not agent_record:
        raise HTTPException(status_code=404, detail="Agent not found")
    config_dir = _get_agent_config_dir(
        payload.capability_name, payload.usecase_name,
        payload.agent_type, agent_record["agent_repo_name"]
    )
    filepath = config_dir / payload.filename
    filepath.write_text(payload.content)

    # Restart platform-services so new config is picked up
    ws = _load_workspace_state()
    agent_repo = agent_record.get("agent_repo_name", "")
    repo_path = resolve_repo_path(agent_repo)
    restart_msg = "config written"
    try:
        subprocess.Popen(
            [DOCKER_BIN, "compose", "restart", "platform-services"],
            cwd=str(repo_path),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        restart_msg = "platform-services restarting"
    except Exception as e:
        restart_msg = f"write ok but restart failed: {e}"

    return {"ok": True, "filename": payload.filename, "path": str(filepath), "restart": restart_msg}


# AGENT MINI UI — serves the static HTML mini UI for an agent
# =========================================================

@app.get("/agent-ui/{capability_name}/{agent_repo_name}/{agent_type}")
def agent_mini_ui(capability_name: str, agent_repo_name: str, agent_type: str):
    """Serve the per-agent mini UI HTML file (chat or summary)."""
    # Map agent_type prefix to UI folder
    if "summar" in agent_type:
        ui_folder = "summary-ui"
    else:
        ui_folder = "chat-ui"

    html_path = AGENTS_ROOT / capability_name / agent_repo_name / "services" / ui_folder / "index.html"
    if not html_path.exists():
        raise HTTPException(status_code=404, detail=f"Mini UI not found at {html_path}. Run scaffold to generate it.")

    return FileResponse(str(html_path), media_type="text/html")
