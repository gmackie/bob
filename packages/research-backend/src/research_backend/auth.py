"""Service-to-service authentication for the private research sidecar."""

from __future__ import annotations

import secrets
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class ResearchServiceAuthMiddleware(BaseHTTPMiddleware):
    """Fail closed for every route except the content-free liveness probe."""

    def __init__(self, app, *, service_token: str) -> None:
        super().__init__(app)
        self._service_token = service_token.strip()

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.url.path == "/health":
            return await call_next(request)

        if not self._service_token:
            return JSONResponse(
                status_code=503,
                content={"detail": "Research service authentication is not configured"},
            )

        authorization = request.headers.get("authorization", "")
        scheme, separator, supplied_token = authorization.partition(" ")
        authorized = (
            separator == " "
            and scheme.lower() == "bearer"
            and bool(supplied_token)
            and secrets.compare_digest(supplied_token, self._service_token)
        )
        if not authorized:
            return JSONResponse(
                status_code=401,
                headers={"WWW-Authenticate": "Bearer"},
                content={"detail": "Invalid research service credential"},
            )
        return await call_next(request)
