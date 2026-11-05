"""Схема настроек OMSA Ledger (Pydantic): имена и типы параметров и их проверка.

Значений в коде нет — все параметры обязательны и читаются из переменных окружения,
которые передаёт Secret omsa-ledger-secrets (deploy_k8s/overlays/prod/secret.yaml).
Имя переменной окружения — имя поля в верхнем регистре. Загрузка — core.config.get_settings().
"""

from __future__ import annotations

from datetime import timedelta
from enum import StrEnum
from urllib.parse import quote, urlsplit
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict


class Portal(StrEnum):
    """Сервис приложения: рабочая часть (порт 5600) или администрирование (порт 5620)."""

    WEB = "web"
    ADMIN = "admin"


def _split(value: str) -> tuple[str, ...]:
    return tuple(item.strip().rstrip("/") for item in value.split(",") if item.strip())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    app_env: str
    app_version: str

    # ---- ключи ----
    secret_key: str
    jwt_secret: str
    jwt_algorithm: str
    access_token_ttl_minutes: int
    refresh_token_ttl_days: int

    # ---- Argon2id ----
    argon2_time_cost: int
    argon2_memory_kib: int
    argon2_parallelism: int

    # ---- PostgreSQL (пустой DATABASE_URL — строка подключения собирается из POSTGRES_*) ----
    database_url: str | None
    postgres_host: str
    postgres_port: int
    postgres_user: str
    postgres_db: str
    postgres_password: str | None
    db_pool_size: int
    db_max_overflow: int
    db_pool_recycle: int

    # ---- Redis (пустой REDIS_URL — строка подключения собирается из REDIS_*) ----
    redis_url: str | None
    redis_host: str
    redis_port: int
    redis_username: str | None
    redis_password: str | None
    redis_db: int
    celery_broker_db: int

    # ---- вход в систему (ТЗ, раздел 3) ----
    login_max_attempts: int
    login_lock_minutes: int
    login_ip_max_attempts: int
    login_ip_window_minutes: int

    # ---- порталы, cookie, источники запросов (документ «Страницы Flask и порты») ----
    web_origins: str
    admin_origins: str
    admin_public_url: str
    cookie_secure: bool
    require_secure_websocket: bool
    csrf_enabled: bool

    # ---- уведомления (ТЗ, раздел 2) ----
    app_timezone: str
    notify_remind_24h_enabled: bool
    notify_remind_24h_minutes: int
    notify_remind_1h_enabled: bool
    notify_remind_1h_minutes: int
    notify_overdue_interval_minutes: int
    tasks_upcoming_days: int
    # Пустые значения выключают Web Push; ключи должны быть постоянными.
    web_push_private_key: str
    web_push_public_key: str
    web_push_subject: str

    # ---- блокировка записи от одновременного редактирования (документ «Redis») ----
    edit_lock_ttl_seconds: int
    ws_auth_timeout_seconds: float

    # ---- журналы (пустой APP_LOG_DIR — только stderr) ----
    log_level: str
    app_log_dir: str | None

    # ---- первичная учётная запись администратора (database/initial_data.py) ----
    admin_login: str | None
    admin_password: str | None

    # ------------------------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def timezone(self) -> ZoneInfo:
        return ZoneInfo(self.app_timezone)

    @property
    def access_token_ttl(self) -> timedelta:
        return timedelta(minutes=self.access_token_ttl_minutes)

    @property
    def refresh_token_ttl(self) -> timedelta:
        return timedelta(days=self.refresh_token_ttl_days)

    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url
        password = self.postgres_password or ""
        credentials = quote(self.postgres_user, safe="")
        if password:
            credentials += ":" + quote(password, safe="")
        return f"postgresql+psycopg://{credentials}@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"

    def _redis_url_for_db(self, db: int) -> str:
        if self.redis_url:
            return self.redis_url
        auth = ""
        if self.redis_username or self.redis_password:
            auth = quote(self.redis_username or "", safe="") + ":" + quote(self.redis_password or "", safe="")
            auth += "@"
        return f"redis://{auth}{self.redis_host}:{self.redis_port}/{db}"

    @property
    def redis_connection_url(self) -> str:
        return self._redis_url_for_db(self.redis_db)

    @property
    def celery_broker_url(self) -> str:
        if self.redis_url:
            return self.redis_url
        return self._redis_url_for_db(self.celery_broker_db)

    def origins_for(self, portal: Portal) -> tuple[str, ...]:
        return _split(self.web_origins if portal is Portal.WEB else self.admin_origins)

    @property
    def all_origins(self) -> tuple[str, ...]:
        return self.origins_for(Portal.WEB) + self.origins_for(Portal.ADMIN)

    @property
    def admin_public_origin(self) -> str:
        """Адрес сервиса admin без пути: https://85.95.150.8:5620."""
        parts = urlsplit(self.admin_public_url)
        return f"{parts.scheme}://{parts.netloc}"

    def check_production(self) -> None:
        """В production не запускаться со слабыми ключами или шаблонными значениями Secret."""
        if not self.is_production:
            return
        problems = [
            name.upper()
            for name in ("secret_key", "jwt_secret")
            if len(getattr(self, name)) < 32 or "change" in getattr(self, name).lower()
        ]
        if not self.cookie_secure:
            problems.append("COOKIE_SECURE")
        if not self.require_secure_websocket:
            problems.append("REQUIRE_SECURE_WEBSOCKET")
        if bool(self.web_push_private_key) != bool(self.web_push_public_key):
            problems.append("WEB_PUSH_PRIVATE_KEY / WEB_PUSH_PUBLIC_KEY")
        if problems:
            raise RuntimeError("Небезопасные настройки для production: " + ", ".join(problems))
