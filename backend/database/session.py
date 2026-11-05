"""Подключение к базе данных.

Движком и пулом соединений владеет Flask-SQLAlchemy (параметры
SQLALCHEMY_ENGINE_OPTIONS из документа «Gunicorn», раздел 7). Эндпоинты
FastAPI, Celery и служебные скрипты работают через тот же движок:
Database открывает обычные сессии SQLAlchemy, поэтому число соединений
считается по одному пулу на процесс.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Protocol

from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import Engine, MetaData, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.schemas.settings import Settings

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


db = SQLAlchemy(model_class=Base)


class EngineCustomizer(Protocol):
    """Подключение другой СУБД вместо PostgreSQL: параметры движка и его настройка."""

    def matches(self, url: str) -> bool: ...
    def engine_options(self, settings: Settings) -> dict[str, Any]: ...
    def configure(self, engine: Engine) -> None: ...


_customizers: list[EngineCustomizer] = []


def register_engine_customizer(customizer: EngineCustomizer) -> None:
    if all(type(item) is not type(customizer) for item in _customizers):
        _customizers.append(customizer)


def _customizer_for(url: str) -> EngineCustomizer | None:
    return next((item for item in _customizers if item.matches(url)), None)


def engine_options(settings: Settings) -> dict[str, Any]:
    customizer = _customizer_for(settings.sqlalchemy_url)
    if customizer is not None:
        return customizer.engine_options(settings)
    return {
        "pool_size": settings.db_pool_size,
        "max_overflow": settings.db_max_overflow,
        "pool_pre_ping": True,  # проверка соединения перед использованием
        "pool_recycle": settings.db_pool_recycle,  # пересоздание соединений раз в 30 минут
    }


def configure_flask_database(flask_app: Flask, settings: Settings) -> None:
    url = settings.sqlalchemy_url
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = url
    flask_app.config["SQLALCHEMY_ENGINE_OPTIONS"] = engine_options(settings)
    flask_app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db.init_app(flask_app)
    customizer = _customizer_for(url)
    if customizer is not None:
        with flask_app.app_context():
            customizer.configure(db.engine)


class Database:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        # После фиксации объекты перечитываются: ответ API строится по актуальным данным
        self._factory = sessionmaker(bind=engine, expire_on_commit=True, autoflush=True)

    @classmethod
    def from_flask_app(cls, flask_app: Flask) -> Database:
        with flask_app.app_context():
            return cls(db.engine)

    def new_session(self) -> Session:
        return self._factory()

    @contextmanager
    def session(self) -> Iterator[Session]:
        session = self._factory()
        try:
            yield session
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    @property
    def dialect(self) -> str:
        return self.engine.dialect.name

    def create_all(self) -> None:
        import app.models.registry  # noqa: F401 — регистрация моделей в метаданных

        if self.dialect == "postgresql":
            # Несколько init-контейнеров могут стартовать одновременно при добавлении таблиц.
            with self.engine.begin() as connection:
                connection.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": 7_310_001})
                Base.metadata.create_all(connection)
        else:
            Base.metadata.create_all(self.engine)


def create_database_app(settings: Settings) -> Flask:
    """Минимальное Flask-приложение для Celery и служебных скриптов: только подключение к базе."""
    flask_app = Flask("omsa_ledger_db", root_path=str(Path(__file__).resolve().parent))
    configure_flask_database(flask_app, settings)
    return flask_app
