"""Ответы REST/JSON-API (Pydantic-схемы) и ошибки предметной области.

Ошибки: сервисы сообщают о нарушении правил исключениями ниже, а обработчик
app/api/exception_handlers.py переводит их в ответ ErrorOut с HTTP-кодом ошибки.
Тексты сообщений предназначены для показа пользователю.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel

from app.models.journal import CheckGroup, JournalRecord
from app.models.notification import Notification
from app.models.organization import Organization
from app.models.references import Option
from app.models.user import User, UserGroup
from app.schemas.short_name import short_name
from app.services.access_control.rights import RIGHT_KEYS, RIGHTS_TREE, format_rules, parse_rules

SYSTEM_ADMIN_FIO = "Администратор системы"


def effective_user_rules(user: User) -> str | None:
    """Системный администратор сохраняет личные права при настройке своей группы."""
    if user.fio == SYSTEM_ADMIN_FIO or user.group.rules is None:
        return user.rules
    return user.group.rules


class IdName(BaseModel):
    id: int
    name: str


class SolutionOut(IdName):
    is_final: bool


class OptionsOut(BaseModel):
    address: str | None = None
    position: str | None = None
    fio: str | None = None

    @classmethod
    def of(cls, item: Option | None) -> OptionsOut:
        return cls(address=item.address, position=item.position, fio=item.fio) if item else cls()


class ExecutorOut(BaseModel):
    id: int
    fio: str
    short_name: str

    @classmethod
    def of(cls, user: User) -> ExecutorOut:
        return cls(id=user.id, fio=user.fio, short_name=short_name(user.fio))


class RightOut(BaseModel):
    key: str
    label: str
    desc: str
    restrictive: bool


class RightGroupOut(BaseModel):
    title: str
    items: list[RightOut]


def rights_tree() -> list[RightGroupOut]:
    return [
        RightGroupOut(
            title=group.title,
            items=[
                RightOut(key=i.key, label=i.label, desc=i.description, restrictive=i.restrictive) for i in group.items
            ],
        )
        for group in RIGHTS_TREE
    ]


def rights_list(rules: str | None) -> list[str]:
    granted = parse_rules(rules)
    return [key for key in RIGHT_KEYS if key in granted]


# ---------------------------------------------------------------------------
# Учётная запись
# ---------------------------------------------------------------------------
class MeOut(BaseModel):
    id: int
    uuid: UUID
    fio: str
    short_name: str
    login: str
    profile: str | None
    group_id: int
    group_name: str
    rights: list[str]
    is_fired: bool
    portal: str
    links: dict[str, str]

    @classmethod
    def of(cls, user: User, *, portal: str, admin_url: str) -> MeOut:
        return cls(
            id=user.id,
            uuid=user.uuid,
            fio=user.fio,
            short_name=short_name(user.fio),
            login=user.login,
            profile=user.profile,
            group_id=user.group_id,
            group_name=user.group.name,
            rights=rights_list(effective_user_rules(user)),
            is_fired=user.is_fired,
            portal=portal,
            links={"admin": admin_url},
        )


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: MeOut


# ---------------------------------------------------------------------------
# Журнал
# ---------------------------------------------------------------------------
class CheckGroupOut(BaseModel):
    id: int
    date: date
    time: str
    type_check_id: int
    type: str
    records: int

    @classmethod
    def of(cls, group: CheckGroup, records: int = 0) -> CheckGroupOut:
        return cls(
            id=group.id,
            date=group.check_date,
            time=group.check_time,
            type_check_id=group.type_check_id,
            type=group.type_check.name,
            records=records,
        )


class JournalRecordOut(BaseModel):
    id: int
    group_id: int
    date: date
    time: str
    type_check_id: int
    type: str
    number: int
    fio: str
    category_id: int | None
    category: str
    organization_id: int
    organization: str
    executor_id: int
    executor: str
    executor_fio: str
    solution_id: int
    status: str
    status_final: bool
    note: str | None
    version: int

    @classmethod
    def of(cls, record: JournalRecord) -> JournalRecordOut:
        return cls(
            id=record.id,
            group_id=record.group_id,
            date=record.group.check_date,
            time=record.group.check_time,
            type_check_id=record.group.type_check_id,
            type=record.group.type_check.name,
            number=record.number,
            fio=record.fio,
            category_id=record.category_id,
            category=record.category_name or (record.category.name if record.category else ""),
            organization_id=record.organization_id,
            organization=record.organization.name,
            executor_id=record.executor_id,
            executor=short_name(record.executor.fio),
            executor_fio=record.executor.fio,
            solution_id=record.solution_id,
            status=record.solution.name,
            status_final=record.solution.is_final,
            note=record.note,
            version=record.version,
        )


class LockOut(BaseModel):
    locked: bool
    ttl_seconds: int
    available: bool


# ---------------------------------------------------------------------------
# Справочники
# ---------------------------------------------------------------------------
class OrganizationOut(BaseModel):
    id: int
    name: str
    address: str
    phone: str
    contact: str
    email: str
    note: str

    @classmethod
    def of(cls, org: Organization) -> OrganizationOut:
        return cls(
            id=org.id,
            name=org.name,
            address=org.address or "",
            phone=org.phone or "",
            contact=org.contact or "",
            email=org.email or "",
            note=org.note or "",
        )


class ReferencesOut(BaseModel):
    categories: list[IdName]
    type_checks: list[IdName]
    solutions: list[SolutionOut]
    executors: list[ExecutorOut]
    rights_tree: list[RightGroupOut]


# ---------------------------------------------------------------------------
# Пользователи
# ---------------------------------------------------------------------------
class UserOut(BaseModel):
    id: int
    fio: str
    short_name: str
    login: str
    profile: str
    group_id: int
    group_name: str
    is_fired: bool
    rights: list[str]
    failed_login_attempts: int
    locked_until: datetime | None
    is_locked: bool  # блокировка действует — по часам сервера

    @classmethod
    def of(cls, user: User, *, is_locked: bool) -> UserOut:
        return cls(
            id=user.id,
            fio=user.fio,
            short_name=short_name(user.fio),
            login=user.login,
            profile=user.profile or "",
            group_id=user.group_id,
            group_name=user.group.name,
            is_fired=user.is_fired,
            rights=rights_list(effective_user_rules(user)),
            failed_login_attempts=user.failed_login_attempts,
            locked_until=user.locked_until,
            is_locked=is_locked,
        )


class UserGroupOut(BaseModel):
    id: int
    name: str
    is_archive: bool
    members: int
    rights: list[str]
    rights_configured: bool

    @classmethod
    def of(cls, group: UserGroup, members: int = 0, *, preview: frozenset[str] | None = None) -> UserGroupOut:
        return cls(
            id=group.id, name=group.name, is_archive=group.is_archive, members=members,
            rights=rights_list(group.rules) if group.rules is not None else rights_list(format_rules(preview or ())),
            rights_configured=group.rules is not None,
        )


# ---------------------------------------------------------------------------
# Уведомления
# ---------------------------------------------------------------------------
class NotificationOut(BaseModel):
    version: int
    id: int
    kind: str
    title: str
    body: str
    icon: str
    url: str
    actions: list[dict[str, str]]
    journal_id: int
    fio: str
    date: date
    time: str
    check_type: str
    fire_at: datetime
    shown_at: datetime | None

    @classmethod
    def of(cls, notification: Notification) -> NotificationOut:
        from app.services.reminders.manifest import notification_payload

        return cls(**notification_payload(notification))


class SubscriptionOut(BaseModel):
    permission: str
    updated_at: datetime


# ---------------------------------------------------------------------------
# Ошибки
# ---------------------------------------------------------------------------
class ErrorOut(BaseModel):
    """Тело ответа с ошибкой: текст для пользователя, код ошибки и ошибки полей формы."""

    detail: str
    code: str
    errors: dict[str, Any] = {}


class DomainError(Exception):
    status_code = 400
    code = "error"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class ValidationFailed(DomainError):
    status_code = 422
    code = "validation_error"


class CsrfFailed(DomainError):
    status_code = 403
    code = "csrf_failed"


class AuthenticationFailed(DomainError):
    status_code = 401
    code = "unauthorized"


class AccountLocked(DomainError):
    status_code = 423
    code = "account_locked"


class TooManyAttempts(DomainError):
    status_code = 429
    code = "too_many_attempts"


class PermissionDenied(DomainError):
    status_code = 403
    code = "forbidden"


class NotFound(DomainError):
    status_code = 404
    code = "not_found"


class Conflict(DomainError):
    status_code = 409
    code = "conflict"


class EditLocked(DomainError):
    status_code = 423
    code = "record_locked"
