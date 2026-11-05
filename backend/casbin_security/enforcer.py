"""Проверка прав по модели и политикам Casbin (casbin_security/config)."""

from __future__ import annotations

import logging
from collections.abc import Iterable
from pathlib import Path

import casbin

CONFIG_DIR = Path(__file__).resolve().parent / "config"

# Casbin пишет каждую отрицательную проверку права на уровне WARNING, а политику при
# загрузке — на уровне INFO. Отказ в праве — штатная ситуация, поэтому только ошибки.
logging.getLogger("casbin").setLevel(logging.ERROR)


class CasbinAccessControl:
    def __init__(self, model_path: Path | None = None, policy_path: Path | None = None) -> None:
        self._enforcer = casbin.Enforcer(
            str(model_path or CONFIG_DIR / "model.conf"),
            str(policy_path or CONFIG_DIR / "policy.csv"),
        )

    def allows(self, subjects: Iterable[str], obj: str, act: str) -> bool:
        """Разрешено, если действие разрешено хотя бы одному из субъектов (роли или права)."""
        return any(self._enforcer.enforce(subject, obj, act) for subject in subjects)
