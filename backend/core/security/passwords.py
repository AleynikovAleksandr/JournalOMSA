"""Хеширование паролей Argon2id (ТЗ, 3.2.1): пароли хранятся только в виде хеша."""

from __future__ import annotations

import secrets

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError


class Argon2PasswordHasher:
    """Хранение паролей только в виде хеша Argon2id (ТЗ, 3.2.1)."""

    def __init__(self, *, time_cost: int = 3, memory_kib: int = 65536, parallelism: int = 4) -> None:
        self._hasher = PasswordHasher(
            time_cost=time_cost, memory_cost=memory_kib, parallelism=parallelism, type=Type.ID
        )
        # Хеш для «пустой» проверки: вход по несуществующему логину занимает столько же времени,
        # сколько и по существующему, поэтому по времени ответа нельзя подобрать логины.
        self._dummy_hash = self._hasher.hash(secrets.token_urlsafe(16))

    def hash(self, password: str) -> str:
        return self._hasher.hash(password)

    def verify(self, password_hash: str, password: str) -> bool:
        try:
            return self._hasher.verify(password_hash, password)
        # Повреждённый хеш в базе (в том числе не ASCII) — отказ во входе, а не ошибка сервера
        except (VerifyMismatchError, VerificationError, InvalidHashError, ValueError):
            return False

    def needs_rehash(self, password_hash: str) -> bool:
        try:
            return self._hasher.check_needs_rehash(password_hash)
        except (InvalidHashError, ValueError):
            return True

    def burn(self, password: str) -> None:
        self.verify(self._dummy_hash, password)
