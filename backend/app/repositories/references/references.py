"""Справочники: категории, виды проверок, статусы, реквизиты."""

from __future__ import annotations

from sqlalchemy import select

from app.models.references import Category, Option, Solution, TypeCheck
from app.repositories.base import SqlRepository


class ReferenceRepository(SqlRepository):
    def categories(self) -> list[Category]:
        return list(self._session.scalars(select(Category).order_by(Category.id)))

    def type_checks(self) -> list[TypeCheck]:
        return list(self._session.scalars(select(TypeCheck).order_by(TypeCheck.id)))

    def solutions(self) -> list[Solution]:
        return list(self._session.scalars(select(Solution).order_by(Solution.id)))

    def options(self) -> list[Option]:
        return list(self._session.scalars(select(Option).order_by(Option.id)))

    def add_category(self, item: Category) -> None:
        self._session.add(item)

    def add_type_check(self, item: TypeCheck) -> None:
        self._session.add(item)

    def add_solution(self, item: Solution) -> None:
        self._session.add(item)

    def add_option(self, item: Option) -> None:
        self._session.add(item)

    def category(self, category_id: int) -> Category | None:
        return self._session.get(Category, category_id)

    def type_check(self, type_check_id: int) -> TypeCheck | None:
        return self._session.get(TypeCheck, type_check_id)

    def solution(self, solution_id: int) -> Solution | None:
        return self._session.get(Solution, solution_id)

    def final_solution(self) -> Solution | None:
        """Статус, означающий «Завершено» (в справочнике ТЗ — «Готов»)."""
        stmt = select(Solution).where(Solution.is_final.is_(True)).order_by(Solution.id).limit(1)
        return self._session.scalar(stmt)

    def default_solution(self) -> Solution | None:
        """Статус новой записи — первый незавершающий («В процессе»)."""
        stmt = select(Solution).where(Solution.is_final.is_(False)).order_by(Solution.id).limit(1)
        return self._session.scalar(stmt)
