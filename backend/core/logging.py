"""Настройка журналирования приложения.

Журналы доступа и ошибок Gunicorn пишет сам (gunicorn.conf.py); здесь
настраиваются сообщения приложения: вывод в stderr и, если задан
APP_LOG_DIR, в файл app.log.
"""

from __future__ import annotations

import logging
import logging.config
from pathlib import Path

_configured = False

FORMAT = "%(asctime)s %(levelname)s [%(process)d] %(name)s: %(message)s"


def configure_logging(level: str = "INFO", log_dir: str | None = None) -> None:
    global _configured  # настройка выполняется один раз на процесс
    if _configured:
        return
    handlers: dict[str, dict[str, object]] = {
        "console": {"class": "logging.StreamHandler", "formatter": "default"},
    }
    if log_dir:
        Path(log_dir).mkdir(parents=True, exist_ok=True)
        handlers["file"] = {
            "class": "logging.handlers.WatchedFileHandler",
            "formatter": "default",
            "filename": str(Path(log_dir) / "app.log"),
            "encoding": "utf-8",
        }
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {"default": {"format": FORMAT}},
            "handlers": handlers,
            "root": {"level": level.upper(), "handlers": list(handlers)},
            # Casbin пишет загрузку политики (INFO) и каждый отказ в праве (WARNING)
            "loggers": {"casbin": {"level": "ERROR"}},
        }
    )
    _configured = True
