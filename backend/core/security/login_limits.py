"""Ограничение попыток входа (ТЗ, раздел 3.1).

Два уровня защиты:

1. AccountLockPolicy — счётчик по учётной записи в базе данных
   (поля failed_login_attempts и locked_until таблицы TUsers): после пятой
   неудачной попытки учётная запись блокируется на 15 минут. Счётчик общий
   для обеих форм входа (порты 5600 и 5620).
2. IpLoginLimiter — счётчик по IP-адресу в Redis с автоматическим истечением.
   Защищает от перебора одного пароля по многим логинам. Лимит значительно
   выше пяти: сотрудники одной организации выходят в сеть через общий адрес.
   При недоступности Redis проверка пропускается — блокировка по учётной
   записи продолжает работать через базу.

Ответ на неудачный вход сообщает, сколько попыток осталось. Чтобы по ответу
нельзя было узнать, существует ли логин, для несуществующих логинов
RedisUnknownLoginAttempts ведёт такой же счётчик с такой же блокировкой.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

import redis

logger = logging.getLogger(__name__)


class LockableAccount(Protocol):
    failed_login_attempts: int
    locked_until: datetime | None


class AccountLockPolicy:
    def __init__(self, *, max_attempts: int, lock_duration: timedelta) -> None:
        self.max_attempts = max_attempts
        self.lock_duration = lock_duration

    def active_lock(self, account: LockableAccount, now: datetime) -> datetime | None:
        if account.locked_until is not None and account.locked_until > now:
            return account.locked_until
        return None

    def release_if_expired(self, account: LockableAccount, now: datetime) -> None:
        """После окончания блокировки снова доступны все пять попыток."""
        if account.locked_until is not None and account.locked_until <= now:
            account.locked_until = None
            account.failed_login_attempts = 0

    def register_failure(self, account: LockableAccount, now: datetime) -> bool:
        """Учитывает неудачную попытку. Возвращает True, если учётная запись заблокирована."""
        account.failed_login_attempts = (account.failed_login_attempts or 0) + 1
        if account.failed_login_attempts >= self.max_attempts:
            account.locked_until = now + self.lock_duration
            return True
        return False

    def register_success(self, account: LockableAccount) -> None:
        account.failed_login_attempts = 0
        account.locked_until = None

    def attempts_left(self, account: LockableAccount) -> int:
        """Сколько неудачных попыток осталось до блокировки."""
        return max(0, self.max_attempts - (account.failed_login_attempts or 0))


class IpLoginLimiter:
    KEY_PREFIX = "omsa:login:ip:"

    def __init__(self, client: redis.Redis | None, *, max_attempts: int, window: timedelta) -> None:
        self._redis = client
        self._max_attempts = max_attempts
        self._window_seconds = max(1, int(window.total_seconds()))

    def _key(self, ip: str) -> str:
        return self.KEY_PREFIX + ip

    def is_blocked(self, ip: str | None) -> bool:
        if not ip or self._redis is None:
            return False
        try:
            value = self._redis.get(self._key(ip))
        except redis.RedisError:
            logger.warning("Redis недоступен: проверка попыток входа по IP пропущена")
            return False
        return value is not None and int(value) >= self._max_attempts

    def register_failure(self, ip: str | None) -> None:
        if not ip or self._redis is None:
            return
        try:
            pipe = self._redis.pipeline()
            pipe.incr(self._key(ip))
            # Срок задаётся при первой ошибке и не продлевается последующими
            pipe.expire(self._key(ip), self._window_seconds, nx=True)
            pipe.execute()
        except redis.RedisError:
            logger.warning("Redis недоступен: неудачная попытка входа по IP не учтена")


@dataclass
class UnknownLoginState:
    """Счётчик несуществующего логина — в том же виде, что поля учётной записи."""

    failed_login_attempts: int = 0
    locked_until: datetime | None = None


class RedisUnknownLoginAttempts:
    """Неудачные попытки входа под несуществующим логином.

    Счётчик и блокировка считаются той же AccountLockPolicy, что у учётных
    записей, поэтому ответы для существующего и несуществующего логина
    совпадают. Логин хранится только как SHA-256; ключ живёт сутки (или срок
    блокировки, если он дольше) — перебор логинов не занимает память Redis.
    При недоступности Redis счётчик не ведётся.
    """

    KEY_PREFIX = "omsa:login:unknown:"
    KEY_TTL = timedelta(days=1)

    def __init__(self, client: redis.Redis | None, *, policy: AccountLockPolicy) -> None:
        self._redis = client
        self._policy = policy
        self._ttl_seconds = int(max(self.KEY_TTL, policy.lock_duration).total_seconds())

    def _key(self, login: str) -> str:
        return self.KEY_PREFIX + hashlib.sha256(login.encode()).hexdigest()

    def register_failure(self, login: str, now: datetime) -> UnknownLoginState | None:
        """Учитывает неудачную попытку так же, как у учётной записи; None — Redis недоступен."""
        if self._redis is None:
            return None
        key = self._key(login)
        try:
            stored = self._redis.hgetall(key)
            locked_until = stored.get("locked_until")
            state = UnknownLoginState(
                failed_login_attempts=int(stored.get("attempts", 0)),
                locked_until=datetime.fromisoformat(locked_until) if locked_until else None,
            )
            self._policy.release_if_expired(state, now)
            if self._policy.active_lock(state, now) is None:
                # во время блокировки попытки не учитываются — как у учётной записи
                self._policy.register_failure(state, now)
            pipe = self._redis.pipeline()
            pipe.hset(
                key,
                mapping={
                    "attempts": state.failed_login_attempts,
                    "locked_until": state.locked_until.isoformat() if state.locked_until else "",
                },
            )
            pipe.expire(key, self._ttl_seconds)
            pipe.execute()
        except redis.RedisError:
            logger.warning("Redis недоступен: попытка входа под несуществующим логином не учтена")
            return None
        return state
