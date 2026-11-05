"""Источник текущего времени.

Сервисы получают время через Clock, а не вызывают datetime.now() напрямую:
расчёт уведомлений, блокировок и сроков токенов зависит от времени,
и его подмена нужна для проверки этих правил.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Protocol

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


class Clock(Protocol):
    def now(self) -> datetime:
        """Текущий момент в UTC (с часовым поясом)."""
        ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


def truncate_to_ms(moment: datetime) -> datetime:
    """Отбрасывает доли миллисекунды: с такой точностью сравниваются iat и password_changed_at."""
    return moment.replace(microsecond=moment.microsecond // 1000 * 1000)


def to_epoch_ms(moment: datetime) -> int:
    """Миллисекунды от начала эпохи без ошибок округления float."""
    return (moment - _EPOCH) // timedelta(milliseconds=1)
