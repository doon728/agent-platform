from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional
import requests
import jwt
from jwt import PyJWKClient
from fastapi import HTTPException, Request

AUTH_MODE = os.getenv("AUTH_MODE", "OFF").upper()  # OFF | OPTIONAL | REQUIRED

JWT_ISSUER = os.getenv("JWT_ISSUER", "").strip()          # required when AUTH_MODE != OFF
JWT_AUDIENCE = os.getenv("JWT_AUDIENCE", "").strip()      # optional but recommended
JWT_JWKS_URL = os.getenv("JWT_JWKS_URL", "").strip()      # required when AUTH_MODE != OFF

JWT_TENANT_CLAIM = os.getenv("JWT_TENANT_CLAIM", "tenant_id")
JWT_USER_CLAIM = os.getenv("JWT_USER_CLAIM", "sub")

# Small cache for jwks client
_jwk_client: Optional[PyJWKClient] = None


@dataclass
class AuthResult:
    ok: bool
    tenant_id: Optional[str] = None
    user_id: Optional[str] = None
    token_present: bool = False
    reason: Optional[str] = None


def _extract_bearer_token(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth:
        return None
    parts = auth.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None


def _get_jwk_client() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        if not JWT_JWKS_URL:
            raise RuntimeError("JWT_JWKS_URL is not set")
        _jwk_client = PyJWKClient(JWT_JWKS_URL)
    return _jwk_client


def _validate_and_decode(token: str) -> Dict[str, Any]:
    if not JWT_ISSUER:
        raise RuntimeError("JWT_ISSUER is not set")
    if not JWT_JWKS_URL:
        raise RuntimeError("JWT_JWKS_URL is not set")

    jwk_client = _get_jwk_client()
    signing_key = jwk_client.get_signing_key_from_jwt(token).key

    options = {
        "verify_signature": True,
        "verify_exp": True,
        "verify_iat": True,
        "verify_nbf": True,
        "verify_iss": True,
    }

    kwargs: Dict[str, Any] = {
        "key": signing_key,
        "algorithms": ["RS256", "ES256", "RS384", "RS512"],  # allow common ones
        "issuer": JWT_ISSUER,
        "options": options,
    }

    if JWT_AUDIENCE:
        kwargs["audience"] = JWT_AUDIENCE
    else:
        # if you don't set audience, don't verify it
        kwargs["options"]["verify_aud"] = False

    return jwt.decode(token, **kwargs)


def authenticate_request(request: Request) -> AuthResult:
    token = _extract_bearer_token(request)
    token_present = bool(token)

    if AUTH_MODE == "OFF":
        return AuthResult(ok=True, token_present=token_present)

    if AUTH_MODE == "REQUIRED" and not token_present:
        raise HTTPException(status_code=401, detail="Missing Authorization: Bearer <token>")

    if AUTH_MODE == "OPTIONAL" and not token_present:
        return AuthResult(ok=True, token_present=False)

    assert token is not None

    try:
        claims = _validate_and_decode(token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

    tenant_id = claims.get(JWT_TENANT_CLAIM)
    user_id = claims.get(JWT_USER_CLAIM)

    if not user_id:
        raise HTTPException(status_code=401, detail=f"Token missing user claim: {JWT_USER_CLAIM}")

    return AuthResult(ok=True, tenant_id=str(tenant_id) if tenant_id else None, user_id=str(user_id), token_present=True)