"""Загрузка настроек OMSA Ledger из переменных окружения.

Схема параметров и проверка их типов — app/schemas/settings.py.
"""

from __future__ import annotations

from functools import lru_cache

from app.schemas.settings import Settings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Настройки процесса: читаются из окружения один раз, при ошибке типа — исключение."""
    return Settings()  # type: ignore[call-arg]  # все поля приходят из окружения
