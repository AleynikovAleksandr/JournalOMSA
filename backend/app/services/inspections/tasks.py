"""Раздел «Мои задачи»: задачи текущего исполнителя (ТЗ, 5.2)."""

from __future__ import annotations

from datetime import timedelta

from app.interfaces.repositories import UnitOfWork
from app.models.journal import JournalRecord
from app.schemas.commands import JournalFilter
from app.services.access_control.principal import Principal
from app.services.inspections.records import JournalService
from app.services.reminders.scheduler import NotificationScheduler
from core.clock import Clock


class TaskService:
    def __init__(
        self,
        uow: UnitOfWork,
        principal: Principal,
        *,
        journal: JournalService,
        scheduler: NotificationScheduler,
        clock: Clock,
        upcoming_window: timedelta,
    ) -> None:
        self._uow = uow
        self._principal = principal
        self._journal = journal
        self._scheduler = scheduler
        self._clock = clock
        self._upcoming_window = upcoming_window

    def _mine(self, *, completed: bool) -> list[JournalRecord]:
        return self._uow.journal.list(JournalFilter(executor_id=self._principal.user_id, completed=completed))

    def my(self, *, completed: bool = False) -> list[JournalRecord]:
        return self._mine(completed=completed)

    def upcoming(self) -> list[JournalRecord]:
        """Ближайшие предстоящие задачи (для планирования уведомлений)."""
        now = self._clock.now()
        horizon = now + self._upcoming_window
        return [record for record in self._mine(completed=False) if now < self._scheduler.moment(record) <= horizon]

    def due(self) -> list[JournalRecord]:
        """Наступившие по времени незавершённые задачи."""
        now = self._clock.now()
        return [record for record in self._mine(completed=False) if self._scheduler.moment(record) <= now]

    def complete(self, record_id: int) -> JournalRecord:
        return self._journal.complete(record_id)
