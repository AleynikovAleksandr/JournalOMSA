"""Единица работы: одна сессия базы данных и репозитории над ней.

Сервисы фиксируют изменения вызовом commit(). Действия, которые должны
выполняться только после успешной фиксации (например, команда
WebSocket-клиентам), регистрируются через after_commit().
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.repositories.auth.refresh_tokens import RefreshTokenRepository
from app.repositories.journal.check_groups import CheckGroupRepository
from app.repositories.journal.records import JournalRepository
from app.repositories.notifications.notifications import NotificationRepository
from app.repositories.notifications.push import PushRepository
from app.repositories.notifications.subscriptions import SubscriptionRepository
from app.repositories.references.organizations import OrganizationRepository
from app.repositories.references.references import ReferenceRepository
from app.repositories.users.user_groups import UserGroupRepository
from app.repositories.users.users import UserRepository

logger = logging.getLogger(__name__)


class SqlUnitOfWork:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.users = UserRepository(session)
        self.user_groups = UserGroupRepository(session)
        self.references = ReferenceRepository(session)
        self.organizations = OrganizationRepository(session)
        self.groups = CheckGroupRepository(session)
        self.journal = JournalRepository(session)
        self.refresh_tokens = RefreshTokenRepository(session)
        self.notifications = NotificationRepository(session)
        self.subscriptions = SubscriptionRepository(session)
        self.push = PushRepository(session)
        self._after_commit: list[Callable[[], None]] = []

    def after_commit(self, callback: Callable[[], None]) -> None:
        self._after_commit.append(callback)

    def flush(self) -> None:
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()
        callbacks, self._after_commit = self._after_commit, []
        for callback in callbacks:
            try:
                callback()
            except Exception:
                logger.exception("Ошибка в действии после фиксации транзакции")

    def rollback(self) -> None:
        self._after_commit.clear()
        self.session.rollback()

    def close(self) -> None:
        self.session.close()
