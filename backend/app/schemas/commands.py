"""Входные данные операций (после проверки формами WTForms)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True, slots=True)
class JournalFilter:
    fio: str | None = None
    executor_id: int | None = None
    date_from: date | None = None
    date_to: date | None = None
    completed: bool | None = None
    my: bool = False


@dataclass(frozen=True, slots=True)
class CheckGroupInput:
    check_date: date
    check_time: str
    type_check_id: int | None = None
    type_check_name: str | None = None


@dataclass(frozen=True, slots=True)
class JournalRecordInput:
    check_date: date
    check_time: str
    type_check_id: int | None
    fio: str
    category_id: int | None
    organization_id: int
    executor_id: int
    type_check_name: str | None = None
    category_name: str | None = None
    solution_id: int | None = None
    solution_name: str | None = None
    note: str | None = None
    group_id: int | None = None
    version: int | None = None


@dataclass(frozen=True, slots=True)
class OrganizationInput:
    name: str
    address: str | None = None
    phone: str | None = None
    contact: str | None = None
    email: str | None = None
    note: str | None = None


@dataclass(frozen=True, slots=True)
class OptionInput:
    address: str | None = None
    position: str | None = None
    fio: str | None = None


@dataclass(frozen=True, slots=True)
class UserCreateInput:
    fio: str
    login: str
    password: str
    group_id: int
    profile: str | None = None


@dataclass(frozen=True, slots=True)
class UserUpdateInput:
    fio: str
    login: str
    group_id: int
    profile: str | None = None
    is_fired: bool = False
    password: str | None = None
