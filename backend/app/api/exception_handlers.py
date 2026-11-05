"""Обработчики исключений: ошибки предметной области и прочие сбои → ответ ErrorOut."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from app.schemas.responses import DomainError, ErrorOut

logger = logging.getLogger(__name__)


def _response(status: int, code: str, message: str, details: dict | None = None) -> JSONResponse:
    body = ErrorOut(detail=message, code=code, errors=details or {})
    return JSONResponse(status_code=status, content=body.model_dump())


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain(_: Request, exc: DomainError) -> JSONResponse:
        return _response(exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        details: dict[str, list[str]] = {}
        for error in exc.errors():
            field = str(error.get("loc", ["", ""])[-1])
            details.setdefault(field, []).append("Неверное значение")
        return _response(422, "validation_error", "Некорректные параметры запроса", details)

    @app.exception_handler(StaleDataError)
    async def _stale(_: Request, __: StaleDataError) -> JSONResponse:
        return _response(409, "conflict", "Запись изменена другим пользователем. Обновите данные")

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, exc: IntegrityError) -> JSONResponse:
        logger.warning("Нарушение целостности данных: %s", exc.orig)
        return _response(409, "conflict", "Операция нарушает целостность данных")
