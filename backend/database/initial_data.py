from __future__ import annotations

import logging
import sys
from collections.abc import Iterable
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.references import Category, Solution, TypeCheck
from app.models.user import User, UserGroup
from app.schemas.settings import Settings
from app.services.access_control.principal import ADMIN_GROUP_NAME, SYSTEM_ADMIN_FIO
from app.services.access_control.rights import FULL_RIGHTS, format_rules
from core.clock import SystemClock, truncate_to_ms
from core.config import get_settings
from core.logging import configure_logging
from core.security.passwords import Argon2PasswordHasher
from database.session import Database, create_database_app

logger = logging.getLogger("omsa.initial_data")

CATEGORIES = tuple(f"Категория {number}" for number in range(1, 9))
TYPE_CHECKS = ("ПФО", "Физо", "ЗУН")
SOLUTIONS = (("Готов", True), ("В процессе", False))
STARTUP_USER_GROUPS = (
    (ADMIN_GROUP_NAME, False),
    ("Архив (уволенные)", True),
)
ADVISORY_LOCK_ID = 7_310_001


class InitialDataSeeder:
    def __init__(self, session: Session) -> None:
        self.session = session

    def _add_missing(self, model: type, rows: Iterable[dict[str, object]]) -> None:
        existing = set(self.session.scalars(select(model.name)))
        for row in rows:
            name = str(row["name"])
            if name not in existing:
                self.session.add(model(**row))
                existing.add(name)

    def seed_references(
        self,
        *,
        user_groups: tuple[tuple[str, bool], ...] = STARTUP_USER_GROUPS,
    ) -> None:
        self._add_missing(Category, ({"name": name} for name in CATEGORIES))
        self._add_missing(TypeCheck, ({"name": name} for name in TYPE_CHECKS))
        self._add_missing(Solution, ({"name": name, "is_final": is_final} for name, is_final in SOLUTIONS))
        self._add_missing(UserGroup, ({"name": name, "is_archive": is_archive} for name, is_archive in user_groups))
        self.session.flush()

    def ensure_admin(self, settings: Settings, hasher: Argon2PasswordHasher) -> bool:
        if not settings.admin_login or not settings.admin_password:
            return False
        login = settings.admin_login.strip().lower()
        if self.session.scalar(select(User).where(User.login == login)) is not None:
            return False
        group = self.session.scalar(select(UserGroup).where(UserGroup.name == ADMIN_GROUP_NAME))
        if group is None:
            raise RuntimeError(f"Не найдена группа «{ADMIN_GROUP_NAME}»")
        self.session.add(
            User(
                uuid=uuid4(),
                fio=SYSTEM_ADMIN_FIO,
                login=login,
                password_hash=hasher.hash(settings.admin_password),
                password_changed_at=truncate_to_ms(SystemClock().now()),
                rules=format_rules(FULL_RIGHTS),
                group=group,
                failed_login_attempts=0,
            )
        )
        self.session.flush()
        return True


def seed_reference_data(
    session: Session,
    *,
    user_groups: tuple[tuple[str, bool], ...] = STARTUP_USER_GROUPS,
) -> None:
    InitialDataSeeder(session).seed_references(user_groups=user_groups)


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
        seeder = InitialDataSeeder(session)
        seeder.seed_references()
        created = seeder.ensure_admin(settings, hasher)
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
