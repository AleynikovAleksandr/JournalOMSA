-- ============================================================
-- OMSA Ledger — SQL-схема (PostgreSQL)
--
-- Соответствует моделям backend/app/models: после изменения моделей файл
-- обновляется вместе с ними.
-- Выполняется один раз — при первом запуске PostgreSQL с пустым томом данных
-- (/docker-entrypoint-initdb.d/schema.sql). Изменения схемы работающей базы
-- применяются отдельно.
--
-- Отличия от исходной схемы ТЗ (раздел 6):
--   * TUsers дополнена полями авторизации и прав (uuid, login, password_hash,
--     password_changed_at, failed_login_attempts, locked_until, group_id);
--   * добавлены TUserGroups, TRefreshTokens, TNotifications, TNotificationSubscriptions;
--   * TSolution.is_final — статус, завершающий задачу (прекращает уведомления);
--   * TJournal.isEdit заменено: блокировка записи от одновременного
--     редактирования хранится в Redis, а столбец version защищает от потери
--     изменений (оптимистическая блокировка).
-- ============================================================

CREATE TABLE "TCategory" (
	id SERIAL NOT NULL,
	-- Категория
	name VARCHAR(100) NOT NULL,
	-- Описание
	description TEXT,
	CONSTRAINT "pk_TCategory" PRIMARY KEY (id),
	CONSTRAINT "uq_TCategory_name" UNIQUE (name)
);

COMMENT ON TABLE "TCategory" IS 'Категории аттестуемых лиц';


CREATE TABLE "TOptions" (
	id SERIAL NOT NULL,
	-- Адрес
	adress VARCHAR(250),
	-- Должность
	position VARCHAR(150),
	-- ФИО
	"FIO" VARCHAR(150),
	CONSTRAINT "pk_TOptions" PRIMARY KEY (id)
);

COMMENT ON TABLE "TOptions" IS 'Справочник реквизитов и настроек';


CREATE TABLE "TOrganization" (
	id SERIAL NOT NULL,
	-- Организация
	name VARCHAR(150) NOT NULL,
	-- Адрес
	adress VARCHAR(150),
	-- Телефон
	phone VARCHAR(50),
	-- Контактное лицо
	"FIOContact" VARCHAR(150),
	-- Почта
	mail VARCHAR(100),
	-- Примечание
	comments VARCHAR(150),
	CONSTRAINT "pk_TOrganization" PRIMARY KEY (id)
);

COMMENT ON TABLE "TOrganization" IS 'Организации';


CREATE TABLE "TSolution" (
	id SERIAL NOT NULL,
	-- Готовность решения
	name VARCHAR(100) NOT NULL,
	-- Статус завершает задачу и прекращает уведомления
	is_final BOOLEAN DEFAULT false NOT NULL,
	CONSTRAINT "pk_TSolution" PRIMARY KEY (id),
	CONSTRAINT "uq_TSolution_name" UNIQUE (name)
);

COMMENT ON TABLE "TSolution" IS 'Готовность решения (статусы записей журнала)';


CREATE TABLE "TTypeChecks" (
	id SERIAL NOT NULL,
	-- Вид проверки
	name VARCHAR(150) NOT NULL,
	CONSTRAINT "pk_TTypeChecks" PRIMARY KEY (id),
	CONSTRAINT "uq_TTypeChecks_name" UNIQUE (name)
);

COMMENT ON TABLE "TTypeChecks" IS 'Виды проверок';


CREATE TABLE "TUserGroups" (
	id SERIAL NOT NULL,
	-- Наименование группы
	name VARCHAR(150) NOT NULL,
	-- Группа «Архив (уволенные)»: показывает уволенных сотрудников
	is_archive BOOLEAN DEFAULT false NOT NULL,
	CONSTRAINT "pk_TUserGroups" PRIMARY KEY (id),
	CONSTRAINT "uq_TUserGroups_name" UNIQUE (name)
);

COMMENT ON TABLE "TUserGroups" IS 'Группы (роли) пользователей';


CREATE TABLE "TGroups" (
	id SERIAL NOT NULL,
	-- Дата
	dates DATE NOT NULL,
	-- Время (ЧЧ:ММ)
	times VARCHAR(5) NOT NULL,
	-- Вид проверки
	"typeChecks" INTEGER NOT NULL,
	CONSTRAINT "pk_TGroups" PRIMARY KEY (id),
	CONSTRAINT "fk_TGroups_typeChecks_TTypeChecks" FOREIGN KEY("typeChecks") REFERENCES "TTypeChecks" (id) ON DELETE RESTRICT
);

CREATE INDEX "ix_TGroups_dates" ON "TGroups" (dates);

COMMENT ON TABLE "TGroups" IS 'Проверочные группы (блоки)';


