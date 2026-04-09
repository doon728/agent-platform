from __future__ import annotations

from typing import Any, Dict, Optional

from platform_core.auth import AuthResult


def enforce_tenant_isolation(ctx: Dict[str, Any], auth: AuthResult) -> None:
    """
    Option A (now): If token has tenant_id, then the request tenant must match it.
    If token has no tenant_id (or auth is OFF/OPTIONAL), allow for now.

    Later (Option B): enforce tool-level policies / scopes.
    """
    ctx_tenant: Optional[str] = ctx.get("tenant_id")

    # If auth didn't carry a tenant, we don't enforce tenant match (for now).
    # (Typical in AUTH_MODE=OFF, OPTIONAL-without-token, or token missing tenant claim)
    if not auth.tenant_id:
        return

    # If token has tenant but request didn't send one, block (prevents "implicit tenant" ambiguity)
    if not ctx_tenant:
        raise PermissionError("Missing tenant_id in request payload")

    if str(ctx_tenant) != str(auth.tenant_id):
        raise PermissionError("tenant_id mismatch between request and token")