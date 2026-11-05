"""Блокировка записи от одновременного редактирования (документ «Redis», третья задача).

Блокировка — ключ Redis с ограниченным сроком жизни (около пяти минут).
Срок продлевается, пока карточка открыта, и истекает сам, если пользователь
закрыл вкладку. Продлить или снять блокировку может только её владелец;
проверка владельца и изменение ключа выполняются атомарно скриптом Lua.

Redis отвечает за удобство пользователя, а корректность данных обеспечивает
столбец версии TJournal.version: при недоступности Redis блокировка
не устанавливается, но потерять чужие изменения всё равно нельзя.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import redis

logger = logging.getLogger(__name__)

# Значение ключа: "<id пользователя>:<ФИО>"
_ACQUIRE = """
local current = redis.call('GET', KEYS[1])
if (not current) or string.match(current, '^(%d+):') == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  return 1
end
return current
"""

_RELEASE = """
local current = redis.call('GET', KEYS[1])
if current and string.match(current, '^(%d+):') == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


@dataclass(frozen=True, slots=True)
class LockOwner:
    user_id: int
    fio: str

    def encode(self) -> str:
        return f"{self.user_id}:{self.fio}"

    @classmethod
    def decode(cls, value: str) -> LockOwner:
        user_id, _, fio = value.partition(":")
        return cls(int(user_id), fio)


@dataclass(frozen=True, slots=True)
class LockResult:
    acquired: bool
    holder: LockOwner | None
    ttl_seconds: int
    available: bool = True  # False — Redis недоступен, блокировка не установлена


class RedisEditLockManager:
    KEY_PREFIX = "omsa:lock:"

    def __init__(self, client: redis.Redis | None, *, ttl_seconds: int) -> None:
        self._redis = client
        self._ttl = ttl_seconds
        self._acquire = client.register_script(_ACQUIRE) if client is not None else None
        self._release = client.register_script(_RELEASE) if client is not None else None

    @property
    def ttl_seconds(self) -> int:
        return self._ttl

    def _key(self, resource: str) -> str:
        return self.KEY_PREFIX + resource

    def acquire(self, resource: str, owner: LockOwner) -> LockResult:
        """Ставит или продлевает блокировку владельца."""
        if self._acquire is None:
            return LockResult(acquired=True, holder=None, ttl_seconds=0, available=False)
        try:
            result = self._acquire(keys=[self._key(resource)], args=[str(owner.user_id), owner.encode(), self._ttl])
        except redis.RedisError:
            logger.warning("Redis недоступен: блокировка %s не установлена", resource)
            return LockResult(acquired=True, holder=None, ttl_seconds=0, available=False)
        if result == 1:
            return LockResult(acquired=True, holder=owner, ttl_seconds=self._ttl)
        return LockResult(acquired=False, holder=LockOwner.decode(str(result)), ttl_seconds=self._ttl)

    def release(self, resource: str, owner: LockOwner) -> None:
        if self._release is None:
            return
        try:
            self._release(keys=[self._key(resource)], args=[str(owner.user_id)])
        except redis.RedisError:
            logger.warning("Redis недоступен: блокировка %s снимется по истечении срока", resource)

    def holder(self, resource: str) -> LockOwner | None:
        if self._redis is None:
            return None
        try:
            value = self._redis.get(self._key(resource))
        except redis.RedisError:
            return None
        return LockOwner.decode(value) if value else None
