"""Зависимости фоновых задач: подключение к базе и публикация событий.

Создаются лениво в каждом процессе Celery — так соединения с базой не
передаются между процессами при fork.
"""

from __future__ import annotations

from functools import cached_property

from app.repositories.unit_of_work import SqlUnitOfWork
from app.schemas.settings import Settings
from app.services.reminders.scheduler import NotificationConfig, NotificationScheduler
from core.clock import Clock, SystemClock
from core.config import get_settings
from core.interprocess.client import create_redis
from core.interprocess.events import EventPublisher, RedisEventPublisher
from database.session import Database, create_database_app


class WorkerRuntime:
    def __init__(
        self,
        settings: Settings,
        *,
        database: Database | None = None,
        publisher: EventPublisher | None = None,
        clock: Clock | None = None,
    ) -> None:
        self.settings = settings
        self._database = database
        self._publisher = publisher
        self.clock = clock or SystemClock()

    @cached_property
    def database(self) -> Database:
        return self._database or Database.from_flask_app(create_database_app(self.settings))

    @cached_property
    def publisher(self) -> EventPublisher:
        if self._publisher is not None:
            return self._publisher
        # Подсказка открытым WebSocket-соединениям: появились новые уведомления
        return RedisEventPublisher(create_redis(self.settings.redis_connection_url))

    def unit_of_work(self) -> SqlUnitOfWork:
        return SqlUnitOfWork(self.database.new_session())

    def scheduler(self, uow: SqlUnitOfWork) -> NotificationScheduler:
        return NotificationScheduler(uow, NotificationConfig.from_settings(self.settings), self.clock, self.publisher)


_runtime: WorkerRuntime | None = None


def get_runtime() -> WorkerRuntime:
    global _runtime  # один экземпляр на процесс Celery
    if _runtime is None:
        _runtime = WorkerRuntime(get_settings())
    return _runtime
