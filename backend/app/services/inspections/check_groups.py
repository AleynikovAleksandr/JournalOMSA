"""Проверочные группы (блоки): дата, время, вид проверки."""

from __future__ import annotations

from app.interfaces.repositories import UnitOfWork
from app.models.journal import CheckGroup
from app.models.references import TypeCheck
from app.schemas.commands import CheckGroupInput
from app.schemas.responses import NotFound, ValidationFailed
from app.services.access_control.access import AccessPolicy
from app.services.access_control.principal import Principal
from app.services.inspections.records import NO_RIGHTS
from app.services.reminders.scheduler import NotificationScheduler


class CheckGroupService:
    """Проверочные группы (блоки): дата, время, вид проверки."""

    def __init__(
        self, uow: UnitOfWork, principal: Principal, policy: AccessPolicy, scheduler: NotificationScheduler
    ) -> None:
        self._uow = uow
        self._principal = principal
        self._policy = policy
        self._scheduler = scheduler

    def list(self, *, date_from=None, date_to=None) -> list[tuple[CheckGroup, int]]:
        return self._uow.groups.list(date_from=date_from, date_to=date_to)

    def get(self, group_id: int) -> CheckGroup:
        group = self._uow.groups.get(group_id)
        if group is None:
            raise NotFound("Проверочная группа не найдена")
        return group

    def _type_check(self, type_check_id: int | None, name: str | None) -> TypeCheck:
        normalized = (name or "").strip()
        items = self._uow.references.type_checks()
        if normalized:
            existing = next((item for item in items if item.name.strip().casefold() == normalized.casefold()), None)
            if existing is not None:
                return existing
            self._policy.require(self._principal, "references", "manage", "Нет права добавлять виды проверок")
            item = TypeCheck(name=normalized)
            self._uow.references.add_type_check(item)
            self._uow.flush()
            return item
        type_check = self._uow.references.type_check(type_check_id) if type_check_id is not None else None
        if type_check is None:
            raise ValidationFailed("Вид проверки не найден", details={"type_check_id": ["Укажите значение"]})
        return type_check

    def create(self, data: CheckGroupInput) -> CheckGroup:
        self._policy.require(self._principal, "groups", "create", NO_RIGHTS)
        group = CheckGroup(
            check_date=data.check_date,
            check_time=data.check_time,
            type_check=self._type_check(data.type_check_id, data.type_check_name),
        )
        self._uow.groups.add(group)
        self._uow.commit()
        return group

    def update(self, group_id: int, data: CheckGroupInput) -> CheckGroup:
        self._policy.require(self._principal, "groups", "update", NO_RIGHTS)
        group = self.get(group_id)
        type_check = self._type_check(data.type_check_id, data.type_check_name)
        changed = (group.check_date, group.check_time, group.type_check_id) != (
            data.check_date,
            data.check_time,
            data.type_check_id,
        )
        group.check_date = data.check_date
        group.check_time = data.check_time
        group.type_check = type_check
        self._uow.flush()
        if changed:
            # Событие 6 «Задача изменена» для каждой незавершённой задачи группы
            for record in self._uow.journal.in_group(group.id):
                if not record.solution.is_final:
                    self._scheduler.task_rescheduled(record)
        self._uow.commit()
        return group

    def delete(self, group_id: int) -> None:
        """Удаление группы целиком — вместе с её записями и их уведомлениями."""
        self._policy.require(self._principal, "groups", "delete", NO_RIGHTS)
        group = self.get(group_id)
        for record in self._uow.journal.in_group(group.id):
            self._uow.journal.delete(record)
        self._uow.groups.delete(group)
        self._uow.commit()
