"""Сборка REST/JSON-API (/api/*) из роутеров."""

from fastapi import APIRouter

from app.api.routers import auth, groups, journal, notifications, organizations, references, tasks, users


def build_api_router() -> APIRouter:
    api = APIRouter(prefix="/api")
    for router in (
        auth.router,
        tasks.router,
        notifications.router,
        journal.router,
        groups.router,
        organizations.router,
        users.router,
        users.groups_router,
        references.router,
    ):
        api.include_router(router)
    return api
