# OMSA Ledger

Веб-приложение для ведения журнала проверок аттестуемых лиц и учёта решений об их
допуске к проведению проверок (техническое задание «ТЗ_OMSA_Ledger»).

## Состав

| Сервис | Порт | Назначение |
| --- | --- | --- |
| web | 5600 | Вход (`/login`) и журнал проверок (`/journal`) |
| admin | 5620 | Вход в систему управления пользователями (`/login`) и управление пользователями (`/users`), право «Настройки» |
| worker | — | Celery: повторные напоминания о незавершённых задачах, очистка просроченных refresh-токенов |
| beat | — | Celery beat — единственный планировщик |
| postgres | 5490 | PostgreSQL 18.6, только внутри кластера (контейнер слушает 5432) |
| redis | 6399 | Redis Stack, только внутри кластера (контейнер слушает 6379): брокер Celery, лимит входа по IP, блокировки записей, Pub/Sub для WebSocket |
| nginx | 91, 443, 449, 5600, 5620 | Приложение работает через Nginx; HTTPS на внешнем 443 |

Сервисы web и admin собираются из одного образа и различаются переменной `APP_MODULE`:
`app.main:create_portal_app('web')` и `app.main:create_portal_app('admin')` — Gunicorn вызывает
функцию сборки `app.main.create_portal_app`. Каждый процесс Gunicorn (воркер
`uvicorn_worker.UvicornWorker`) обслуживает REST/JSON-API на FastAPI (`/api/*`),
WebSocket (`/ws`), проверку работоспособности (`/health`) и страницы Flask.

## Технический стек

Flask, Flask-SQLAlchemy + SQLAlchemy, Flask-WTF + WTForms, FastAPI, Gunicorn,
PostgreSQL, Redis, Celery, Casbin, Argon2id, JWT.

## Структура

```text
backend/
  app/
    models/          модели ORM (таблицы ТЗ, раздел 6)
    repositories/    работа с БД, единица работы
    interfaces/      протоколы, от которых зависят сервисы
    schemas/         схема настроек, входные команды, ответы и ошибки API
    services/        бизнес-логика: вход, журнал, уведомления, права, пользователи
    api/routers/     REST/JSON-API (ТЗ, раздел 5), WebSocket
    web/             страницы Flask, формы WTForms
    container.py     сборка зависимостей
    main.py          сборка приложения сервиса web (5600) или admin (5620)
  core/              загрузка настроек (config.py), время, журналы
    security/        хеширование паролей Argon2id, JWT, лимиты входа
    interprocess/    Redis: подключение, блокировки записей, события WebSocket
  casbin_security/   модель и политики прав (Casbin)
  database/          подключение, schema.sql, initial_data.py
  gunicorn/          gunicorn.conf.py
  templates/         страницы (макеты Login, login_admin_panel, journal, User management)
  static/            css, js, images
worker/              Celery: приложение и задачи
Proto/               описание сообщений и сервисов (Protocol Buffers)
nginx/               Dockerfile Nginx 1.28.0, конфигурация и управление ACME-сертификатами
deploy_k8s/          манифесты Kubernetes (base + overlays/prod)
scripts/             запуск Gunicorn, развёртывание в Kubernetes
```

## Безопасность

* Пароли — только хеш Argon2id; вход ограничен пятью попытками с блокировкой на 15 минут
  (общий счётчик для обоих портов) и дополнительным лимитом по IP-адресу в Redis.
* JWT живёт 15 минут, refresh-токен (UUID в таблице `TRefreshTokens`) — в HttpOnly-cookie
  `omsa_refresh` / `omsa_admin_refresh` с `Path=/api/auth`, при обновлении заменяется новым.
* Переход из журнала в управление пользователями — без повторного ввода логина и пароля:
  ссылка «Управление пользователями» ведёт на `/api/auth/admin-handoff` (5600). Сервис web
  проверяет сессию журнала и право «Настройки» и передаёт сервису admin одноразовый билет
  (256 бит, в Redis только SHA-256, действует 60 секунд); `/api/auth/sso` (5620) обменивает его
  на сессию управления пользователями. Она связана с сессией журнала (`session_id` в
  `TRefreshTokens`): выход из журнала завершает и её. Без входа в журнал, после выхода из него
  или при прямом открытии `https://85.95.150.8:5620/login` требуются логин и пароль.
