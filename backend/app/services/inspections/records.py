"""Журнал проверок: записи (задачи исполнителей)."""

from __future__ import annotations

from dataclasses import replace

from sqlalchemy.orm.exc import StaleDataError

from app.interfaces.repositories import UnitOfWork
from app.models.journal import CheckGroup, JournalRecord
from app.models.organization import Organization
from app.models.references import Category, Solution, TypeCheck
from app.models.user import User
from app.schemas.commands import JournalFilter, JournalRecordInput
from app.schemas.responses import Conflict, NotFound, PermissionDenied, ValidationFailed
from app.services.access_control.access import AccessPolicy, JournalRules
from app.services.access_control.principal import Principal
from app.services.inspections.edit_locks import JournalEditLocks
from app.services.reminders.scheduler import NotificationScheduler
from core.interprocess.locks import LockResult

NO_RIGHTS = "Недостаточно прав для этого действия"
STALE = "Запись изменена другим пользователем. Обновите карточку"


class JournalService:
    def __init__(
        self,
        uow: UnitOfWork,
        principal: Principal,
        *,
        policy: AccessPolicy,
        scheduler: NotificationScheduler,
        locks: JournalEditLocks,
    ) -> None:
        self._uow = uow
        self._principal = principal
        self._policy = policy
        self._rules = JournalRules(policy, principal)
        self._scheduler = scheduler
        self._locks = locks

    @property
    def rules(self) -> JournalRules:
        return self._rules

    # ------------------------------------------------------------------
    # Чтение
    # ------------------------------------------------------------------
    def list(self, flt: JournalFilter) -> list[JournalRecord]:
        if self._principal.is_fired or flt.my:
            # Уволенному доступны только его собственные задачи
            flt = replace(flt, executor_id=self._principal.user_id)
        return self._uow.journal.list(flt)

    def get(self, record_id: int) -> JournalRecord:
        record = self._uow.journal.get(record_id)
        if record is None or not self._rules.can_view(record):
            raise NotFound("Запись журнала не найдена")
        return record

    # ------------------------------------------------------------------
    # Справочные значения записи
    # ------------------------------------------------------------------
    def _resolve_name(self, name: str | None, rows, *, label: str):
        normalized = (name or "").strip()
        if not normalized:
            return None
        if len(normalized) > 150:
            raise ValidationFailed(f"{label}: не более 150 символов")
        folded = normalized.casefold()
        return next((item for item in rows if item.name.strip().casefold() == folded), None)

    def _type_check(self, type_check_id: int | None, name: str | None) -> TypeCheck:
        match = self._resolve_name(name, self._uow.references.type_checks(), label="Вид проверки")
        if match is not None:
            return match
        if name and name.strip():
            self._policy.require(self._principal, "references", "manage", "Нет права добавлять виды проверок")
            item = TypeCheck(name=name.strip())
            self._uow.references.add_type_check(item)
            self._uow.flush()
            return item
        item = self._uow.references.type_check(type_check_id) if type_check_id is not None else None
        if item is None:
            raise ValidationFailed("Вид проверки не найден", details={"type_check_id": ["Укажите значение"]})
        return item

    def _category(self, category_id: int | None, name: str | None) -> tuple[Category | None, str | None]:
        normalized = (name or "").strip()
        if normalized:
            if len(normalized) > 100:
                raise ValidationFailed("Категория: не более 100 символов")
            match = self._resolve_name(normalized, self._uow.references.categories(), label="Категория")
            if match is not None:
                return match, None
            return None, normalized
        item = self._uow.references.category(category_id) if category_id is not None else None
        if item is None:
            raise ValidationFailed("Категория не найдена", details={"category_id": ["Укажите значение"]})
        return item, None

    def _solution(self, solution_id: int | None, name: str | None = None) -> Solution:
        match = self._resolve_name(name, self._uow.references.solutions(), label="Статус")
        if match is not None:
            return match
        if name and name.strip():
            self._policy.require(self._principal, "references", "manage", "Нет права добавлять статусы")
            item = Solution(name=name.strip(), is_final=False)
            self._uow.references.add_solution(item)
            self._uow.flush()
            return item
        item = (
            self._uow.references.solution(solution_id)
            if solution_id is not None
            else self._uow.references.default_solution()
        )
        if item is None:
            raise ValidationFailed("Статус не найден", details={"solution_id": ["Укажите значение"]})
        return item

    def _executor(self, executor_id: int, *, current_id: int | None = None) -> User:
        executor = self._uow.users.get(executor_id)
        if executor is None:
            raise ValidationFailed("Исполнитель не найден", details={"executor_id": ["Неизвестное значение"]})
        if executor.is_fired and executor_id != current_id:
            raise ValidationFailed(
                "Нельзя назначить задачу уволенному сотруднику", details={"executor_id": ["Сотрудник уволен"]}
            )
        return executor

    def _references(self, data: JournalRecordInput) -> tuple[Category | None, str | None, Organization, TypeCheck]:
        category, category_name = self._category(data.category_id, data.category_name)
        organization = self._uow.organizations.get(data.organization_id)
        if organization is None:
            raise ValidationFailed("Организация не найдена", details={"organization_id": ["Неизвестное значение"]})
        type_check = self._type_check(data.type_check_id, data.type_check_name)
        return category, category_name, organization, type_check

    def _resolve_group(self, data: JournalRecordInput, hint_group_id: int | None, type_check_id: int) -> CheckGroup:
        """Группа записи определяется датой, временем и видом проверки.

        Если подходящей группы нет, она создаётся — при наличии права «Добавление» (grpAdd).
        """
        key = (data.check_date, data.check_time, type_check_id)
        for group_id in (data.group_id, hint_group_id):
            if group_id is None:
                continue
            group = self._uow.groups.get(group_id)
            if group is not None and (group.check_date, group.check_time, group.type_check_id) == key:
                return group
        group = self._uow.groups.find(*key)
        if group is not None:
            return group
        if not self._policy.allows(self._principal, "groups", "create"):
            raise PermissionDenied("Нет проверочной группы с такими датой, временем и видом проверки")
        group = CheckGroup(
            check_date=data.check_date,
            check_time=data.check_time,
            type_check=self._uow.references.type_check(type_check_id),
        )
        self._uow.groups.add(group)
        self._uow.flush()
        return group

    # ------------------------------------------------------------------
    # Изменение
    # ------------------------------------------------------------------
    def create(self, data: JournalRecordInput) -> JournalRecord:
        if not self._rules.can_create(data.executor_id):
            raise PermissionDenied(NO_RIGHTS)
        category, category_name, organization, type_check = self._references(data)
        executor = self._executor(data.executor_id)
        solution = self._solution(data.solution_id, data.solution_name)
        group = self._resolve_group(data, None, type_check.id)
        record = JournalRecord(
            group=group,
            number=self._uow.journal.next_number(group.id),
            fio=data.fio.strip(),
            category=category,
            category_name=category_name,
            organization=organization,
            executor=executor,
            solution=solution,
            note=(data.note or "").strip() or None,
        )
        self._uow.journal.add(record)
        self._uow.flush()
        if not solution.is_final:
            self._scheduler.task_assigned(record)
        self._uow.commit()
        return record

    def update(self, record_id: int, data: JournalRecordInput) -> JournalRecord:
        record = self.get(record_id)
        if not self._rules.can_edit_fields(record):
            raise PermissionDenied(NO_RIGHTS)
        self._locks.ensure_not_locked_by_other(record.id)
        if data.version is not None and data.version != record.version:
            raise Conflict(STALE)
        if data.executor_id != record.executor_id and not self._rules.can_reassign(record, data.executor_id):
            raise PermissionDenied("Нельзя передать задачу другому исполнителю")
        category, category_name, organization, type_check = self._references(data)
        executor = self._executor(data.executor_id, current_id=record.executor_id)
        solution = self._solution(data.solution_id if data.solution_name is None else None, data.solution_name)
        group = self._resolve_group(data, record.group_id, type_check.id)

        previous_executor = record.executor
        was_active = not record.solution.is_final
        rescheduled = group.id != record.group_id and (
            group.check_date,
            group.check_time,
            group.type_check_id,
        ) != (record.group.check_date, record.group.check_time, record.group.type_check_id)

        if group.id != record.group_id:
            # Номер считается до переноса: иначе автосброс сессии учёл бы саму запись
            number = self._uow.journal.next_number(group.id)
            record.group = group
            record.number = number
        record.fio = data.fio.strip()
        record.category = category
        record.category_name = category_name
        record.organization = organization
        record.executor = executor
        record.solution = solution
        record.note = (data.note or "").strip() or None
        self._flush()
        self._notify_changes(record, previous_executor, was_active=was_active, rescheduled=rescheduled)
        self._uow.commit()
        return record

    def update_status(
        self,
        record_id: int,
        solution_id: int | None = None,
        *,
        solution_name: str | None = None,
        version: int | None = None,
    ) -> JournalRecord:
        record = self.get(record_id)
        if not self._rules.can_change_status(record):
            raise PermissionDenied(NO_RIGHTS)
        self._locks.ensure_not_locked_by_other(record.id)
        if version is not None and version != record.version:
            raise Conflict(STALE)
        solution = self._solution(solution_id, solution_name)
        was_active = not record.solution.is_final
        record.solution = solution
        self._flush()
        self._notify_changes(record, record.executor, was_active=was_active, rescheduled=False)
        self._uow.commit()
        return record

    def complete(self, record_id: int) -> JournalRecord:
        """Отметка задачи как завершённой — единственное действие, прекращающее уведомления."""
        final = self._uow.references.final_solution()
        if final is None:
            raise Conflict("В справочнике статусов нет завершающего статуса")
        return self.update_status(record_id, final.id)

    def update_note(self, record_id: int, note: str | None, *, version: int | None = None) -> JournalRecord:
        record = self.get(record_id)
        if not self._rules.can_edit_fields(record):
            raise PermissionDenied(NO_RIGHTS)
        self._locks.ensure_not_locked_by_other(record.id)
        if version is not None and version != record.version:
            raise Conflict(STALE)
        record.note = (note or "").strip() or None
        self._flush()
        self._uow.commit()
        return record

    def delete(self, record_id: int) -> None:
        record = self.get(record_id)
        if not self._rules.can_delete(record):
            raise PermissionDenied(NO_RIGHTS)
        self._locks.ensure_not_locked_by_other(record.id)
        self._uow.journal.delete(record)
        self._uow.commit()

    def _flush(self) -> None:
        try:
            self._uow.flush()
        except StaleDataError as exc:
            raise Conflict(STALE) from exc

    def _notify_changes(
        self, record: JournalRecord, previous_executor: User, *, was_active: bool, rescheduled: bool
    ) -> None:
        is_active = not record.solution.is_final
        reassigned = previous_executor.id != record.executor.id
        if reassigned:
            # Уведомления прекращаются у прежнего исполнителя и начинаются у нового
            if was_active:
                self._scheduler.task_stopped(record, user_uuid=previous_executor.uuid)
            if is_active:
                self._scheduler.task_assigned(record)
            return
        if was_active and not is_active:
            self._scheduler.task_stopped(record)
        elif not was_active and is_active:
            self._scheduler.task_resumed(record)
        elif is_active and rescheduled:
            self._scheduler.task_rescheduled(record)

    # ------------------------------------------------------------------
    # Блокировка карточки
    # ------------------------------------------------------------------
    def lock(self, record_id: int) -> LockResult:
        record = self.get(record_id)
        if not (self._rules.can_edit_fields(record) or self._rules.can_change_status(record)):
            raise PermissionDenied(NO_RIGHTS)
        return self._locks.acquire(record.id)

    def unlock(self, record_id: int) -> None:
        self._locks.release(record_id)