CREATE TABLE "TUsers" (
	id SERIAL NOT NULL,
	-- Идентификатор пользователя в JWT (claim sub)
	uuid UUID NOT NULL,
	-- Исполнитель
	"FIO" VARCHAR(150) NOT NULL,
	-- Профиль (строка проверки)
	profile VARCHAR(150),
	-- Права: ключи через запятую
	rules VARCHAR(150) DEFAULT '' NOT NULL,
	-- Не работает (уволен)
	"isFired" BOOLEAN DEFAULT false NOT NULL,
	-- Логин для входа
	login VARCHAR(100) NOT NULL,
	-- Хеш пароля Argon2id
	password_hash VARCHAR(255) NOT NULL,
	-- Дата и время последней смены пароля
	password_changed_at TIMESTAMP WITH TIME ZONE NOT NULL,
	-- Счётчик неудачных попыток входа
	failed_login_attempts INTEGER DEFAULT '0' NOT NULL,
	-- Время окончания блокировки входа
	locked_until TIMESTAMP WITH TIME ZONE,
	-- Группа (роль)
	group_id INTEGER NOT NULL,
	CONSTRAINT "pk_TUsers" PRIMARY KEY (id),
	CONSTRAINT "uq_TUsers_uuid" UNIQUE (uuid),
	CONSTRAINT "uq_TUsers_login" UNIQUE (login),
	CONSTRAINT "fk_TUsers_group_id_TUserGroups" FOREIGN KEY(group_id) REFERENCES "TUserGroups" (id) ON DELETE RESTRICT
);

CREATE INDEX "ix_TUsers_group_id" ON "TUsers" (group_id);

COMMENT ON TABLE "TUsers" IS 'Сотрудники (исполнители)';


CREATE TABLE "TJournal" (
	id SERIAL NOT NULL,
	-- Группа
	groups INTEGER NOT NULL,
	-- Порядковый номер в группе
	nomber INTEGER NOT NULL,
	-- ФИО аттестуемого лица
	"nameFIO" VARCHAR(150) NOT NULL,
	-- Категория из справочника
	category INTEGER,
	-- Категория, введённая для записи
	category_name VARCHAR(100),
	-- Организация
	organization INTEGER NOT NULL,
	-- Исполнитель
	users INTEGER NOT NULL,
	-- Готовность решения
	solution INTEGER NOT NULL,
	-- Примечание
	comments VARCHAR(250),
	-- Версия записи (оптимистическая блокировка)
	version INTEGER DEFAULT '1' NOT NULL,
	CONSTRAINT "pk_TJournal" PRIMARY KEY (id),
	CONSTRAINT "fk_TJournal_groups_TGroups" FOREIGN KEY(groups) REFERENCES "TGroups" (id) ON DELETE CASCADE,
	CONSTRAINT "fk_TJournal_category_TCategory" FOREIGN KEY(category) REFERENCES "TCategory" (id) ON DELETE RESTRICT,
	CONSTRAINT "fk_TJournal_organization_TOrganization" FOREIGN KEY(organization) REFERENCES "TOrganization" (id) ON DELETE RESTRICT,
	CONSTRAINT "fk_TJournal_users_TUsers" FOREIGN KEY(users) REFERENCES "TUsers" (id) ON DELETE RESTRICT,
	CONSTRAINT "fk_TJournal_solution_TSolution" FOREIGN KEY(solution) REFERENCES "TSolution" (id) ON DELETE RESTRICT
);

CREATE INDEX "ix_TJournal_groups" ON "TJournal" (groups);

CREATE INDEX "ix_TJournal_users" ON "TJournal" (users);

COMMENT ON TABLE "TJournal" IS 'Журнал проверок';


CREATE TABLE "TNotificationSubscriptions" (
	id SERIAL NOT NULL,
	-- Пользователь
	user_uuid UUID NOT NULL,
	-- Разрешение браузера: granted, denied, default, unsupported
	permission VARCHAR(16) NOT NULL,
	-- Браузер
	user_agent VARCHAR(255) NOT NULL,
	-- Первая регистрация
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	-- Последнее обновление
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	CONSTRAINT "pk_TNotificationSubscriptions" PRIMARY KEY (id),
	CONSTRAINT "uq_TNotificationSubscriptions_user_uuid_user_agent" UNIQUE (user_uuid, user_agent),
	CONSTRAINT "fk_TNotificationSubscriptions_user_uuid_TUsers" FOREIGN KEY(user_uuid) REFERENCES "TUsers" (uuid) ON DELETE CASCADE
);

COMMENT ON TABLE "TNotificationSubscriptions" IS 'Браузеры, получающие уведомления';


CREATE TABLE "TPushSubscriptions" (
	id SERIAL NOT NULL,
	-- Получатель
	user_uuid UUID NOT NULL,
	-- Web-сессия получателя
	session_id UUID NOT NULL,
	-- Адрес push-сервиса браузера
	endpoint TEXT NOT NULL,
	-- Открытый ключ браузера
	p256dh VARCHAR(128) NOT NULL,
	-- Секрет шифрования браузера
	auth VARCHAR(64) NOT NULL,
	-- Создание подписки
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	-- Обновление подписки
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
	CONSTRAINT "pk_TPushSubscriptions" PRIMARY KEY (id),
	CONSTRAINT "fk_TPushSubscriptions_user_uuid_TUsers" FOREIGN KEY(user_uuid) REFERENCES "TUsers" (uuid) ON DELETE CASCADE,
	CONSTRAINT "uq_TPushSubscriptions_endpoint" UNIQUE (endpoint)
);

