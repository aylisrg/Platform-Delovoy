# ADR: Edge-архитектура доступности из РФ + транспорт Telegram

**Дата:** 2026-07-23 · **Статус:** принято · **PR:** #372

## Контекст

Жалоба владельца: delovoy-park.ru «то доступен, то нет — с Wi-Fi работает,
с LTE нет, зависит от устройства»; Telegram-уведомления сломаны. Живые пробы
и логи CI дали факты:

- **Cloudflare в inbound-цепочке НЕТ**: NS = ns1/ns2.reg.ru, A → 85.193.89.242
  (Timeweb, ru-1), отвечает host-nginx напрямую; AAAA и HTTPS/ECH-записей нет.
  Но SOA serial показывает правку зоны **2026-07-20** — следы эксперимента с
  Cloudflare и отката. Остаточные кэши операторских резолверов (TTL 21600) —
  главная гипотеза (H1) для «Wi-Fi ок / LTE нет».
- H2: public rate-limit был 60 req/мин на IP по спуфабельной XFF-цепочке —
  CGNAT-пул мобильного оператора делит один лимит.
- H3: сервер провижнился с `is_ddos_guard: true` — фильтр может резать
  CGNAT-диапазоны (проверяется workflow'ом infra-audit + тикетом в Timeweb).
- **Telegram (root cause)**: с хоста `api.telegram.org` IPv4 → HTTP=000
  (блокировка), IPv6 → 200; Docker-контейнеры v4-only → `ETIMEDOUT`.
  Плюс deploy.yml на каждом деплое перезатирал `TELEGRAM_PROXY_URL`/
  `TELEGRAM_API_ROOT` в `.env` значениями GH-секретов («слетающий релей»).
- Мониторинг был слеп к RU-mobile: единственная внешняя точка — GitHub-раннеры
  (США/ЕС), реальная частота cron ~50–70 мин.

## Решения

### 1. Inbound: прямой путь без Cloudflare-прокси

Клиент → DNS (reg.ru) → Timeweb VPS → host-nginx (LE-сертификат, HTTP/2) →
app. Cloudflare-проксирование для RU-аудитории **запрещено**: ECH/TSPU-риски
дают ровно тот класс отказов, с которого начался инцидент. CDN не нужен —
аудитория региональная, статика отдаётся nginx'ом с диска (static-archive).

### 2. DNS: остаёмся на reg.ru; Timeweb DNS объявлен неавторитативным

Зона живёт на ns1/ns2.reg.ru. `timeweb-manage.yml → dns-*` правит зону
Timeweb, которая **не авторитативна** — эти действия инертны и помечены
deprecated. Смена NS в момент нестабильности запрещена (новая волна кэшей).
Ручные шаги владельца в панели reg.ru: TTL @/www → 600; удалить/выключить
остаточную зону в Cloudflare, чтобы случайный flip NS был невозможен.

### 3. nginx: конфиг в репозитории (infra/nginx/), правки только через ops-nginx

`infra/nginx/delovoy-park.conf` — источник истины (HTTP/2, keepalive+map,
static-archive-блок, upstream в `conf.d/delovoy-upstream.conf`). Применение:
workflow `ops-nginx` (обязательный diff → apply со встроенным `nginx -t`,
бэкапом, автооткатом и внешней проверкой HTTP/2+чанк). Мутации руками и
героическими скриптами — запрещены.

### 4. Telegram-egress: многоуровневый транспорт, источник истины — .env VPS

Порядок предпочтения:
1. **IPv6 контейнеров** (`ops-docker-ipv6 enable`): NAT66 → прямой v6-путь к
   api.telegram.org. Timeweb-only, бесплатно, ничего лишнего в цепочке.
2. **tinyproxy (HTTP CONNECT) на существующем Hetzner-боксе агента**
   (`ops-telegram-relay provision` → `TELEGRAM_PROXY_URL`): включать, если
   v6-путь закроют так же, как v4. TLS сквозной (токен не касается релея),
   доступ только с IP VPS + BasicAuth. Hetzner-бокс и так оплачивается под
   Claude-агента; для Telegram он опционален, не обязателен.
3. **Failover в `telegramApi`**: транспортная ошибка кастомного транспорта →
   одна прямая попытка с остатком таймаут-бюджета. Мёртвый релей не кладёт
   уведомления при живом прямом пути, и наоборот.

Отвергнуто как primary: nginx-relay по `TELEGRAM_API_ROOT` (нужны домен+LE,
токен в URI на релее) и Cloudflare Worker (workers.dev сам под блокировками
из RU-сетей). Оба описаны в runbook как запасные.

`TELEGRAM_PROXY_URL`/`TELEGRAM_API_ROOT` **исключены из синка GH-секретов**
в deploy.yml: значения живут только в `/opt/delovoy-park/.env`, меняются
workflow'ами `ops-telegram-relay`/`ops-env` (контейнеры пересоздаются —
`docker restart` env_file не перечитывает).

