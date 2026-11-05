"""Справочник организаций."""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from database.session import db


class Organization(db.Model):
    __tablename__ = "TOrganization"
    __table_args__ = {"comment": "Организации"}

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    address: Mapped[str | None] = mapped_column("adress", String(150))
    phone: Mapped[str | None] = mapped_column(String(50))
    contact: Mapped[str | None] = mapped_column("FIOContact", String(150))
    email: Mapped[str | None] = mapped_column("mail", String(100))
    note: Mapped[str | None] = mapped_column("comments", String(150))
