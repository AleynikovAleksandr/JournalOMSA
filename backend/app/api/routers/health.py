"""Проверка работоспособности для Kubernetes (readinessProbe / livenessProbe)."""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import ContainerDep

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Служебные"])


@router.get("/health")
def health(container: ContainerDep) -> JSONResponse:
    try:
        with container.database.session() as session:
            session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        logger.exception("База данных недоступна")
        return JSONResponse({"status": "unavailable", "database": "error"}, status_code=503)
    return JSONResponse({"status": "ok", "portal": container.portal.portal.value})
