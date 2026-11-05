"""Подключение к Redis.

Redis — вспомогательное хранилище общего состояния между процессами
(документ «Redis в OMSA Ledger»): лимиты входа по IP, блокировки записей,
Pub/Sub для WebSocket. Подключение — пользователем omsa_app из ACL.
"""

from __future__ import annotations

import redis
import redis.asyncio as aioredis


def create_redis(url: str) -> redis.Redis:
    return redis.Redis.from_url(
        url,
        decode_responses=True,
        socket_timeout=2,
        socket_connect_timeout=2,
        health_check_interval=30,
    )


def create_async_redis(url: str) -> aioredis.Redis:
    return aioredis.Redis.from_url(url, decode_responses=True, health_check_interval=30)
