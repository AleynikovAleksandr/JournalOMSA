"""Краткая форма ФИО: «Иванова Елена Сергеевна» → «Иванова Е.С.»."""

from __future__ import annotations


def short_name(fio: str | None) -> str:
    parts = (fio or "").split()
    if not parts:
        return ""
    initials = "".join(f"{part[0]}." for part in parts[1:3] if part)
    return f"{parts[0]} {initials}".strip()