* Токен, выданный раньше `password_changed_at`, отклоняется; при смене пароля удаляются все
  refresh-токены и закрываются WebSocket-соединения пользователя (через Redis Pub/Sub).
* Все изменяющие запросы проверяются формами Flask-WTF / WTForms вместе с CSRF-токеном.
* Content-Security-Policy `script-src 'self'`, `connect-src` только свой порт; WebRTC
  отключается первым скриптом каждой страницы (`static/js/webrtc_control.js`).
* Права проверяются на сервере при каждом действии (Casbin + правила журнала
  «только своих задач» и «только статуса»); уволенный сотрудник видит только свои задачи.
  В управлении пользователями права назначаются раскрытой группе и применяются ко всем её
  сотрудникам, включая добавленных позже. Старые индивидуальные права действуют до первого
  сохранения прав соответствующей группы.

## Уведомления

Сервер записывает в `TNotifications` уведомления о назначении, напоминания за сутки и за час,
наступлении времени и изменении задачи; повторные напоминания о незавершённой задаче раз в час
досоздаёт Celery beat. Тексты, ссылка на карточку и маленькая иконка `brand.png` заданы в одном
`backend/static/notifications/notification-manifest.json`. Этот JSON формирует одинаковые заголовок, текст,
логотип и действия «Открыть» / «Понятно» для карточки в журнале и системного уведомления.
Внешний вид и доступность кнопок системного уведомления зависят от браузера и ОС.

Если браузер разрешил системные уведомления, страница регистрирует Service Worker и Web Push
подписку, привязанную к текущей web-сессии. Задача Celery `notifications.send_due_push` раз в минуту
отправляет ожидающие события через `pywebpush`, в том числе при закрытой вкладке. После успешной
отправки событие помечается показанным, чтобы карточка в журнале не дублировала его. При отказе
push-сервиса уведомление остаётся ожидающим и может быть показано при следующем входе.
«Открыть» ведёт к задаче, «Понятно» закрывает уведомление без завершения задачи.
При запрете или недоступности системного показа журнал показывает карточку внутри интерфейса.
Открытая вкладка по-прежнему опрашивает `GET /api/notifications/pending` раз в минуту и получает
подсказки WebSocket. Подтверждение показа (`ack`) не завершает задачу; новые напоминания
прекращаются при её завершении. При выходе из журнала его Web Push подписки удаляются.

Для Web Push нужны постоянные VAPID-ключи: `WEB_PUSH_PRIVATE_KEY` (32 байта в Base64URL),
`WEB_PUSH_PUBLIC_KEY` (несжатый ключ P-256, 65 байт в Base64URL) и `WEB_PUSH_SUBJECT`
(действующий HTTPS-адрес или `mailto:`). Ключи должны совпадать в web и worker; при смене
ключей браузеры подпишутся заново. Пустая пара ключей отключает Web Push, сохраняя показ
в открытой вкладке. В текущих локальном и production Secret файлах пары созданы отдельно;
эти файлы исключены из Git. Для уже работающей PostgreSQL новые таблицы создаёт init-контейнер
при очередном запуске `database.initial_data`.


## Схема базы данных

`backend/database/schema.sql` описывает таблицы так же, как модели `backend/app/models`;
после изменения моделей файл обновляется вместе с ними.

PostgreSQL выполняет файл один раз — при первом запуске с пустым томом. Справочники
(ТЗ, раздел 11) и первичного администратора (`ADMIN_LOGIN` / `ADMIN_PASSWORD`) создаёт
`python -m database.initial_data` — init-контейнер пода web.

## Развёртывание в Kubernetes

