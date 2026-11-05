"""Проверка данных JSON-API формами Flask-WTF.

Страницы отправляют данные в FastAPI запросами fetch. Чтобы проверка
выполнялась средствами Flask-WTF / WTForms (ТЗ, раздел 1 и 3.2), запрос
API пропускается через форму внутри контекста запроса Flask:

* CSRF-токен из заголовка X-CSRFToken сверяется с токеном в сессии Flask
  (cookie сессии своего порта), выданной при открытии страницы;
* поля проверяются валидаторами WTForms на сервере.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from flask import Flask
from werkzeug.datastructures import MultiDict

from app.schemas.responses import CsrfFailed, ValidationFailed
from app.web.forms import ApiForm

CSRF_FIELD = "csrf_token"


def to_multidict(payload: Mapping[str, Any]) -> MultiDict[str, str]:
    data: MultiDict[str, str] = MultiDict()
    for key, value in payload.items():
        if key == CSRF_FIELD or value is None:
            continue
        values = value if isinstance(value, list | tuple) else [value]
        for item in values:
            if isinstance(item, bool):
                data.add(key, "true" if item else "false")
            elif isinstance(item, str | int | float):
                data.add(key, str(item))
            else:
                raise ValidationFailed("Неверный формат данных", details={key: ["Неверный формат"]})
    return data


class FormGateway:
    def __init__(self, flask_app: Flask) -> None:
        self._app = flask_app

    def validate(
        self,
        form_cls: type[ApiForm],
        payload: Mapping[str, Any] | None,
        *,
        cookie: str,
        csrf_token: str,
    ) -> dict[str, Any]:
        formdata = to_multidict(payload or {})
        formdata[CSRF_FIELD] = csrf_token
        with self._app.test_request_context("/api", method="POST", headers={"Cookie": cookie}):
            form = form_cls(formdata=formdata)
            if form.validate():
                data = dict(form.data)
                data.pop(CSRF_FIELD, None)
                return data
            errors = {name: [str(message) for message in messages] for name, messages in form.errors.items()}
        if CSRF_FIELD in errors:
            raise CsrfFailed("Сессия страницы устарела. Обновите страницу")
        first = next(iter(errors.values()))[0]
        raise ValidationFailed(first, details=errors)
