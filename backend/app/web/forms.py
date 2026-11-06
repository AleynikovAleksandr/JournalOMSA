"""Формы Flask-WTF / WTForms.

Все данные, которые пользователь вводит на страницах, проверяются на сервере
этими формами (ТЗ, 3.2.3 и раздел 12): страницы отправляют их в JSON-API,
а API пропускает каждое изменяющее обращение через соответствующую форму
вместе с CSRF-токеном Flask-WTF (app/web/form_gateway.py).
"""

from __future__ import annotations

from flask_wtf import FlaskForm
from wtforms import (
    BooleanField,
    DateField,
    IntegerField,
    PasswordField,
    SelectField,
    SelectMultipleField,
    StringField,
    TextAreaField,
)
from wtforms.validators import DataRequired, Email, Length, NumberRange, Optional, Regexp

from app.services.access_control.rights import RIGHT_KEYS
from app.services.authentication.passwords import MIN_PASSWORD_LENGTH

TIME_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d$"
LOGIN_PATTERN = r"^[A-Za-z0-9._@\-]+$"


def _strip(value):
    return value.strip() if isinstance(value, str) else value


def _required(message: str) -> DataRequired:
    # DataRequired проверяет значение после фильтров: строка из пробелов не проходит
    return DataRequired(message=message)


def _id_field(message: str, *, required: bool = True) -> IntegerField:
    validators = [_required(message) if required else Optional(), NumberRange(min=1, message="Неверное значение")]
    return IntegerField(validators=validators)


class ApiForm(FlaskForm):
    """Базовая форма JSON-API. CSRF-токен приходит в заголовке X-CSRFToken."""

    class Meta:
        locales = ("ru_RU", "ru")


class CsrfOnlyForm(ApiForm):
    """Действие без полей (удаление, подтверждение показа): проверяется только CSRF-токен."""


# ---------------------------------------------------------------------------
# Вход и учётная запись
# ---------------------------------------------------------------------------
class LoginForm(ApiForm):
    login = StringField(validators=[_required("Введите логин"), Length(max=100)], filters=[_strip])
    password = PasswordField(validators=[_required("Введите пароль"), Length(max=256)])


class ChangePasswordForm(ApiForm):
    old_password = PasswordField(validators=[_required("Введите текущий пароль"), Length(max=256)])
    new_password = PasswordField(
        validators=[
            _required("Введите новый пароль"),
            Length(min=MIN_PASSWORD_LENGTH, max=256, message="Пароль: от %(min)d до %(max)d символов"),
        ]
    )


# ---------------------------------------------------------------------------
# Журнал
# ---------------------------------------------------------------------------
class CheckGroupForm(ApiForm):
    date = DateField(format="%Y-%m-%d", validators=[_required("Укажите дату")])
    time = StringField(validators=[_required("Укажите время"), Regexp(TIME_PATTERN, message="Время в формате ЧЧ:ММ")])
    type_check_id = _id_field("", required=False)
    type_check_name = StringField(validators=[Optional(), Length(max=150)], filters=[_strip])


class JournalRecordForm(ApiForm):
    group_id = _id_field("", required=False)
    date = DateField(format="%Y-%m-%d", validators=[_required("Укажите дату")])
    time = StringField(validators=[_required("Укажите время"), Regexp(TIME_PATTERN, message="Время в формате ЧЧ:ММ")])
    type_check_id = _id_field("", required=False)
    type_check_name = StringField(validators=[Optional(), Length(max=150)], filters=[_strip])
    fio = StringField(
        validators=[_required("Укажите ФИО аттестуемого лица"), Length(max=150, message="Не более 150 символов")],
        filters=[_strip],
    )
    category_id = _id_field("", required=False)
    category_name = StringField(validators=[Optional(), Length(max=100)], filters=[_strip])
    organization_id = _id_field("Укажите организацию")
    executor_id = _id_field("Укажите исполнителя")
    solution_id = _id_field("", required=False)
    solution_name = StringField(validators=[Optional(), Length(max=100)], filters=[_strip])
    note = TextAreaField(validators=[Optional(), Length(max=250, message="Не более 250 символов")])
    version = IntegerField(validators=[Optional()])


