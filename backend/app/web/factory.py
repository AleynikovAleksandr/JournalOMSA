"""Flask-приложение сервиса: страницы, шаблоны, статические файлы, CSRF, база данных."""

from __future__ import annotations

from pathlib import Path

from flask import Flask, Response
from flask_wtf.csrf import CSRFProtect

from app.schemas.settings import Portal, Settings
from app.services.authentication.portal import PortalConfig
from app.web.admin_pages import admin_pages
from app.web.pages import web_pages
from database.session import configure_flask_database

BACKEND_DIR = Path(__file__).resolve().parents[2]

csrf = CSRFProtect()


def create_flask_app(portal: PortalConfig, settings: Settings) -> Flask:
    flask_app = Flask(
        "omsa_ledger",
        root_path=str(BACKEND_DIR),
        template_folder="templates",
        static_folder="static",
    )
    flask_app.config.update(
        SECRET_KEY=settings.secret_key,
        # Сессии портов разделяются по имени cookie (документ «Страницы Flask и порты», раздел 6)
        SESSION_COOKIE_NAME=portal.session_cookie,
        SESSION_COOKIE_SECURE=settings.cookie_secure,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Strict",
        WTF_CSRF_ENABLED=settings.csrf_enabled,
        # Страница журнала открыта весь рабочий день: токен действует, пока жива сессия
        WTF_CSRF_TIME_LIMIT=None,
        WTF_I18N_ENABLED=False,
        SEND_FILE_MAX_AGE_DEFAULT=3600,
        TEMPLATES_AUTO_RELOAD=not settings.is_production,
        OMSA_PORTAL=portal.portal.value,
        OMSA_ADMIN_URL=portal.admin_link,
        OMSA_ASSET_VERSION=settings.app_version,
    )
    configure_flask_database(flask_app, settings)
    csrf.init_app(flask_app)
    flask_app.register_blueprint(web_pages if portal.portal is Portal.WEB else admin_pages)

    @flask_app.context_processor
    def _template_globals() -> dict[str, str]:
        return {
            "asset_version": flask_app.config["OMSA_ASSET_VERSION"],
            "portal": portal.portal.value,
            "app_timezone": settings.app_timezone,
        }

    @flask_app.after_request
    def _no_store_pages(response: Response) -> Response:
        # Страницы содержат CSRF-токен сессии и не кэшируются
        if response.mimetype == "text/html":
            response.headers["Cache-Control"] = "no-store"
        return response

    return flask_app
