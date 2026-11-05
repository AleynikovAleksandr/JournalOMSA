"""Права сотрудников (ТЗ, раздел 10).

Права выбранного сотрудника сохраняются одной строкой в поле TUsers.rules —
ключи через запятую, например «grpAdd,grpEdit,menuRefs».

Права jrnOwnOnly и jrnStatusOnly — ограничения: включённое право сужает
доступ к журналу. Поэтому переключатель «Полные права» включает все
разрешающие права и снимает ограничения, а не включает их.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Right:
    key: str
    label: str
    description: str
    restrictive: bool = False


@dataclass(frozen=True, slots=True)
class RightGroup:
    title: str
    items: tuple[Right, ...]


GRP_ADD = "grpAdd"
GRP_EDIT = "grpEdit"
GRP_DEL = "grpDel"
MENU_REFS = "menuRefs"
MENU_SETTINGS = "menuSettings"
JRN_OWN_ONLY = "jrnOwnOnly"
JRN_STATUS_ONLY = "jrnStatusOnly"
JRN_DEL = "jrnDel"
USR_EDIT = "usrEdit"

RIGHTS_TREE: tuple[RightGroup, ...] = (
    RightGroup(
        "Группы",
        (
            Right(GRP_ADD, "Добавление", "Создавать новые блоки проверок"),
            Right(GRP_EDIT, "Изменение", "Редактировать существующие блоки"),
            Right(GRP_DEL, "Удаление", "Удалять блоки проверок целиком"),
        ),
    ),
    RightGroup(
        "Доступ к меню",
        (
            Right(MENU_REFS, "Справочники", "Открывать справочник организаций"),
            Right(MENU_SETTINGS, "Настройки", "Открывать окно управления пользователями — админский доступ"),
        ),
    ),
    RightGroup(
        "Журнал",
        (
            Right(
                JRN_OWN_ONLY,
                "Редактирование только своих задач",
                "Правка только записей, где сотрудник указан исполнителем",
                restrictive=True,
            ),
            Right(
                JRN_STATUS_ONLY,
                "Редактирование только статуса",
                "В карточке доступен только статус готовности решения, остальные поля заблокированы",
                restrictive=True,
            ),
            Right(JRN_DEL, "Удаление", "Удалять отдельные записи журнала"),
        ),
    ),
    RightGroup(
        "Сотрудники",
        (
            Right(
                USR_EDIT,
                "Редактирование данных сотрудника",
                "Править карточку сотрудника: ФИО, логин, пароль, группу, признак увольнения",
            ),
        ),
    ),
)

RIGHT_KEYS: tuple[str, ...] = tuple(item.key for group in RIGHTS_TREE for item in group.items)
RESTRICTIVE_KEYS: frozenset[str] = frozenset(
    item.key for group in RIGHTS_TREE for item in group.items if item.restrictive
)
GRANT_KEYS: frozenset[str] = frozenset(RIGHT_KEYS) - RESTRICTIVE_KEYS

# Права нового сотрудника: только просмотр и правка статуса своих задач
DEFAULT_RIGHTS: frozenset[str] = frozenset({JRN_OWN_ONLY, JRN_STATUS_ONLY})
# «Полные права»: все разрешающие права без ограничений
FULL_RIGHTS: frozenset[str] = GRANT_KEYS


def parse_rules(rules: str | None) -> frozenset[str]:
    if not rules:
        return frozenset()
    tokens = rules.replace(";", ",").replace(" ", ",").split(",")
    return frozenset(token for token in (t.strip() for t in tokens) if token in RIGHT_KEYS)


def format_rules(rights: Iterable[str]) -> str:
    selected = set(rights)
    unknown = selected - set(RIGHT_KEYS)
    if unknown:
        raise ValueError(f"Неизвестные права: {', '.join(sorted(unknown))}")
    return ",".join(key for key in RIGHT_KEYS if key in selected)
