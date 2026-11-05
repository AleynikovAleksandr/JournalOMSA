"""Блокировка карточки записи журнала на время редактирования."""

from __future__ import annotations

from app.interfaces.infrastructure import EditLockManager
from app.schemas.responses import EditLocked
from app.schemas.short_name import short_name
from app.services.access_control.principal import Principal
from core.interprocess.locks import LockOwner, LockResult


class JournalEditLocks:
    def __init__(self, manager: EditLockManager, principal: Principal) -> None:
        self._manager = manager
        self._owner = LockOwner(principal.user_id, principal.fio)

    @staticmethod
    def _resource(record_id: int) -> str:
        return f"journal:{record_id}"

    @staticmethod
    def _busy(holder: LockOwner) -> EditLocked:
        return EditLocked(
            f"Запись редактирует {short_name(holder.fio)}",
            details={"holder": {"user_id": holder.user_id, "fio": holder.fio}},
        )

    def acquire(self, record_id: int) -> LockResult:
        """Ставит блокировку или продлевает её, если она уже принадлежит пользователю."""
        result = self._manager.acquire(self._resource(record_id), self._owner)
        if not result.acquired and result.holder is not None:
            raise self._busy(result.holder)
        return result

    def release(self, record_id: int) -> None:
        self._manager.release(self._resource(record_id), self._owner)

    def ensure_not_locked_by_other(self, record_id: int) -> None:
        holder = self._manager.holder(self._resource(record_id))
        if holder is not None and holder.user_id != self._owner.user_id:
            raise self._busy(holder)
