"""Параметры сервиса приложения (документ «Страницы Flask и порты»)."""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas.settings import Portal, Settings

# Переход из журнала в управление пользователями без повторного входа (сервис web)
ADMIN_HANDOFF_PATH = "/api/auth/admin-handoff"


@dataclass(frozen=True, slots=True)
class PortalConfig:
    portal: Portal
    # JWT выдаётся для конкретного сервиса (claim aud): токен рабочей части
    # не принимается сервисом администрирования и наоборот
    audience: str
    # Сессии портов разделяются по имени cookie с refresh-токеном (раздел 6)
    refresh_cookie: str
    session_cookie: str
    allowed_origins: tuple[str, ...]
    # Вход на порту 5620 только при праве «Настройки» (menuSettings)
    login_requires_settings: bool
    login_path: str
    home_path: str
    # Ссылка «Управление пользователями»
    admin_link: str

    @classmethod
    def for_portal(cls, portal: Portal, settings: Settings) -> PortalConfig:
        if portal is Portal.WEB:
            return cls(
                portal=portal,
                audience="omsa-ledger-web",
                refresh_cookie="omsa_refresh",
                session_cookie="omsa_session",
                allowed_origins=settings.origins_for(portal),
                login_requires_settings=False,
                login_path="/login",
                home_path="/journal",
                admin_link=ADMIN_HANDOFF_PATH,
            )
        return cls(
            portal=portal,
            audience="omsa-ledger-admin",
            refresh_cookie="omsa_admin_refresh",
            session_cookie="omsa_admin_session",
            allowed_origins=settings.origins_for(portal),
            login_requires_settings=True,
            login_path="/login",
            home_path="/users",
            admin_link=settings.admin_public_url,
        )
