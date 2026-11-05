"""Проверочные группы (блоки) и записи журнала."""

from __future__ import annotations

from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.organization import Organization
from app.models.references import Category, Solution, TypeCheck
from app.models.user import User
from database.session import db


class CheckGroup(db.Model):
    """Проверочная группа: дата, время и вид проверки."""

    __tablename__ = "TGroups"
    __table_args__ = {"comment": "Проверочные группы (блоки)"}

    id: Mapped[int] = mapped_column(primary_key=True)
    check_date: Mapped[date] = mapped_column("dates", Date, index=True)
    check_time: Mapped[str] = mapped_column("times", String(5))
    type_check_id: Mapped[int] = mapped_column(
        "typeChecks", ForeignKey("TTypeChecks.id", ondelete="RESTRICT")
    )

    type_check: Mapped[TypeCheck] = relationship(lazy="joined")


class JournalRecord(db.Model):
    """Запись журнала — задача исполнителя.

    Поле isEdit исходной схемы заменено: блокировка от одновременного
    редактирования хранится в Redis (ключ с ограниченным сроком жизни),
    а потерю изменений исключает столбец версии version (оптимистическая блокировка).
    """

    __tablename__ = "TJournal"
    __table_args__ = {"comment": "Журнал проверок"}

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(
        "groups", ForeignKey("TGroups.id", ondelete="CASCADE"), index=True
    )
    number: Mapped[int] = mapped_column("nomber", Integer)
    fio: Mapped[str] = mapped_column("nameFIO", String(150))
    category_id: Mapped[int | None] = mapped_column(
        "category", ForeignKey("TCategory.id", ondelete="RESTRICT"), nullable=True
    )
    category_name: Mapped[str | None] = mapped_column(String(100))
    organization_id: Mapped[int] = mapped_column(
        "organization", ForeignKey("TOrganization.id", ondelete="RESTRICT")
    )
    executor_id: Mapped[int] = mapped_column(
        "users", ForeignKey("TUsers.id", ondelete="RESTRICT"), index=True
    )
    solution_id: Mapped[int] = mapped_column(
        "solution", ForeignKey("TSolution.id", ondelete="RESTRICT")
    )
    note: Mapped[str | None] = mapped_column("comments", String(250))
    version: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1"
    )

    group: Mapped[CheckGroup] = relationship(lazy="joined")
    category: Mapped[Category | None] = relationship(lazy="joined")
    organization: Mapped[Organization] = relationship(lazy="joined")
    executor: Mapped[User] = relationship(lazy="joined")
    solution: Mapped[Solution] = relationship(lazy="joined")

    __mapper_args__ = {"version_id_col": version}
