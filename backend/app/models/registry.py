"""Все модели данных (ORM).

Имена таблиц и столбцов соответствуют исходной схеме ТЗ (раздел 6.1),
дополненной полями авторизации, прав и уведомлений (раздел 6.2).
Импорт модуля регистрирует все таблицы в метаданных Base.
"""

from app.models.auth import RefreshToken
from app.models.journal import CheckGroup, JournalRecord
from app.models.notification import (
    Notification,
    NotificationKind,
    NotificationSubscription,
    PushDelivery,
    PushSubscription,
)
from app.models.organization import Organization
from app.models.references import Category, Option, Solution, TypeCheck
from app.models.user import User, UserGroup

ALL_MODELS = (
    Category,
    CheckGroup,
    JournalRecord,
    Notification,
    NotificationSubscription,
    PushDelivery,
    PushSubscription,
    Option,
    Organization,
    RefreshToken,
    Solution,
    TypeCheck,
    User,
    UserGroup,
)

__all__ = ["ALL_MODELS", "NotificationKind"]
