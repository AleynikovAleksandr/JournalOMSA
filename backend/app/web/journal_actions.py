"""Прямые адреса действий, открываемых внутри страницы журнала."""

from __future__ import annotations

from flask import Blueprint, current_app, render_template

journal_actions = Blueprint("journal_actions", __name__, url_prefix="/journal")


@journal_actions.get("/new-group")
def new_group():
    """Страница журнала с окном создания проверочной группы."""
    return render_template("journal.html", admin_url=current_app.config["OMSA_ADMIN_URL"], initial_modal="newBlock")


@journal_actions.get("/references")
def references():
    """Страница журнала с окном справочников."""
    return render_template("journal.html", admin_url=current_app.config["OMSA_ADMIN_URL"], initial_modal="references")
