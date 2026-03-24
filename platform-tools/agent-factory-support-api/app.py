from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
GENERATED_REPOS_ROOT = Path(
    os.getenv("GENERATED_REPOS_ROOT", str(Path.home() / "agent-platform" / "generated-repos"))
)

def resolve_repo_path(repo_name: str) -> Path:
    """
    Finds repo anywhere under generated-repos (supports capability/usecase nesting)
    """
    direct = GENERATED_REPOS_ROOT / repo_name
    if direct.exists():
        return direct

    matches = list(GENERATED_REPOS_ROOT.rglob(repo_name))
    if matches:
        return matches[0]

    return direct


PLATFORM_ROOT = Path(
    os.getenv("AGENT_PLATFORM_ROOT", str(Path.home() / "agent-platform"))
)

SHARED_INFRA_ROOT = PLATFORM_ROOT / "shared-infra" / "industry-tool-gateway-healthcare" / "services" / "tool-gateway"
LAST_WORKSPACE_STATE: dict[str, Any] = {}
app = FastAPI(title="Agent Factory Support API", version="v1")

TEMPLATES_ROOT = PLATFORM_ROOT / "templates"
AGENT_TEMPLATE_ROOT = TEMPLATES_ROOT / "agent-runtime-template"
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
    capability_root = GENERATED_REPOS_ROOT / capability_name
    capability_root.mkdir(parents=True, exist_ok=True)

    app_repo_root = capability_root / app_repo_name

    if app_repo_root.exists():
        return {
            "ok": True,
            "repo_root": str(app_repo_root),
            "app_created": False,
            "app_reused": True,
        }

    app_copy = copy_template_repo(APP_TEMPLATE_ROOT, app_repo_root)
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

    prompt_defaults_yaml = {
        "planner_system_prompt": prompts_cfg.get("planner_system_prompt")
        or (
            "You are a care management planner.\n"
            "Use get_member_summary for member ids like m-100001.\n"
            "Use get_assessment_summary only for assessment ids like asmt-100001.\n"
            "If no direct member or assessment lookup fits, use search_kb."
        ),
        "responder_system_prompt": prompts_cfg.get("responder_system_prompt")
        or (
            "You are a care management nurse assistant.\n"
            "Answer clearly and briefly using tool output only."
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

    result = run_cmd(["docker", "compose", "down", "--remove-orphans"], cwd=str(repo_root))
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
            ["docker", "compose", "ps", "--format", "json"],
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
        agent_type = first_agent.get("agent_type", "chat_agent")

        capability_name = create_cfg.get("capability_name", "care-management")
        usecase_name = create_cfg.get("usecase_name", "cm_assistant")

        if not app_repo_name or not agent_repo_name:
            return {"ok": False, "error": "Missing repo names"}

        # ======================================================
        # NEW HIERARCHY
        # capability/
        #   app_repo
        #   usecases/
        #       usecase/
        #           agent_repo
        # ======================================================

        capability_root = GENERATED_REPOS_ROOT / capability_name
        capability_root.mkdir(parents=True, exist_ok=True)

        usecase_root = capability_root / "usecases" / usecase_name
        usecase_root.mkdir(parents=True, exist_ok=True)

        # ---------- ensure app repo exists ----------
        app_result = ensure_capability_app_repo(
            capability_name=capability_name,
            app_repo_name=app_repo_name,
            app_name=app_name,
        )
        if not app_result["ok"]:
            return app_result

        app_repo_root = Path(app_result["repo_root"])

        # ---------- create agent repo ----------
        agent_repo_root = usecase_root / agent_repo_name

        agent_copy = assemble_agent_repo_from_template(agent_repo_root, agent_type)
        if not agent_copy["ok"]:
            return agent_copy

        # ---------- copy platform runtime ----------
        platform_copy = copy_platform_assets_into_agent_repo(agent_repo_root)
        if not platform_copy["ok"]:
            shutil.rmtree(agent_repo_root, ignore_errors=True)
            return platform_copy


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
            "usecase_name": usecase_name,
            "app_repo_name": app_repo_name,
            "app_repo_url": str(app_repo_root),
            "app_created": app_result.get("app_created"),
            "app_reused": app_result.get("app_reused"),
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
            ["docker", "compose", "up", "-d", "--build", "--force-recreate"],
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
    app_repo: str,
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
        "requested_runtime_port": runtime_port,
        "requested_app_port": app_port,
        "resolved_runtime_port": resolved_runtime_port,
        "resolved_app_port": resolved_app_port,
        "tool_gateway_url": "http://localhost:8080",
        "agent_runtime_url": f"http://localhost:{resolved_runtime_port}",
        "app_ui_url": f"http://localhost:{resolved_app_port}",
    }
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
            "app_ui_url": f"http://localhost:{resolved_app_port}",
        },
    }

@app.get("/workspace/status")
def workspace_status():
    global LAST_WORKSPACE_STATE

    return {
        "ok": True,
        "repos": {
            "agent_repo": LAST_WORKSPACE_STATE.get("agent_repo"),
            "app_repo": LAST_WORKSPACE_STATE.get("app_repo"),
        },
        "ports": {
            "requested_runtime_port": LAST_WORKSPACE_STATE.get("requested_runtime_port"),
            "requested_app_port": LAST_WORKSPACE_STATE.get("requested_app_port"),
            "resolved_runtime_port": LAST_WORKSPACE_STATE.get("resolved_runtime_port"),
            "resolved_app_port": LAST_WORKSPACE_STATE.get("resolved_app_port"),
        },
        "urls": {
            "tool_gateway_url": LAST_WORKSPACE_STATE.get("tool_gateway_url"),
            "agent_runtime_url": LAST_WORKSPACE_STATE.get("agent_runtime_url"),
            "app_ui_url": LAST_WORKSPACE_STATE.get("app_ui_url"),
        },
        "runtime_model": {
            "gateway": "shared_external_local",
            "postgres": "shared_external_local",
            "agent_runtime": "repo_local",
            "ui": "repo_local",
        },
    }

@app.get("/repo-exists")
def repo_exists(name: str):
    matches = list(GENERATED_REPOS_ROOT.rglob(name))

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

    existing_names = {p.name for p in GENERATED_REPOS_ROOT.rglob("*") if p.is_dir()}

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