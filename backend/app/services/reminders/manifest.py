"""Один JSON-манифест для карточки в журнале и системного Web Push."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from app.models.notification import Notification

MANIFEST_PATH = Path(__file__).resolve().parents[3] / "static" / "notifications" / "notification-manifest.json"


@lru_cache(maxsize=1)
def notification_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def notification_payload(notification: Notification) -> dict:
    manifest = notification_manifest()
    record = notification.record
    group = record.group
    values = {
        "id": notification.id,
        "journal_id": record.id,
        "fio": record.fio,
        "date": group.check_date.strftime("%d.%m.%Y"),
        "time": group.check_time,
        "type": group.type_check.name,
    }
    return {
        "version": manifest["version"],
        "id": notification.id,
        "kind": notification.kind,
        "title": manifest["events"][notification.kind]["title"].format_map(values),
        "body": manifest["body"].format_map(values),
        "icon": manifest["icon"],
        "url": manifest["url"].format_map(values),
        "actions": manifest["actions"],
        "journal_id": record.id,
        "fio": record.fio,
        "date": group.check_date,
        "time": group.check_time,
        "check_type": group.type_check.name,
        "fire_at": notification.fire_at,
        "shown_at": notification.shown_at,
    }