1. Собрать и загрузить образы (тег — номер выпуска или хеш коммита). Сервисы worker и beat
   используют один образ worker; Nginx использует официальный образ 1.28.0:

   ```bash
   REGISTRY=registry.example.local/omsa-ledger APP_VERSION=1.0.0
   docker build -f backend/Dockerfile --build-arg APP_VERSION=$APP_VERSION -t $REGISTRY/backend:$APP_VERSION .
   docker build -f worker/Dockerfile --build-arg APP_VERSION=$APP_VERSION -t $REGISTRY/worker:$APP_VERSION .
   docker build -f nginx/Dockerfile -t $REGISTRY/nginx:1.28.0 .
   docker push $REGISTRY/backend:$APP_VERSION
   docker push $REGISTRY/worker:$APP_VERSION
   docker push $REGISTRY/nginx:1.28.0
   ```

2. Указать теги образов в `deploy_k8s/overlays/prod/patches/image-tag.yaml`, настройки приложения —
   в `secret.yaml` (раздел «Секреты»), IP-адрес и разрешённые сети админки и параметры
   Gunicorn — в `configmap.yaml`.
3. На одноузловом Kubernetes постоянные данные PostgreSQL, Redis и логи находятся
   в `~/JournalOMSA/service_data` на узле: `postgres/`, `redis/`, `nginx/`, `gunicorn/`, `celery/`.
   Kubernetes подключает существующие каталоги через статические PV/PVC без копирования данных;
   в PodSpec используются PVC, поэтому Pod Security `restricted` допускает тома. Настройте резервное
   копирование каталога отдельно.
4. Запустить — всё управление кластером идёт через `scripts/deploy_k8s.sh`:

   ```bash
   scripts/deploy_k8s.sh start                # запустить или обновить всё
   scripts/deploy_k8s.sh stop                 # остановить всё, данные сохраняются
   scripts/deploy_k8s.sh restart              # перезапустить все сервисы, включая Nginx
   scripts/deploy_k8s.sh status               # поды, сервисы, тома
   scripts/deploy_k8s.sh render               # только вывести манифесты
   ```

   * `start` применяет манифесты, дожидается PostgreSQL и Redis и ждёт готовности всех
     сервисов, включая Nginx. Если приложение уже работало, поды `web`, `admin` (Gunicorn), `worker`, `beat`
     (Celery) плавно перезапускаются: переменные окружения читаются только при старте пода,
     а так поды получают новые значения `configmap.yaml` и `secret.yaml`. Поды `web` и `admin`
     обновляются по одному, без простоя; Nginx перезапускается вместе с ними. При первом старте после миграции удаляются прежние
     Caddy Deployment и Service; PVC `caddy-data` оставляется на месте.
   * `stop` уменьшает число подов всех сервисов до нуля: сначала Nginx, затем приложение и
     Celery, последними Redis и PostgreSQL. Тома с данными, Secret и внешний адрес
     балансировщика сохраняются, `start` поднимает всё обратно.
   * При `start` устанавливаются cert-manager и HTTP-01 ingress, затем автоматически выпускается
     и обновляется IP-сертификат Let’s Encrypt. Для проверки сертификата внешний TCP-порт `80`
     должен быть разрешён в firewall и доступен с интернета. Порт 80 перенаправляет обычные запросы
     на HTTPS; Nginx использует Secret сертификата и подхватывает обновление без пересборки образа.
   * Nginx работает в трёх репликах; каждая запрашивает 2 GiB памяти и 500m CPU (лимиты — 4 GiB
     и 500m CPU). Для IP-сертификата Let’s Encrypt используется профиль `shortlived`, поэтому
     cert-manager продлевает сертификат автоматически каждые несколько дней.
   * Внешний порт `91` также перенаправляет HTTP на HTTPS `443`; `449` остаётся дополнительным
     HTTPS-портом. Порты `5600` и `5620` сохранены.
   * Окружение — второй параметр (`scripts/deploy_k8s.sh start prod`), по умолчанию `prod`.

### Секреты

Файлы с паролями и ключами в репозиторий не добавляются (`.gitignore`); на новой машине
их создают вручную (лучше заменить на SealedSecret или ExternalSecret).