class StatusForm(ApiForm):
    solution_id = _id_field("", required=False)
    solution_name = StringField(validators=[Optional(), Length(max=100)], filters=[_strip])
    version = IntegerField(validators=[Optional()])


class OptionsForm(ApiForm):
    address = StringField(validators=[Optional(), Length(max=250)], filters=[_strip])
    position = StringField(validators=[Optional(), Length(max=150)], filters=[_strip])
    fio = StringField(validators=[Optional(), Length(max=150)], filters=[_strip])


class NoteForm(ApiForm):
    note = TextAreaField(validators=[Optional(), Length(max=250, message="Не более 250 символов")])
    version = IntegerField(validators=[Optional()])


# ---------------------------------------------------------------------------
# Справочник организаций
# ---------------------------------------------------------------------------
class OrganizationForm(ApiForm):
    name = StringField(
        validators=[_required("Укажите наименование организации"), Length(max=150, message="Не более 150 символов")],
        filters=[_strip],
    )
    address = StringField(validators=[Optional(), Length(max=150, message="Не более 150 символов")])
    phone = StringField(
        validators=[
            Optional(),
            Length(max=50, message="Не более 50 символов"),
            Regexp(r"^[0-9+()\-\s.,;доб]*$", message="Телефон содержит недопустимые символы"),
        ]
    )
    contact = StringField(validators=[Optional(), Length(max=150, message="Не более 150 символов")])
    email = StringField(
        validators=[Optional(), Length(max=100, message="Не более 100 символов"), Email(message="Неверный e-mail")],
        filters=[_strip],
    )
    note = StringField(validators=[Optional()])


# ---------------------------------------------------------------------------
# Пользователи и группы
# ---------------------------------------------------------------------------
class _UserFieldsForm(ApiForm):
    fio = StringField(
        validators=[_required("Заполните ФИО"), Length(max=150, message="Не более 150 символов")], filters=[_strip]
    )
    login = StringField(
        validators=[
            _required("Введите логин"),
            Length(max=100, message="Не более 100 символов"),
            Regexp(LOGIN_PATTERN, message="Логин: латинские буквы, цифры и символы . _ @ -"),
        ],
        filters=[_strip],
    )
    profile = StringField(validators=[Optional(), Length(max=150, message="Не более 150 символов")])
    group_id = _id_field("Выберите группу")
    is_fired = BooleanField()


class UserCreateForm(_UserFieldsForm):
    password = PasswordField(
        validators=[
            _required("Введите пароль"),
            Length(min=MIN_PASSWORD_LENGTH, max=256, message="Пароль: от %(min)d до %(max)d символов"),
        ]
    )
    rights = SelectMultipleField(choices=[(key, key) for key in RIGHT_KEYS], validate_choice=True)


class UserUpdateForm(_UserFieldsForm):
    # Пустой пароль — пароль не меняется
    password = PasswordField(
        validators=[
            Optional(),
            Length(min=MIN_PASSWORD_LENGTH, max=256, message="Пароль: от %(min)d до %(max)d символов"),
        ]
    )


class FiredForm(ApiForm):
    is_fired = BooleanField()


class RightsForm(ApiForm):
    rights = SelectMultipleField(choices=[(key, key) for key in RIGHT_KEYS], validate_choice=True)


class UserGroupForm(ApiForm):
    name = StringField(
        validators=[_required("Укажите название группы"), Length(max=150, message="Не более 150 символов")],
        filters=[_strip],
    )


# ---------------------------------------------------------------------------
# Уведомления
# ---------------------------------------------------------------------------
class SubscribeForm(ApiForm):
    permission = SelectField(
        choices=[(value, value) for value in ("granted", "denied", "default", "unsupported")],
        validators=[_required("Укажите состояние разрешения")],
    )


class PushSubscribeForm(ApiForm):
    endpoint = StringField(validators=[_required("Укажите адрес подписки"), Length(max=2048)])
    p256dh = StringField(validators=[_required("Укажите ключ браузера"), Length(max=128)])
    auth = StringField(validators=[_required("Укажите секрет браузера"), Length(max=64)])
