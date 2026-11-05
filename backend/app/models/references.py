"""Справочники и классификаторы (ТЗ, разделы 6 и 11)."""

from __future__ import annotations

from sqlalchemy import Boolean, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column

from database.session import db


class Option(db.Model):
    """Реквизиты и настройки (должность, ФИО ответственного и пр.)."""

    __tablename__ = "TOptions"
    __table_args__ = {"comment": "Справочник реквизитов и настроек"}

    id: Mapped[int] = mapped_column(primary_key=True)
    address: Mapped[str | None] = mapped_column("adress", String(250))
    position: Mapped[str | None] = mapped_column(String(150))
    fio: Mapped[str | None] = mapped_column("FIO", String(150))


class Category(db.Model):
    __tablename__ = "TCategory"
    __table_args__ = {"comment": "Категории аттестуемых лиц"}

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    description: Mapped[str | None] = mapped_column(Text)


class Solution(db.Model):
    __tablename__ = "TSolution"
    __table_args__ = {"comment": "Готовность решения (статусы записей журнала)"}

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    is_final: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=false(),
    )


class TypeCheck(db.Model):
    __tablename__ = "TTypeChecks"
    __table_args__ = {"comment": "Виды проверок"}

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), unique=True)
