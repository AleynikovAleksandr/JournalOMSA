"""Сборка зависимостей приложения (composition root).

Здесь конкретные реализации (SQLAlchemy, Redis, argon2-cffi, PyJWT, Casbin)
подставляются в сервисы, которые зависят только от протоколов app/interfaces.
"""

from __future__ import annotations

import logging
from datetime import timedelta

import redis
from flask import Flask

from app.repositories.unit_of_work import SqlUnitOfWork
from app.schemas.settings import Settings
from app.services.access_control.access import AccessPolicy
from app.services.access_control.principal import Principal
from app.services.authentication.auth import AuthService
from app.services.authentication.portal import PortalConfig
from app.services.directories.organizations import OrganizationService
from app.services.directories.options import OptionService
from app.services.directories.references import ReferenceService
from app.services.inspections.check_groups import CheckGroupService
from app.services.inspections.edit_locks import JournalEditLocks
from app.services.inspections.records import JournalService
from app.services.inspections.tasks import TaskService
from app.services.reminders.notifications import NotificationService
from app.services.reminders.scheduler import NotificationConfig, NotificationScheduler
from app.services.user_management.user_groups import UserGroupService
from app.services.user_management.users import UserService
from app.web.form_gateway import FormGateway
from casbin_security.enforcer import CasbinAccessControl
from core.clock import Clock, SystemClock
from core.interprocess.client import create_redis
from core.interprocess.events import EventBus, EventPublisher, RedisEventPublisher
from core.interprocess.locks import RedisEditLockManager
from core.security.handoff import RedisHandoffTickets
from core.security.login_limits import AccountLockPolicy, IpLoginLimiter, RedisUnknownLoginAttempts
from core.security.passwords import Argon2PasswordHasher
from core.security.tokens import JwtTokenCodec
from database.session import Database

logger = logging.getLogger(__name__)


class Container:
    def __init__(
        self,
        settings: Settings,
        portal: PortalConfig,
        flask_app: Flask,
        *,
        clock: Clock | None = None,
        redis_client: redis.Redis | None = None,
        hasher: Argon2PasswordHasher | None = None,
        event_bus: EventBus | None = None,
    ) -> None:
        self.settings = settings
        self.portal = portal
        self.flask_app = flask_app
        self.clock = clock or SystemClock()
        self.database = Database.from_flask_app(flask_app)
        self.forms = FormGateway(flask_app)

        self.hasher = hasher or Argon2PasswordHasher(
            time_cost=settings.argon2_time_cost,
            memory_kib=settings.argon2_memory_kib,
            parallelism=settings.argon2_parallelism,
        )
        self.tokens = JwtTokenCodec(
            secret=settings.jwt_secret, algorithm=settings.jwt_algorithm, ttl=settings.access_token_ttl
        )
        self.access = AccessPolicy(CasbinAccessControl())
        self.lock_policy = AccountLockPolicy(
            max_attempts=settings.login_max_attempts, lock_duration=timedelta(minutes=settings.login_lock_minutes)
        )

        self.redis = redis_client if redis_client is not None else create_redis(settings.redis_connection_url)
        self.ip_limiter = IpLoginLimiter(
            self.redis,
            max_attempts=settings.login_ip_max_attempts,
            window=timedelta(minutes=settings.login_ip_window_minutes),
        )
        self.unknown_logins = RedisUnknownLoginAttempts(self.redis, policy=self.lock_policy)
        self.edit_locks = RedisEditLockManager(self.redis, ttl_seconds=settings.edit_lock_ttl_seconds)
        self.handoff = RedisHandoffTickets(self.redis)

        # Несколько воркеров и подов — события через Redis Pub/Sub; если передана шина
        # событий процесса, события доставляются через неё
        self.event_bus = event_bus
        self.publisher: EventPublisher = event_bus if event_bus is not None else RedisEventPublisher(self.redis)

        self.notification_config = NotificationConfig.from_settings(settings)

    # ------------------------------------------------------------------
    def unit_of_work(self) -> SqlUnitOfWork:
        return SqlUnitOfWork(self.database.new_session())

    def scheduler(self, uow: SqlUnitOfWork) -> NotificationScheduler:
        return NotificationScheduler(uow, self.notification_config, self.clock, self.publisher)

    def auth_service(self, uow: SqlUnitOfWork) -> AuthService:
        return AuthService(
            uow,
            hasher=self.hasher,
            tokens=self.tokens,
            clock=self.clock,
            lock_policy=self.lock_policy,
            ip_limiter=self.ip_limiter,
            unknown_logins=self.unknown_logins,
            publisher=self.publisher,
            handoff=self.handoff,
            access=self.access,
            portal=self.portal,
            refresh_ttl=self.settings.refresh_token_ttl,
            timezone=self.settings.timezone,
        )

    def journal_service(self, uow: SqlUnitOfWork, principal: Principal) -> JournalService:
        return JournalService(
            uow,
            principal,
            policy=self.access,
            scheduler=self.scheduler(uow),
            locks=JournalEditLocks(self.edit_locks, principal),
        )

    def group_service(self, uow: SqlUnitOfWork, principal: Principal) -> CheckGroupService:
        return CheckGroupService(uow, principal, self.access, self.scheduler(uow))

    def task_service(self, uow: SqlUnitOfWork, principal: Principal) -> TaskService:
        return TaskService(
            uow,
            principal,
            journal=self.journal_service(uow, principal),
            scheduler=self.scheduler(uow),
            clock=self.clock,
            upcoming_window=timedelta(days=self.settings.tasks_upcoming_days),
        )

    def notification_service(self, uow: SqlUnitOfWork, principal: Principal) -> NotificationService:
        return NotificationService(uow, principal, self.clock, self.settings, self.portal.portal)

    def organization_service(self, uow: SqlUnitOfWork, principal: Principal) -> OrganizationService:
        return OrganizationService(uow, principal, self.access)

    def reference_service(self, uow: SqlUnitOfWork, principal: Principal) -> ReferenceService:
        return ReferenceService(uow, principal, self.access)

    def option_service(self, uow: SqlUnitOfWork, principal: Principal) -> OptionService:
        return OptionService(uow, principal, self.access)

    def user_service(self, uow: SqlUnitOfWork, principal: Principal) -> UserService:
        return UserService(
            uow,
            principal,
            policy=self.access,
            hasher=self.hasher,
            clock=self.clock,
            publisher=self.publisher,
        )

    def user_group_service(self, uow: SqlUnitOfWork, principal: Principal) -> UserGroupService:
        return UserGroupService(uow, principal, self.access)