### 5. Rate-limit: доверенный IP + CGNAT-совместимые лимиты + телеметрия

Ключ — `X-Real-IP` от nginx (app слушает только 127.0.0.1, заголовок
неспуфабелен) → последний hop XFF. Дефолты: public 180/мин, auth 240/мин;
runtime-override `RATE_LIMIT_PUBLIC_PER_MIN` / `RATE_LIMIT_AUTH_PER_MIN`
через ops-env. Каждое срабатывание — семплированный SystemEvent
(`source: rate-limit`, hash субъекта, без сырых IP).

### 6. Мониторинг: четыре точки обзора

| Точка | Что видит |
|-------|-----------|
| GitHub site-watchdog (США/ЕС, ~50–70 мин) | смерть сайта/VPS + `/api/notifications/health` + divergence-check client-beacon |
| local-watchdog (VPS, каждую минуту) | локальные падения, ступенчатая ремедиация |
| Hetzner-probe (DE, честные */5) | вторая внешняя точка; алерты в TG напрямую — канал не зависит от GitHub/VPS/релея |
| client-beacon (браузеры пользователей) | RU-mobile реальность: ошибки с `metadata.connection` (wifi vs 4g) |

Правило: «внешние пробы зелёные + спайк биконов» = сетевая деградация на
стороне клиентов — алерт, а не тишина.

### 7. Деплой: blue-green по умолчанию

Слоты app:3000 / app-b:3001 (profile bluegreen), flip upstream-include с
graceful reload, публичная верификация, дренаж 30с, встроенный
даунтайм-метр (>10с не-200 = проваленный деплой). Включается сам после
`ops-nginx apply`; `force_legacy_deploy` — аварийный путь со сбросом на 3000.

### 8. DDoS Guard Timeweb — решение по данным

Если infra-audit покажет включённый Guard и чистые логи (нет 429/499-кластеров
на нашей стороне) при продолжающихся LTE-жалобах — тикет в Timeweb (черновик
генерирует infra-audit) с вопросом о фильтрации CGNAT; при подтверждении —
просить ослабление для 80/443. Остальная защита: UFW, fail2ban, app-rate-limit,
снапшоты.

### 9. IPv6 inbound (AAAA) — отложено

Публиковать AAAA только после: подтверждения качества v6 Timeweb, месяца
стабильного v6-egress контейнеров и живого divergence-мониторинга. Совет
«отключить IPv6» из старого runbook удалён — сейчас v6 единственный живой
прямой путь к Telegram с хоста.

## Последствия

- Все серверные изменения — через ops-workflows (diff-гейты, бэкапы, откаты);
  SSH руками — только для форс-мажора.
- Ручные шаги владельца (не блокируют): TTL в reg.ru, зачистка CF-зоны,
  тикет в Timeweb при подтверждении H3, финальный смоук с LTE.
- Откаты: relay — `ops-env delete TELEGRAM_PROXY_URL` / `ops-telegram-relay
  remove`; IPv6 — `ops-docker-ipv6 disable` (бэкап daemon.json); nginx —
  `ops-nginx rollback`; deploy — `force_legacy_deploy`.