`deploy_k8s/overlays/prod/secret.yaml` — Secret `omsa-ledger-secrets` со **всеми** параметрами
`backend/app/schemas/settings.py` (имя переменной — имя поля в верхнем регистре). Приложение, Celery и
init-контейнер получают их через `envFrom`; контейнер PostgreSQL берёт оттуда `POSTGRES_USER`,
`POSTGRES_DB` и пароль — ключ `POSTGRES_PASSWORD`, переданный контейнеру PostgreSQL из Secret как переменная окружения.
Фрагмент:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: omsa-ledger-secrets
type: Opaque
stringData:
  SECRET_KEY: "<случайная строка не короче 32 символов>"
  JWT_SECRET: "<другая случайная строка не короче 32 символов>"
  POSTGRES_HOST: "postgres"
  POSTGRES_PORT: "5490"
  POSTGRES_USER: "omsa"
  POSTGRES_DB: "omsa_ledger"
  POSTGRES_PASSWORD: "<пароль PostgreSQL>"
  REDIS_HOST: "redis"
  REDIS_PORT: "6399"
  REDIS_USERNAME: "omsa_app"
  REDIS_PASSWORD: "<пароль пользователя omsa_app в Redis>"
  WEB_PUSH_PRIVATE_KEY: "<секретный VAPID-ключ Base64URL>"
  WEB_PUSH_PUBLIC_KEY: "<открытый VAPID-ключ Base64URL>"
  WEB_PUSH_SUBJECT: "https://<адрес приложения>"
  WEB_ORIGINS: "https://<адрес приложения>,https://<адрес приложения>:449,https://<адрес приложения>:5600"
  ADMIN_ORIGINS: "https://85.95.150.8:5620"
  ADMIN_PUBLIC_URL: "https://85.95.150.8:5620/users"
  ADMIN_LOGIN: "admin"
  ADMIN_PASSWORD: "<пароль первичного администратора>"
  # ... остальные параметры схемы настроек: сроки токенов, Argon2id, пул соединений,
  # лимиты входа, уведомления, блокировки, журналы
```

Случайный ключ: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.

`deploy_k8s/base/redis/users.acl` — пользователи Redis (документ «Образы Docker», 3.2), вместо
пароля — его SHA-256 (`echo -n 'пароль' | sha256sum`); из файла kustomize создаёт Secret `redis-acl`:

```text
user default on nopass -@all +ping
user alex on #<SHA-256 пароля администратора> ~* &* +@all
user omsa_app on #<SHA-256 REDIS_PASSWORD> ~* &* +@all -flushall -flushdb -config -debug -shutdown -monitor -acl
```

### Внешние порты

| Порт | Service (LoadBalancer) | Назначение |
| --- | --- | --- |
| 80 | Traefik | HTTP-01 для cert-manager; обычные запросы перенаправляются на HTTPS |
| 91 | nginx | HTTP перенаправляет на HTTPS на внешнем 443 |
| 443 | nginx | HTTPS приложения |
| 449 | nginx | Дополнительный HTTPS-порт (Service направляет на внутренний порт 443) |
| 5600 | nginx | HTTPS и WSS: вход и журнал проверок |
| 5620 | nginx | HTTPS: управление пользователями (ограничение — `ADMIN_ALLOWED_CIDRS`) |

PostgreSQL (5490) и Redis (6399) снаружи кластера недоступны: к ним подключаются только
поды приложения и Celery (NetworkPolicy).

NetworkPolicy требует сетевого плагина с их поддержкой (Calico, Cilium).
Service Nginx создаётся с `externalTrafficPolicy: Local`, чтобы приложение видело реальный
IP-адрес клиента; `FORWARDED_ALLOW_IPS` — CIDR сети подов кластера.

## Конфигурация

Параметры приложения описаны схемой Pydantic `backend/app/schemas/settings.py` — имена, типы и
их проверка, значений в коде нет; `backend/core/config.py` загружает их из окружения.
Значения для Kubernetes — все в `deploy_k8s/overlays/prod/secret.yaml`.
В `configmap.yaml` — только параметры Nginx (`HTTPS_HOST`, `ADMIN_ALLOWED_CIDRS`)
и Gunicorn (`WEB_CONCURRENCY`, `FORWARDED_ALLOW_IPS`, `GUNICORN_LOG_LEVEL`).
Файлы `.env`, `secrets/`, `deploy_k8s/overlays/prod/secret.yaml` и
`deploy_k8s/base/redis/users.acl` в репозиторий не добавляются.
