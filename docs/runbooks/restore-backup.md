# Runbook: восстановление из бекапа (SUPERADMIN)

Применяется для восстановления продовой БД из бекапа. Все операции требуют роли `SUPERADMIN`
и **логируются в `BackupLog` и `AuditLog`**. Любое восстановление — разрушительная операция,
делайте только по плану ниже.

## TL;DR

| Нужно | Инструмент | Риск |
|-------|------------|------|
| Восстановить **1 запись** (например удалённое бронирование) | API `POST /api/admin/backups/restore` `scope=record` | Низкий |
| Восстановить **1 таблицу** (откат кривого импорта) | API `scope=table` + `truncateBefore` | Средний |
| **Полный откат** БД к состоянию бекапа | CLI на VPS (см. §3) | КРИТИЧЕСКИЙ — простой всего сервиса |

---

## 0. Подготовка

1. Зайти в `https://delovoy-park.ru/admin/architect/backups`.
2. Найти нужный `BackupLog` — по дате, типу (`DAILY`/`PRE_MIGRATION`), размеру. Статусы:
   - **SUCCESS** (зелёный) — дамп есть и на VPS, и в S3 — восстанавливается с любого хоста.
   - **PARTIAL** (жёлтый) — дамп только на VPS (S3-upload упал). Работает, но с ограничением (см. §5a).
   - **FAILED** (красный) / **IN_PROGRESS** (синий) — не восстановимы, выбирайте другой.
3. Скопировать `id` бекапа.

Перед любым `scope=full` **предупредить Telegram-чат админов минимум за 15 минут** — прод будет в read-only.

---

## 1. Record-level restore (scope=record)

**Сценарий:** админ случайно удалил бронирование, заказ или меню-позицию; нужна одна строка.

**Шаги:**

1. Найти бекап, **сделанный до** удаления.
2. В UI `/admin/architect/backups` нажать "Восстановить" → выбрать:
   - Scope: `record`
   - Table: `Booking` / `Order` / `MenuItem` / …
   - Primary key: JSON вида `{"id": "ckzzz…"}`
   - **Dry-run = ✅ (обязательно первый раз)**
3. Проверить diff. Убедиться что строка именно та.
4. Повторить запрос с `dryRun: false` + тем же `confirmToken`.
5. Дождаться Telegram-уведомления `🔄 Restore record (Booking) — SUCCESS`.
6. В UI журнала восстановленную запись видно снова.

**Откат:** запустить restore того же backupId со старым состоянием — если нужно.

**Если dry-run показал 0 строк:** скорее всего бекап старше удаляемой записи — возьмите более новый.

---

## 2. Table-level restore (scope=table)

**Сценарий:** сломался массовый импорт — половина записей в одной таблице испорчена.

**Шаги:**

1. Убедиться что таблица **не имеет входящих FK** от других актуальных записей (иначе
   `truncateBefore: true` упадёт на constraint).
2. В UI выбрать scope=`table`, table=`<TableName>`, truncateBefore:
   - `false` — upsert поверх (безопаснее)
   - `true` — TRUNCATE + INSERT (чистый откат, опасно на FK)
3. Первый раз — **dry-run**.
4. На реальном прогоне сайт может недолго падать на этой таблице — предупредите пользователей.
5. Следите за `durationMs` в `BackupLog` — для таблиц до 100k строк ожидание ~30-60 сек.

---

## 3. Full restore (scope=full) — КРИТИЧЕСКАЯ ОПЕРАЦИЯ

**UI не даёт full restore в один клик — это намеренно.** Делается из CLI на VPS.

**Шаги:**

```bash
# 1. SSH на VPS
ssh deploy@VPS

# 2. Перейти в репозиторий
cd /opt/delovoy-park

# 3. Получить дамп из S3 (если ещё не в локальном кэше)
aws s3 cp s3://delovoy-backups/daily/delovoy_park_DAILY_20260421_020000.dump \
  /tmp/restore.dump \
  --endpoint-url https://s3.timeweb.cloud

# 4. Остановить приложение (НЕ БД)
docker compose stop app bot

# 5. Сделать backup текущего состояния (страховка!)
BACKUP_TYPE=MANUAL scripts/backup-db.sh

# 6. Восстановить — сначала DROP + CREATE БД
docker compose exec -T postgres psql -U delovoy -c "DROP DATABASE IF EXISTS delovoy_park_tmp;"
docker compose exec -T postgres psql -U delovoy -c "CREATE DATABASE delovoy_park_tmp;"
cat /tmp/restore.dump | docker compose exec -T postgres \
  pg_restore -U delovoy -d delovoy_park_tmp --no-owner --no-privileges --clean --if-exists

# 7. Проверить restore на temp БД — row counts
docker compose exec -T postgres psql -U delovoy -d delovoy_park_tmp -c '
  SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;'

# 8. Если OK — переключить БД
docker compose exec -T postgres psql -U delovoy -c "
  ALTER DATABASE delovoy_park RENAME TO delovoy_park_old;
  ALTER DATABASE delovoy_park_tmp RENAME TO delovoy_park;"

# 9. Стартовать приложение
docker compose up -d app bot

# 10. Ручной BackupLog — отметить что был full restore
docker compose exec -T postgres psql -U delovoy -d delovoy_park -c "
  INSERT INTO \"BackupLog\" (\"id\", \"type\", \"status\", \"scope\", \"sourceBackupId\", \"createdAt\", \"completedAt\")
  VALUES (gen_random_uuid()::text, 'RESTORE', 'SUCCESS', 'FULL', NULL, NOW(), NOW());"

# 11. Сообщить в Telegram-чат: "✅ Full restore выполнен из <backupId>, backup-страховка <manual_id>"
```