CREATE INDEX "ix_TPushSubscriptions_session_id" ON "TPushSubscriptions" (session_id);

CREATE INDEX "ix_TPushSubscriptions_user_uuid" ON "TPushSubscriptions" (user_uuid);

COMMENT ON TABLE "TPushSubscriptions" IS 'Подписки браузеров на Web Push';


CREATE TABLE "TRefreshTokens" (
	-- Значение refresh-токена
	id UUID NOT NULL,
	-- Пользователь
	user_uuid UUID NOT NULL,
	-- Сервис входа: web (5600) или admin (5620)
	portal VARCHAR(10) NOT NULL,
	-- Сессия входа: общая для обновлений токена и для перехода из журнала в управление пользователями
	session_id UUID NOT NULL,
	-- Время выдачи
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	-- Время окончания действия
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	-- Браузер (аудит сессий)
	user_agent VARCHAR(255),
	-- IP-адрес (аудит сессий)
	ip VARCHAR(45),
	CONSTRAINT "pk_TRefreshTokens" PRIMARY KEY (id),
	CONSTRAINT "fk_TRefreshTokens_user_uuid_TUsers" FOREIGN KEY(user_uuid) REFERENCES "TUsers" (uuid) ON DELETE CASCADE
);

CREATE INDEX "ix_TRefreshTokens_expires_at" ON "TRefreshTokens" (expires_at);

CREATE INDEX "ix_TRefreshTokens_session_id" ON "TRefreshTokens" (session_id);

CREATE INDEX "ix_TRefreshTokens_user_uuid" ON "TRefreshTokens" (user_uuid);

COMMENT ON TABLE "TRefreshTokens" IS 'Refresh-токены (сессии пользователей)';


CREATE TABLE "TNotifications" (
	id SERIAL NOT NULL,
	-- Задача (запись журнала)
	journal_id INTEGER NOT NULL,
	-- Исполнитель, которому адресовано
	user_uuid UUID NOT NULL,
	-- Вид события
	kind VARCHAR(20) NOT NULL,
	-- Расчётный момент показа
	fire_at TIMESTAMP WITH TIME ZONE NOT NULL,
	-- Момент подтверждения показа (ack)
	shown_at TIMESTAMP WITH TIME ZONE,
	-- Время формирования
	created_at TIMESTAMP WITH TIME ZONE NOT NULL,
	CONSTRAINT "pk_TNotifications" PRIMARY KEY (id),
	CONSTRAINT "uq_TNotifications_journal_id_user_uuid_kind_fire_at" UNIQUE (journal_id, user_uuid, kind, fire_at),
	CONSTRAINT "ck_TNotifications_kind" CHECK (kind IN ('assigned', 'remind_24h', 'remind_1h', 'due', 'overdue', 'changed')),
	CONSTRAINT "fk_TNotifications_journal_id_TJournal" FOREIGN KEY(journal_id) REFERENCES "TJournal" (id) ON DELETE CASCADE,
	CONSTRAINT "fk_TNotifications_user_uuid_TUsers" FOREIGN KEY(user_uuid) REFERENCES "TUsers" (uuid) ON DELETE CASCADE
);

CREATE INDEX "ix_TNotifications_journal_id" ON "TNotifications" (journal_id);

CREATE INDEX "ix_TNotifications_pending" ON "TNotifications" (user_uuid, shown_at, fire_at);

COMMENT ON TABLE "TNotifications" IS 'Уведомления по задачам';


CREATE TABLE "TPushDeliveries" (
	id SERIAL NOT NULL,
	-- Уведомление
	notification_id INTEGER NOT NULL,
	-- Браузер
	subscription_id INTEGER NOT NULL,
	-- Push-сервис принял сообщение
	delivered_at TIMESTAMP WITH TIME ZONE NOT NULL,
	CONSTRAINT "pk_TPushDeliveries" PRIMARY KEY (id),
	CONSTRAINT "uq_TPushDeliveries_notification_id_subscription_id" UNIQUE (notification_id, subscription_id),
	CONSTRAINT "fk_TPushDeliveries_notification_id_TNotifications" FOREIGN KEY(notification_id) REFERENCES "TNotifications" (id) ON DELETE CASCADE,
	CONSTRAINT "fk_TPushDeliveries_subscription_id_TPushSubscriptions" FOREIGN KEY(subscription_id) REFERENCES "TPushSubscriptions" (id) ON DELETE CASCADE
);

CREATE INDEX "ix_TPushDeliveries_notification_id" ON "TPushDeliveries" (notification_id);

CREATE INDEX "ix_TPushDeliveries_subscription_id" ON "TPushDeliveries" (subscription_id);

COMMENT ON TABLE "TPushDeliveries" IS 'Отправленные Web Push уведомления';


