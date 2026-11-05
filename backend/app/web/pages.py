"""Страницы порта 5600: вход и журнал проверок."""

from __future__ import annotations

from flask import Blueprint, current_app, redirect, render_template, send_from_directory, url_for

web_pages = Blueprint("web_pages", __name__)


@web_pages.get("/notification-sw.js")
def notification_worker():
    response = send_from_directory(
        current_app.static_folder + "/js/notify",
        "notification-sw.js",
        mimetype="text/javascript",
    )
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-store"
    return response


@web_pages.get("/")
def index():
    return redirect(url_for("web_pages.journal"))


@web_pages.get("/login")
def login():
    return render_template("login.html")


@web_pages.get("/journal")
def journal():
    # Шаблон не содержит данных: журнал страница получает через API после входа,
    # а без действующей сессии скрипт страницы возвращает пользователя на /login
    return render_template("journal.html", admin_url=current_app.config["OMSA_ADMIN_URL"])
