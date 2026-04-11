from __future__ import annotations

import os
from typing import Any, Dict

import httpx

# All Container 1 clients read this single env var to locate Container 2.
# Same image, no code changes — swap .env to switch local/remote deployment.
#
#   Local dev:       PLATFORM_SERVICES_URL=http://localhost:8002
#   Same VPC:        PLATFORM_SERVICES_URL=http://platform-services:8080
#   Cross-VPC:       PLATFORM_SERVICES_URL=https://platform-services.yourvpc.com

_DEFAULT_TIMEOUT = 30.0


def get_platform_services_url() -> str:
    url = os.getenv("PLATFORM_SERVICES_URL", "http://localhost:8002")
    return url.rstrip("/")


def post(path: str, payload: Dict[str, Any], timeout: float = _DEFAULT_TIMEOUT) -> Dict[str, Any]:
    url = f"{get_platform_services_url()}{path}"
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(url, json=payload)
        resp.raise_for_status()
        return resp.json()


def get(path: str, params: Dict[str, Any] | None = None, timeout: float = _DEFAULT_TIMEOUT) -> Dict[str, Any]:
    url = f"{get_platform_services_url()}{path}"
    with httpx.Client(timeout=timeout) as client:
        resp = client.get(url, params=params or {})
        resp.raise_for_status()
        return resp.json()
