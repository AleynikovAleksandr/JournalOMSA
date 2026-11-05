"""Сборка ASGI-приложения сервиса.

Один процесс Gunicorn (воркер uvicorn_worker.UvicornWorker) обслуживает:
* REST/JSON-API (FastAPI) — /api/*;
* WebSocket — /ws;
* проверку работоспособности — /health;
* страницы и статические файлы (Flask) — всё остальное.

Сервисы web (порт 5600) и admin (порт 5620) собираются из одного кода
и различаются набором страниц Flask и параметрами портала.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator

import redis
from a2wsgi import WSGIMiddleware
from fastapi import FastAPI

from app.api.exception_handlers import register_exception_handlers
from app.api.realtime import ConnectionHub, RedisEventListener
from app.api.realtime import router as realtime_router
from app.api.routers.health import router as health_router
from app.api.routes import build_api_router
from app.api.security_headers import SecurityHeadersMiddleware, build_csp
from app.container import Container
from app.schemas.settings import Portal, Settings
from app.services.authentication.portal import PortalConfig
from app.web.factory import create_flask_app
from core.clock import Clock
from core.config import get_settings
from core.interprocess.events import EventBus
from core.logging import configure_logging
from core.security.passwords import Argon2PasswordHasher


def create_application(
    portal: Portal,
    settings: Settings | None = None,
    *,
    clock: Clock | None = None,
    redis_client: redis.Redis | None = None,
    hasher: Argon2PasswordHasher | None = None,
    event_bus: EventBus | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    settings.check_production()
    configure_logging(settings.log_level, settings.app_log_dir)
    portal_config = PortalConfig.for_portal(portal, settings)
    flask_app = create_flask_app(portal_config, settings)
    container = Container(
        settings, portal_config, flask_app, clock=clock, redis_client=redis_client, hasher=hasher, event_bus=event_bus
    )
    hub = ConnectionHub()

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        listener: asyncio.Task[None] | None = None
        subscription: int | None = None
        if container.event_bus is not None:
            subscription = container.event_bus.subscribe(asyncio.get_running_loop(), hub.dispatch)
        else:
            listener = asyncio.create_task(RedisEventListener(settings.redis_connection_url, hub).run())
        try:
            yield
        finally:
            if listener is not None:
                listener.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await listener
            if container.event_bus is not None and subscription is not None:
                container.event_bus.unsubscribe(subscription)
            await hub.close_all()

    application = FastAPI(
        title=f"OMSA Ledger — {'журнал проверок' if portal is Portal.WEB else 'управление пользователями'}",
        version=settings.app_version,
        docs_url=None,
        redoc_url=None,
        openapi_url=None if settings.is_production else "/api/openapi.json",
        lifespan=lifespan,
    )
    application.state.container = container
    application.state.hub = hub
    register_exception_handlers(application)
    application.include_router(build_api_router())
    application.include_router(health_router)
    application.include_router(realtime_router)
    application.add_middleware(SecurityHeadersMiddleware, csp=build_csp(portal_config.allowed_origins))
    # Страницы Flask — последними: всё, что не обработал FastAPI
    application.mount("/", WSGIMiddleware(flask_app))
    return application


def create_portal_app(name: str) -> FastAPI:
    """Приложение сервиса для Gunicorn: APP_MODULE="app.main:create_portal_app('web')" или ('admin')."""
    try:
        portal = Portal(name)
    except ValueError:
        raise ValueError(f"Неизвестный сервис {name!r}: ожидается 'web' или 'admin'") from None
    return create_application(portal)
