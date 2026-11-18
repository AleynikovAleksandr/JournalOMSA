"""Права групп сотрудников (ТЗ, раздел 10).

Настроенные права группы хранятся в TUserGroups.rules. Поле TUsers.rules
хранит личные права или копию групповых прав. Маркер ! в начале строки
отмечает личный набор без дополнительной колонки в базе.

Право jrnOwnOnly ограничивает работу своими задачами. Право jrnStatusOnly
отдельно разрешает менять статус. «Полные права» включают разрешения и
снимают ограничение на свои задачи.
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
    details: str = ""
    admin_only: bool = False


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
ADMIN_ONLY_RIGHTS: frozenset[str] = frozenset({GRP_EDIT, GRP_DEL, MENU_SETTINGS, JRN_DEL})

RIGHTS_TREE: tuple[RightGroup, ...] = (
    RightGroup(
        "Группы",
        (
            Right(
                GRP_ADD,
                "Добавление",
                "Создавать группы и добавлять в них аттестуемых",
                details=(
                    "Позволяет создать группу с датой, временем и видом проверки, "
                    "а также добавлять аттестуемых в уже существующую группу."
                ),
            ),
            Right(
                GRP_EDIT,
                "Изменение",
                "Редактировать группы и записи журнала",
                details=(
                    "Позволяет изменить одну выбранную карточку своей или чужой задачи: "
                    "дату, время, вид проверки, данные аттестуемого и примечание. "
                    "Остальные записи группы не меняются. "
                    "При ограничении «Редактирование только своих задач» чужие карточки недоступны, "
                    "Для изменения статуса требуется отдельное право «Редактирование только статуса». "
                    "Это право назначается только участникам группы «Администраторы»."
                ),
                admin_only=True,
            ),
            Right(
                GRP_DEL,
                "Удаление",
                "Удалять блоки проверок целиком",
                details=(
                    "Удаляет группу со всеми записями аттестуемых внутри неё. "
                    "Напоминания по этим записям тоже удаляются. "
                    "Право назначается только участникам группы «Администраторы»."
                ),
                admin_only=True,
            ),
        ),
    ),
    RightGroup(
        "Доступ к меню",
        (
            Right(
                MENU_REFS,
                "Справочники",
                "Открывать справочник организаций",
                details="Позволяет вести организации и добавлять виды проверок и статусы. Использованную в журнале организацию удалить нельзя.",
            ),
            Right(
                MENU_SETTINGS,
                "Настройки",
                "Управлять сотрудниками, группами и правами",
                details="Открывает админку для управления сотрудниками, группами и правами. Назначается только участникам группы «Администраторы».",
                admin_only=True,
            ),
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
                details="Чужие задачи остаются видны, но менять их нельзя. Новую задачу сотрудник может назначить только себе.",
            ),
            Right(
                JRN_STATUS_ONLY,
                "Редактирование только статуса",
                "Разрешает менять статус своей задачи; остальные поля зависят от других прав",
                details="Даёт право менять статус своей задачи, даже если редактирование других полей не разрешено. Право «Редактирование только своих задач» также позволяет менять статус своей задачи. Участники группы «Администраторы» могут менять статус чужих задач, если у них есть это право.",
            ),
            Right(
                JRN_DEL,
                "Удаление записи журнала",
                "Удалять отдельные записи журнала",
                details=(
                    "Удаляется одна строка с её напоминаниями; проверочная группа и остальные аттестуемые сохраняются. "
                    "Право назначается только участникам группы «Администраторы»."
                ),
                admin_only=True,
            ),
        ),
    ),
)

RIGHT_KEYS: tuple[str, ...] = tuple(item.key for group in RIGHTS_TREE for item in group.items)
RESTRICTIVE_KEYS: frozenset[str] = frozenset(
    item.key for group in RIGHTS_TREE for item in group.items if item.restrictive
)
GRANT_KEYS: frozenset[str] = frozenset(RIGHT_KEYS) - RESTRICTIVE_KEYS

# Права нового сотрудника: просмотр и редактирование своих задач
DEFAULT_RIGHTS: frozenset[str] = frozenset({JRN_OWN_ONLY, JRN_STATUS_ONLY})
# «Полные права»: все разрешающие права без ограничений
FULL_RIGHTS: frozenset[str] = GRANT_KEYS
# Группе «Администраторы» по умолчанию не назначается право изменения статуса.
ADMIN_DEFAULT_RIGHTS: frozenset[str] = FULL_RIGHTS - {JRN_STATUS_ONLY}

# Маркер в TUsers.rules отличает личные права от копии прав группы без изменения схемы БД.
USER_RIGHTS_OVERRIDE = "!"


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


def has_personal_rules(rules: str | None) -> bool:
    return rules == USER_RIGHTS_OVERRIDE or bool(rules and rules.startswith(USER_RIGHTS_OVERRIDE + ","))


def format_personal_rules(rights: Iterable[str]) -> str:
    formatted = format_rules(rights)
    return USER_RIGHTS_OVERRIDE + ("," + formatted if formatted else "")
