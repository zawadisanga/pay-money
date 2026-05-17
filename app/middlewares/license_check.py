from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from app.licensing import validate_license
import asyncio

class LicenseMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip license check for public endpoints (e.g., /health, /docs)
        if request.url.path in ["/", "/health", "/docs", "/openapi.json", "/redoc", "/api/auth/login", "/api/auth/register", "/api/license/activate"]:
            return await call_next(request)

        try:
            # Validate license
            await validate_license(request)
        except HTTPException as e:
            return e

        return await call_next(request)
