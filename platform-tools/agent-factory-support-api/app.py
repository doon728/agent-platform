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


def inject_agent_usecase_and_prompt_config(
    repo_root: Path,
    app_name: str,
    agent_type: str,
    usecase: str,
):
    cfg_file = repo_root / "services" / "agent-runtime" / "config" / "base.yaml"
    if cfg_file.exists():
        data = yaml.safe_load(cfg_file.read_text()) or {}
        data["app"] = data.get("app", {})
        data["app"]["active_usecase"] = usecase
        data["prompt_service"] = {
            "url": "http://host.docker.internal:8101",
            "app_name": app_name,
            "agent_type": agent_type,
            "usecase_name": usecase,
            "environment": "dev",
        }
        cfg_file.write_text(yaml.safe_dump(data, sort_keys=False))


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


def inject_prompt_config(repo_root: Path, app_name: str, agent_type: str, usecase: str):
    cfg_file = repo_root / "services" / "agent-runtime" / "config" / "base.yaml"

    if not cfg_file.exists():
        return

    data = yaml.safe_load(cfg_file.read_text())

    data["prompt_service"] = {
        "url": "http://host.docker.internal:8101",
        "app_name": app_name,
        "agent_type": agent_type,
        "usecase_name": usecase,
        "environment": "dev",
    }

    cfg_file.write_text(yaml.dump(data))


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
        usecase_name = create_cfg.get("usecase_name", "cm_assistant")

        if not app_repo_name or not agent_repo_name:
            return {"ok": False, "error": "Missing repo names"}

        capability_name = create_cfg.get("capability_name", "care-management")
        usecase_name = create_cfg.get("usecase_name", "cm-assistant")

        target_root = GENERATED_REPOS_ROOT / capability_name / usecase_name
        target_root.mkdir(parents=True, exist_ok=True)

        app_repo_root = target_root / app_repo_name
        agent_repo_root = target_root / agent_repo_name

        app_copy = copy_template_repo(APP_TEMPLATE_ROOT, app_repo_root)
        if not app_copy["ok"]:
            return app_copy

        agent_copy = copy_template_repo(AGENT_TEMPLATE_ROOT, agent_repo_root)
        if not agent_copy["ok"]:
            if app_repo_root.exists():
                shutil.rmtree(app_repo_root, ignore_errors=True)
            return agent_copy

        inject_app_config(
            repo_root=app_repo_root,
            app_name=app_name,
        )

        inject_repo_env(
            repo_root=agent_repo_root,
            env_values={
                "OPENAI_API_KEY": os.getenv("OPENAI_API_KEY", ""),
                "OPENAI_MODEL": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                "TOOL_GATEWAY_URL": os.getenv("TOOL_GATEWAY_URL", "http://host.docker.internal:8080"),
            },
        )

        inject_repo_env(
            repo_root=app_repo_root,
            env_values={
                "VITE_API_PROXY_TARGET": "http://host.docker.internal:8081",
            },
        )


        inject_agent_usecase_and_prompt_config(
            repo_root=agent_repo_root,
            app_name=app_name,
            agent_type=agent_type,
            usecase=usecase_name,
        )

        return {
            "ok": True,
            "status": "application_generated",
            "industry": payload.get("industry", ""),
            "customer_name": payload.get("customer_name", ""),
            "line_of_business": payload.get("line_of_business", ""),
            "app_repo_name": app_repo_name,
            "app_repo_url": str(app_repo_root),
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
        env["AGENT_RUNTIME_PORT"] = str(port)

        if "OPENAI_API_KEY" not in env:
            env["OPENAI_API_KEY"] = os.getenv("OPENAI_API_KEY", "")

        result = run_cmd(
            ["docker", "compose", "up", "-d"],
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
        env["APP_UI_PORT"] = str(port)
        env["VITE_API_PROXY_TARGET"] = f"http://host.docker.internal:{runtime_port}"

        result = run_cmd(
            ["docker", "compose", "up", "-d"],
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
    resolved_app_port = find_free_port(app_port)

    infra = infra_start()

    runtime_cleanup = runtime_stop(repo_name=agent_repo)
    app_cleanup = app_stop(repo_name=app_repo)

    agent_repo_root = resolve_repo_path(agent_repo)

    inject_prompt_config(
        repo_root=agent_repo_root,
        app_name=app_repo,
        agent_type="chat_agent",
        usecase="cm_assistant",
    )

    runtime = runtime_start(repo_name=agent_repo, port=resolved_runtime_port)
    app_result = app_start(
        repo_name=app_repo,
        port=resolved_app_port,
        runtime_url=f"http://localhost:{resolved_runtime_port}",
    )

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
def workspace_status(
    agent_repo: str,
    app_repo: str,
    runtime_port: int = 8081,
    app_port: int = 3000,
):
    return {
        "ok": True,
        "repos": {
            "agent_repo": agent_repo,
            "app_repo": app_repo,
        },
        "urls": {
            "tool_gateway_url": "http://localhost:8080",
            "agent_runtime_url": f"http://localhost:{runtime_port}",
            "app_ui_url": f"http://localhost:{app_port}",
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
    repo_path = resolve_repo_path(name)

    return {
        "ok": True,
        "name": name,
        "exists": repo_path.exists(),
        "path": str(repo_path),
        "backend": "local_filesystem"
    }
    
@app.get("/next-available-repo-name")
def next_available_repo_name(base: str):
    base_slug = base.strip()

    candidate = base_slug
    counter = 2

    while (GENERATED_REPOS_ROOT / candidate).exists():
        candidate = f"{base_slug}-{counter}"
        counter += 1

    return {
        "ok": True,
        "base": base_slug,
        "suggested": candidate
    }