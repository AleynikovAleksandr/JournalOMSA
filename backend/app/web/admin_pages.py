"""Страницы порта 5620: вход в систему управления пользователями и управление пользователями."""

from __future__ import annotations

from flask import Blueprint, redirect, render_template, url_for

admin_pages = Blueprint("admin_pages", __name__)


@admin_pages.get("/")
def index():
    return redirect(url_for("admin_pages.users"))


@admin_pages.get("/login")
def login():
    return render_template("login_admin_panel.html")


@admin_pages.get("/users")
def users():
    # Данные пользователей страница получает через API, которое проверяет JWT
    # и право «Настройки» (menuSettings) при каждом запросе
    return render_template("user_management.html")
