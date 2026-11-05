"""Уведомления о задачах (ТЗ, раздел 2).

Уведомления формируются на стороне сервера и хранятся в TNotifications.
Период уведомлений — от создания (назначения) задачи до присвоения ей
завершающего статуса. Наступление времени проверки — лишь одна из
контрольных точек этого периода.

* При создании, назначении или изменении задачи NotificationScheduler сразу
  записывает уведомление о событии и рассчитанные заранее напоминания
  (за сутки, за час, наступление времени), каждое со своим моментом показа.
* При завершении, удалении или переназначении задачи непоказанные
  уведомления удаляются.
* Повторные напоминания о незавершённой задаче досоздаёт периодическая задача
  Celery (generate_overdue) раз в минуту; вставка без перезаписи и ограничение
  уникальности делают её идемпотентной.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from app.interfaces.repositories import UnitOfWork
from app.models.journal import JournalRecord
from app.models.notification import NotificationKind
from app.repositories.notifications.notifications import PlannedNotification
from app.schemas.settings import Settings
from core.clock import Clock
from core.interprocess.events import EventPublisher, RealtimeEvent, RealtimeEventType

logger = logging.getLogger(__name__)

# Напоминания, привязанные ко времени проверки: пересчитываются при изменении задачи
TIMED_KINDS = (
    NotificationKind.REMIND_24H,
    NotificationKind.REMIND_1H,
    NotificationKind.DUE,
    NotificationKind.OVERDUE,
)


@dataclass(frozen=True, slots=True)
class NotificationConfig:
    """Параметры конфигурации (ТЗ, примечания к таблице п. 2.2).

    События 2 и 3 отключаются администратором на уровне конфигурации,
    пользователь отключить уведомления не может.
    """

    timezone: ZoneInfo
    remind_24h_enabled: bool = True
    remind_24h_before: timedelta = timedelta(hours=24)
    remind_1h_enabled: bool = True
    remind_1h_before: timedelta = timedelta(hours=1)
    overdue_interval: timedelta = timedelta(hours=1)

    @classmethod
    def from_settings(cls, settings: Settings) -> NotificationConfig:
        return cls(
            timezone=settings.timezone,
            remind_24h_enabled=settings.notify_remind_24h_enabled,
            remind_24h_before=timedelta(minutes=settings.notify_remind_24h_minutes),
            remind_1h_enabled=settings.notify_remind_1h_enabled,
            remind_1h_before=timedelta(minutes=settings.notify_remind_1h_minutes),
            overdue_interval=timedelta(minutes=max(1, settings.notify_overdue_interval_minutes)),
        )


def task_moment(check_date: date, check_time: str, tz: ZoneInfo) -> datetime:
    """Дата и время проверки (местное время приложения) в UTC."""
    hours, minutes = (int(part) for part in check_time.split(":", 1))
    return datetime.combine(check_date, time(hours, minutes), tzinfo=tz).astimezone(UTC)


class NotificationScheduler:
    def __init__(self, uow: UnitOfWork, config: NotificationConfig, clock: Clock, publisher: EventPublisher) -> None:
        self._uow = uow
        self._config = config
        self._clock = clock
        self._publisher = publisher

    def moment(self, record: JournalRecord) -> datetime:
        return task_moment(record.group.check_date, record.group.check_time, self._config.timezone)

    def _now(self) -> datetime:
        return self._clock.now().replace(microsecond=0)

    def _timed(self, record: JournalRecord, user_uuid: UUID, now: datetime) -> list[PlannedNotification]:
        moment = self.moment(record)
        planned: list[PlannedNotification] = []
        if self._config.remind_24h_enabled:
            fire_at = moment - self._config.remind_24h_before
            if fire_at > now:
                planned.append(PlannedNotification(record.id, user_uuid, NotificationKind.REMIND_24H, fire_at))
        if self._config.remind_1h_enabled:
            fire_at = moment - self._config.remind_1h_before
            if fire_at > now:
                planned.append(PlannedNotification(record.id, user_uuid, NotificationKind.REMIND_1H, fire_at))
        if moment > now:
            planned.append(PlannedNotification(record.id, user_uuid, NotificationKind.DUE, moment))
        return planned

    def _save(self, planned: list[PlannedNotification], now: datetime) -> int:
        inserted = self._uow.notifications.insert_ignore(planned, created_at=now)
        if inserted:
            for user_uuid in {item.user_uuid for item in planned}:
                self._uow.after_commit(
                    lambda u=user_uuid: self._publisher.publish(RealtimeEvent(RealtimeEventType.NOTIFY, u))
                )
        return inserted

    # ---- события жизненного цикла задачи ----
    def task_assigned(self, record: JournalRecord) -> None:
        """Событие 1: создание записи или смена исполнителя — уведомления начинаются у исполнителя."""
        now = self._now()
        user_uuid = record.executor.uuid
        planned = [PlannedNotification(record.id, user_uuid, NotificationKind.ASSIGNED, now)]
        self._save(planned + self._timed(record, user_uuid, now), now)

    def task_rescheduled(self, record: JournalRecord) -> None:
        """Событие 6: изменились дата, время или вид проверки."""
        now = self._now()
        user_uuid = record.executor.uuid
        self._uow.notifications.delete_unshown(record.id, user_uuid=user_uuid, kinds=TIMED_KINDS)
        planned = [PlannedNotification(record.id, user_uuid, NotificationKind.CHANGED, now)]
        self._save(planned + self._timed(record, user_uuid, now), now)

    def task_resumed(self, record: JournalRecord) -> None:
        """Задача снова не завершена (статус изменён обратно): напоминания возобновляются."""
        now = self._now()
        self._save(self._timed(record, record.executor.uuid, now), now)

    def task_stopped(self, record: JournalRecord, *, user_uuid: UUID | None = None) -> None:
        """Задача завершена, удалена или переназначена (для прежнего исполнителя)."""
        self._uow.notifications.delete_unshown(record.id, user_uuid=user_uuid)

    # ---- периодическая задача ----
    def generate_overdue(self) -> int:
        """Событие 5: повторные напоминания о незавершённой задаче после наступления её времени.

        Каждое очередное напоминание — самостоятельная запись с моментом показа
        «время проверки + k × интервал». Возвращает число созданных уведомлений.
        """
        now = self._now()
        interval = self._config.overdue_interval
        today = now.astimezone(self._config.timezone).date()
        planned: list[PlannedNotification] = []
        for record in self._uow.journal.active_until(today):
            moment = self.moment(record)
            if now < moment + interval:
                continue
            periods = (now - moment) // interval
            fire_at = moment + periods * interval
            planned.append(PlannedNotification(record.id, record.executor.uuid, NotificationKind.OVERDUE, fire_at))
        inserted = self._save(planned, now)
        if inserted:
            logger.info("Создано повторных напоминаний: %s", inserted)
        return inserted
