"""Инициализация данных: справочники (ТЗ, раздел 11) и первичная учётная запись администратора.

Запуск: python -m database.initial_data (рабочий каталог — backend/).

Скрипт идемпотентен: существующие значения не дублируются, поэтому его можно
выполнять при каждом развёртывании (init-контейнер пода web в Kubernetes).
Таблицы, которых нет в базе, создаются по моделям; в PostgreSQL схему при первом
запуске создаёт database/schema.sql, поэтому этот шаг ничего не меняет.
"""

from __future__ import annotations

import logging
import sys
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.references import Category, Solution, TypeCheck
from app.models.user import User, UserGroup
from app.schemas.settings import Settings
from app.services.access_control.rights import FULL_RIGHTS, format_rules
from core.clock import SystemClock, truncate_to_ms
from core.config import get_settings
from core.logging import configure_logging
from core.security.passwords import Argon2PasswordHasher
from database.session import Database, create_database_app

logger = logging.getLogger("omsa.initial_data")

CATEGORIES = ("Оперативный персонал", "Ремонтный персонал", "Диспетчер")
TYPE_CHECKS = ("ПФО", "Физо", "ЗУН")
# (наименование, завершает задачу)
SOLUTIONS = (("Готов", True), ("В процессе", False))
# (наименование, группа архива)
USER_GROUPS = (
    ("Администраторы", False),
    ("Аттестационная комиссия", False),
    ("Инспекторы", False),
    ("Архив (уволенные)", True),
)
ADMIN_GROUP = USER_GROUPS[0][0]
ADMIN_FIO = "Администратор системы"

# Номер блокировки PostgreSQL: init-контейнеры нескольких подов не выполняют скрипт одновременно
ADVISORY_LOCK_ID = 7_310_001


def _ensure_names(session: Session, model, names) -> None:
    existing = set(session.scalars(select(model.name)))
    for name in names:
        if name not in existing:
            session.add(model(name=name))


def seed_reference_data(session: Session) -> None:
    _ensure_names(session, Category, CATEGORIES)
    _ensure_names(session, TypeCheck, TYPE_CHECKS)
    existing_solutions = set(session.scalars(select(Solution.name)))
    for name, is_final in SOLUTIONS:
        if name not in existing_solutions:
            session.add(Solution(name=name, is_final=is_final))
    existing_groups = set(session.scalars(select(UserGroup.name)))
    for name, is_archive in USER_GROUPS:
        if name not in existing_groups:
            session.add(UserGroup(name=name, is_archive=is_archive))
    session.flush()


def ensure_admin(session: Session, settings: Settings, hasher: Argon2PasswordHasher) -> bool:
    """Создаёт администратора из ADMIN_LOGIN / ADMIN_PASSWORD, если такого логина ещё нет."""
    if not settings.admin_login or not settings.admin_password:
        return False
    login = settings.admin_login.strip().lower()
    if session.scalar(select(User).where(User.login == login)) is not None:
        return False
    group = session.scalar(select(UserGroup).where(UserGroup.name == ADMIN_GROUP))
    if group is None:
        raise RuntimeError(f"Не найдена группа «{ADMIN_GROUP}»")
    session.add(
        User(
            uuid=uuid4(),
            fio=ADMIN_FIO,
            login=login,
            password_hash=hasher.hash(settings.admin_password),
            password_changed_at=truncate_to_ms(SystemClock().now()),
            rules=format_rules(FULL_RIGHTS),
            group=group,
            failed_login_attempts=0,
        )
    )
    session.flush()
    return True


def run(settings: Settings) -> None:
    database = Database.from_flask_app(create_database_app(settings))
    database.create_all()
    hasher = Argon2PasswordHasher(
        time_cost=settings.argon2_time_cost,
        memory_kib=settings.argon2_memory_kib,
        parallelism=settings.argon2_parallelism,
    )
    with database.session() as session:
        if database.dialect == "postgresql":
            session.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": ADVISORY_LOCK_ID})
        seed_reference_data(session)
        created = ensure_admin(session, settings, hasher)
        session.commit()
    logger.info("Справочники заполнены%s", ", создан администратор" if created else "")
    database.engine.dispose()


def main() -> int:
    settings = get_settings()
    configure_logging(settings.log_level, settings.app_log_dir)
    run(settings)
    return 0


if __name__ == "__main__":
    sys.exit(main())