**Через 24 часа** дропнуть `delovoy_park_old`:
```bash
docker compose exec -T postgres psql -U delovoy -c "DROP DATABASE delovoy_park_old;"
```

---

## 4. После любого restore

1. Проверить `GET /api/health` = 200.
2. Проверить `/admin/architect/backups` — запись `type=RESTORE, status=SUCCESS` появилась.
3. Просмотреть последние 10 строк `AuditLog` — убедиться что restore залогирован.
4. Если что-то не то — **не трогать ничего ещё 15 минут**, позвонить CTO, разбираться вместе.

---

## 5. Troubleshooting

| Симптом | Причина | Решение |
|---------|---------|---------|
| `RESTORE_IN_PROGRESS` 409 | Другой restore активен (Redis lock) | Подождать 30 мин или `DEL restore:active` в Redis |
| `BACKUP_NOT_FOUND` 404 | id не существует, или статус `FAILED`/`IN_PROGRESS` | Выбрать другой бекап. `SUCCESS` и `PARTIAL` — восстановимы. |
| `CONFIRM_TOKEN_INVALID` 422 | Токен протух (UI хранит его в сессии) | Обновить страницу, заново ввести пароль |
| Dry-run показывает 0 rows | Бекап старше строки или key не совпадает | Проверить backup date; точнее задать primaryKey |
| pg_restore упал на FK | Есть активные FK на таблицу | Не использовать `truncateBefore: true`, делать record-level |
| В response есть поле `warning` про `PARTIAL` | Бекап создан, но S3-upload упал — дамп только на VPS | см. §5a ниже |

### 5a. Работа с `PARTIAL` бекапами

**Что такое PARTIAL?** `pg_dump` отработал успешно и дамп лежит локально в `/opt/backups/postgres/...`,
но последующий `aws s3 cp` упал (сеть, квоты, креды). Такой `BackupLog` получает `status=PARTIAL`,
поле `storagePath` указывает на локальный файл (начинается с `/`, не `s3://`), поле `error` содержит
сообщение провала S3. В админке PARTIAL подсвечен **жёлтым** (не зелёный SUCCESS, не красный FAILED).

**Что делать:**

1. **Проверить S3 причину** — `aws s3 ls s3://delovoy-backups/ --endpoint-url https://s3.timeweb.cloud`
   из контейнера app. Часто — истёкшие креды или квота.
2. **Перезалить дамп в S3 вручную**, если хотите чтобы бекап стал SUCCESS:
   ```bash
   aws s3 cp /opt/backups/postgres/daily/<filename>.dump \
     s3://delovoy-backups/daily/<filename>.dump \
     --endpoint-url https://s3.timeweb.cloud
   # Затем обновите BackupLog:
   docker compose exec -T postgres psql -U delovoy -d delovoy_park -c "
     UPDATE \"BackupLog\"
     SET \"status\"='SUCCESS',
         \"storagePath\"='s3://delovoy-backups/daily/<filename>.dump',
         \"error\"=NULL
     WHERE id='<BACKUP_ID>';"
   ```
3. **Если нужно восстановить _прямо сейчас_, не дожидаясь починки S3** — можно. Restore API
   принимает `PARTIAL` наравне с `SUCCESS`, но в ответе будет `warning`:
   > "⚠️ Бекап в статусе PARTIAL — дамп доступен только локально на VPS..."

   **Критическое ограничение:** восстановление работает только если restore-процесс запускается
   **на том же VPS**, где лежит локальный дамп. Если хотите восстанавливать на другой машине
   (новый сервер, DR site) — сначала `scp` файл по пути из `storagePath` на целевой хост, или
   сделайте шаг 2 (перезалить в S3) и используйте нормальный SUCCESS-бекап.
4. **Избегайте долгой жизни PARTIAL** — локальная копия живёт 7 дней (retention в `backup-db.sh`
   для `daily`), потом исчезает. Если в S3 за это время так и не попала — бекап де-факто потерян.

---

## 6. Кто может делать restore

- **SUPERADMIN** — да, все scope.
- **ADMIN** — нет.
- **MANAGER** — нет.
- **USER** — нет.

API физически проверяет роль через `session.user.role === "SUPERADMIN"` **ДО** вызова сервиса.
