"""Авторизация: вход, обновление токена, выход, смена пароля (ТЗ, разделы 3 и 4)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import NoReturn
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from app.interfaces.infrastructure import (
    HandoffTickets,
    LoginAttemptLimiter,
    PasswordHasher,
    TokenCodec,
    UnknownLoginAttempts,
)
from app.interfaces.repositories import UnitOfWork
from app.models.auth import RefreshToken
from app.models.user import User
from app.schemas.responses import (
    AccountLocked,
    AuthenticationFailed,
    NotFound,
    PermissionDenied,
    TooManyAttempts,
    ValidationFailed,
)
from app.schemas.settings import Portal
from app.services.access_control.access import AccessPolicy
from app.services.access_control.principal import Principal
from app.services.authentication.passwords import PasswordManager
from app.services.authentication.portal import PortalConfig
from core.clock import Clock, to_epoch_ms
from core.interprocess.events import EventPublisher, RealtimeEvent, RealtimeEventType
from core.security.login_limits import AccountLockPolicy, LockableAccount

INVALID_CREDENTIALS = "Неверный логин или пароль"
LAST_ATTEMPT = (
    "Неверный логин или пароль. Осталась последняя попытка — после следующей ошибки вход будет временно заблокирован"
)
NO_SETTINGS_RIGHT = "Недостаточно прав для управления пользователями"
SESSION_EXPIRED = "Сессия завершена. Войдите в систему"


def normalize_login(login: str) -> str:
    return login.strip().lower()


@dataclass(frozen=True, slots=True)
class IssuedSession:
    access_token: str
    access_expires_at: datetime
    refresh_token: UUID
    refresh_expires_at: datetime
    user: User


class AuthService:
    def __init__(
        self,
        uow: UnitOfWork,
        *,
        hasher: PasswordHasher,
        tokens: TokenCodec,
        clock: Clock,
        lock_policy: AccountLockPolicy,
        ip_limiter: LoginAttemptLimiter,
        unknown_logins: UnknownLoginAttempts,
        publisher: EventPublisher,
        handoff: HandoffTickets,
        access: AccessPolicy,
        portal: PortalConfig,
        refresh_ttl: timedelta,
        timezone: ZoneInfo,
    ) -> None:
        self._uow = uow
        self._hasher = hasher
        self._tokens = tokens
        self._clock = clock
        self._lock_policy = lock_policy
        self._ip_limiter = ip_limiter
        self._unknown_logins = unknown_logins
        self._publisher = publisher
        self._handoff = handoff
        self._access = access
        self._portal = portal
        self._refresh_ttl = refresh_ttl
        self._tz = timezone
        self._passwords = PasswordManager(uow, hasher, clock, publisher)

    # ------------------------------------------------------------------
    # Вход
    # ------------------------------------------------------------------
    def login(self, login: str, password: str, *, ip: str | None, user_agent: str | None) -> IssuedSession:
        now = self._clock.now()
        if self._ip_limiter.is_blocked(ip):
            raise TooManyAttempts("Слишком много попыток входа с вашего адреса. Повторите попытку позже")

        normalized = normalize_login(login)
        user = self._uow.users.get_by_login(normalized)
        if user is None:
            # Такой же счётчик и такая же блокировка: по ответу не узнать, есть ли логин
            self._hasher.burn(password)
            self._ip_limiter.register_failure(ip)
            self._reject(self._unknown_logins.register_failure(normalized, now), now)

        self._lock_policy.release_if_expired(user, now)
        if self._lock_policy.active_lock(user, now) is not None:
            # Действующая блокировка: пароль не проверяется
            self._uow.commit()
            self._reject(user, now)

        if not self._hasher.verify(user.password_hash, password):
            self._lock_policy.register_failure(user, now)
            self._ip_limiter.register_failure(ip)
            self._uow.commit()
            self._reject(user, now)

        self._lock_policy.register_success(user)
        if self._hasher.needs_rehash(user.password_hash):
            user.password_hash = self._hasher.hash(password)

        if self._portal.login_requires_settings and not self._can_administer(user):
            self._uow.commit()
            raise PermissionDenied(NO_SETTINGS_RIGHT)

        session = self._issue(user, now, ip=ip, user_agent=user_agent)
        self._uow.commit()
        return session

    def _reject(self, account: LockableAccount | None, now: datetime) -> NoReturn:
        """Отказ во входе: блокировка либо неверные данные; перед последней попыткой — предупреждение.

        Число оставшихся попыток не сообщается.
        """
        locked_until = self._lock_policy.active_lock(account, now) if account is not None else None
        if locked_until is not None:
            raise AccountLocked(self._lock_message(locked_until), details={"locked_until": locked_until.isoformat()})
        if account is not None and self._lock_policy.attempts_left(account) == 1:
            raise AuthenticationFailed(LAST_ATTEMPT)
        raise AuthenticationFailed(INVALID_CREDENTIALS)

    def _lock_message(self, until: datetime) -> str:
        local = until.astimezone(self._tz)
        return f"Учётная запись временно заблокирована до {local:%H:%M}"

    def _can_administer(self, user: User) -> bool:
        return self._access.allows(Principal.from_user(user), "users", "manage")

    # ------------------------------------------------------------------
    # Refresh-токен
    # ------------------------------------------------------------------
    def refresh(self, refresh_token: str | None, *, ip: str | None, user_agent: str | None) -> IssuedSession:
        """Обмен refresh-токена на новый JWT. Refresh-токен при этом заменяется новым (ротация)."""
        now = self._clock.now()
        token = self._find_refresh(refresh_token)
        if token is None or token.portal != self._portal.portal.value:
            raise AuthenticationFailed(SESSION_EXPIRED)
        if token.expires_at <= now:
            self._uow.refresh_tokens.delete(token)
            self._uow.commit()
            raise AuthenticationFailed(SESSION_EXPIRED)
        user = self._uow.users.get_by_uuid(token.user_uuid)
        if user is None:
            raise AuthenticationFailed(SESSION_EXPIRED)
        self._uow.refresh_tokens.delete(token)
        if self._portal.login_requires_settings and not self._can_administer(user):
            self._uow.commit()
            raise PermissionDenied(NO_SETTINGS_RIGHT)
        session = self._issue(user, now, ip=ip, user_agent=user_agent, session_id=token.session_id)
        self._uow.commit()
        return session

    def logout(self, refresh_token: str | None) -> None:
        token = self._find_refresh(refresh_token)
        if token is None:
            return
        user_uuid = token.user_uuid
        if token.portal == Portal.WEB.value:
            # Выход из журнала завершает и открытое из него управление пользователями
            self._uow.push.delete_session(token.session_id)
            self._uow.refresh_tokens.delete_session(token.session_id)
        else:
            self._uow.refresh_tokens.delete(token)
        self._uow.after_commit(lambda: self._publisher.publish(RealtimeEvent(RealtimeEventType.CLOSE, user_uuid)))
        self._uow.commit()

    def _find_refresh(self, raw: str | None) -> RefreshToken | None:
        if not raw:
            return None
        try:
            token_id = UUID(raw)
        except ValueError:
            return None
        return self._uow.refresh_tokens.get(token_id)

    def _issue(
        self,
        user: User,
        now: datetime,
        *,
        ip: str | None,
        user_agent: str | None,
        session_id: UUID | None = None,
    ) -> IssuedSession:
        access_token, access_expires_at = self._tokens.issue(user.uuid, audience=self._portal.audience, now=now)
        refresh = RefreshToken(
            id=uuid4(),
            user_uuid=user.uuid,
            portal=self._portal.portal.value,
            session_id=session_id or uuid4(),
            created_at=now,
            expires_at=now + self._refresh_ttl,
            user_agent=(user_agent or "")[:255] or None,
            ip=(ip or "")[:45] or None,
        )
        self._uow.refresh_tokens.add(refresh)
        return IssuedSession(access_token, access_expires_at, refresh.id, refresh.expires_at, user)

    # ------------------------------------------------------------------
    # Переход из журнала в управление пользователями без повторного входа
    # ------------------------------------------------------------------
    def admin_handoff(self, refresh_token: str | None) -> str | None:
        """Билет перехода в управление пользователями для действующей сессии журнала.

        None — сессии журнала нет или у сотрудника нет права «Настройки»:
        управление пользователями тогда запрашивает логин и пароль.
        """
        if self._portal.portal is not Portal.WEB:
            raise NotFound("Страница не найдена")
        token = self._find_refresh(refresh_token)
        if token is None or token.portal != Portal.WEB.value or token.expires_at <= self._clock.now():
            return None
        user = self._uow.users.get_by_uuid(token.user_uuid)
        if user is None or not self._can_administer(user):
            return None
        return self._handoff.issue(user.uuid, token.session_id)

    def enter_by_ticket(self, ticket: str | None, *, ip: str | None, user_agent: str | None) -> IssuedSession:
        """Сессия управления пользователями по билету из журнала, связанная с сессией журнала."""
        if self._portal.portal is not Portal.ADMIN:
            raise NotFound("Страница не найдена")
        redeemed = self._handoff.redeem(ticket or "")
        if redeemed is None:
            raise AuthenticationFailed(SESSION_EXPIRED)
        user_uuid, session_id = redeemed
        now = self._clock.now()
        # Сотрудник мог выйти из журнала, пока билет был в пути
        if not self._uow.refresh_tokens.session_active(session_id, portal=Portal.WEB.value, now=now):
            raise AuthenticationFailed(SESSION_EXPIRED)
        user = self._uow.users.get_by_uuid(user_uuid)
        if user is None:
            raise AuthenticationFailed(SESSION_EXPIRED)
        if not self._can_administer(user):
            raise PermissionDenied(NO_SETTINGS_RIGHT)
        session = self._issue(user, now, ip=ip, user_agent=user_agent, session_id=session_id)
        self._uow.commit()
        return session

    # ------------------------------------------------------------------
    # Проверка JWT при каждом запросе
    # ------------------------------------------------------------------
    def authenticate(self, access_token: str) -> Principal:
        claims = self._tokens.decode(access_token, audience=self._portal.audience, now=self._clock.now())
        user = self._uow.users.get_by_uuid(claims.subject)
        if user is None:
            raise AuthenticationFailed("Учётная запись не найдена")
        if claims.issued_at_ms < to_epoch_ms(user.password_changed_at):
            # Токен выдан до смены пароля — отклоняется, даже если его срок не истёк
            raise AuthenticationFailed("Пароль был изменён. Войдите в систему заново")
        return Principal.from_user(user)

    def current_user(self, principal: Principal) -> User:
        user = self._uow.users.get(principal.user_id)
        if user is None:
            raise AuthenticationFailed("Учётная запись не найдена")
        return user

    # ------------------------------------------------------------------
    # Смена пароля
    # ------------------------------------------------------------------
    def change_password(
        self,
        principal: Principal,
        old_password: str,
        new_password: str,
        *,
        ip: str | None,
        user_agent: str | None,
    ) -> IssuedSession:
        user = self.current_user(principal)
        if not self._hasher.verify(user.password_hash, old_password):
            raise ValidationFailed("Текущий пароль указан неверно", details={"old_password": ["Неверный пароль"]})
        if old_password == new_password:
            raise ValidationFailed("Новый пароль совпадает с текущим", details={"new_password": ["Пароль не изменён"]})
        self._passwords.change(user, new_password)
        self._uow.flush()
        # Все прежние сессии завершены; текущей выдаётся новая пара токенов
        session = self._issue(user, self._clock.now(), ip=ip, user_agent=user_agent)
        self._uow.commit()
        return session
