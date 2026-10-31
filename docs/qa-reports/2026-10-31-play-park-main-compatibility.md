# Play Park: совместимость с main от 31.10.2026

Ограниченный этап: только локальная сверка, исправления и QA. Реальных платежей, записи в production, публикации, push, merge, deploy, новых credentials и запусков Actions не было.

## База и сохранность изменений

GitHub read-only подтвердил main `6872ba2df26e98c7104b288c1a62a0c7ca7ead86` (PR 1166); он на семь коммитов впереди прежней базы `cd35f20097f13939016861401c71a720dbb75c0c`. Исходный Play Park commit `3e809e30413934fcd21995271742edbc0307fb11` сохранён локальной ссылкой `checkpoint/ps-park-before-main-20261031`. Ветка `feature/ps-park-payment-preparation` перебазирована локально на main; перенесённый feature commit — `cb3b13e59d01068dda0c4f23396fbdee863db4bf`.

Единственный текстовый конфликт был в legal seed tests. Сохранены новые оферта беседок v2 и политика ПД v2, их архивные v1 и изменения публичных контактов. Выпущенные gazebos UI/service, notifications/release-notify, business-service/business-reports, package.json/package-lock и Prisma schema/migrations остаются идентичны main. У платёжного feature по-прежнему нет новых зависимостей или миграций.

## Исправления совместимости

- Play Park использует актуальный контакт из `PUBLIC_CONTACTS` на экране результата оплаты и в ответе об обращении для переноса.
- Добавлена контактная редакция `ps-park-offer/v2.md`: исправлены телефон, номер/дата/URL редакции; условия оплаты, переноса и обязательные права клиента сохранены. v1 не переписана. Seed сохраняет все шесть редакций трёх документов и оставляет текущими v2. Команда активации сверяет хеш Play Park v2.
- Upgrade-test проверяет сохранение body/hash/id уже принятой Play Park v1 и действующих v2 беседок/ПД. Обнаруженная неточность тестового FakePrisma исправлена: scalar-фильтр `not` сохраняется при нормализации `updateMany`, как в настоящем Prisma, и старую редакцию действительно снимают с `isCurrent`.
- Интеграционный тест воспроизвёл потерю `paid` в аналитике при success webhook до ответа checkout: деньги и бронь были корректны, `submitted=1`, `paid=0`; повтор webhook не восстанавливал событие. Исправление сохраняет неблокирующую аналитику: после записи `submitted` Play Park сверяет реальный подтверждённый Payment и восстанавливает `paid`. PS-only детерминированный primary key события делает webhook, восстановление и повтор запроса одной конверсией. Платёжный CAS и финансовые проводки не изменяются, ветки беседок/кафе сохраняют прежнюю запись событий.

Автоматические возвраты Play Park не добавлены. Перенос через администратора, сохранение оплаченной длительности и тарифа, ручное рассмотрение обязательных требований клиента остаются прежними. Production flag не переключался.

## Среда и границы проверки

Node 24.19.0, npm 11.9.0; `npm ci --ignore-scripts --no-audit --no-fund --cache /workspace/.npm-play-park-20261031` установил точный lockfile main, включая Next 16.4.3. Первая установка остановилась на локальном ENOENT каталога npm cache; повтор использовал writable cache. Postinstall намеренно не запускался: запрет загрузки с binaries.prisma.sh остаётся в силе. Сохранённый no-engine generated client используется только для типов и моков; schema совпадает с main. Dockerfile production использует Node 22, это отдельная среда сборки.

Full Next → native Prisma → PostgreSQL → provider fixture E2E здесь **не выполнен**. Native query/schema engines отсутствуют; прежние HTTP 403 / P6001 не обходились и запрещённый download не повторялся. Конкретно нужны штатные Prisma 6.19.3 query/schema engines (engine commit `c2990dca591cba766e3b7ef5d9e8a84796e47ab7`, для текущего Linux target `debian-openssl-3.0.x`) в разрешённой среде. Synthetic PostgreSQL доступен локально, поэтому отсутствие БД не является блокером SQL QA.

Изолированный существующий контейнер `play-park-local-qa`, PostgreSQL 16, network=none, база `play_park_qa` восстановлен запуском после перезапуска executor. После readiness все 10 SQL проверок прошли; схемы feature и main идентичны. SQL harness проверяет инварианты и реальные блокировки, но не исполняет Prisma-сервисы. Реальные production данные не используются.

Play Park browser проверяет реальные React-компоненты с API/provider fixtures: 7/7 PASS, включая текущую ссылку телефона. Беседки: 8/8 PASS с локальными fixtures, внешние URL блокируются. Штатный gazebo fixture config имеет уже существующую ошибку относительного пути webServer (`e2e/e2e/fixtures/...`); Vite запущен из корня, затем штатный Playwright использовал предусмотренный reuseExistingServer. Production-код и этот конфиг не менялись.

## Итоговые проверки

| Проверка | Результат |
| --- | --- |
| `npm test` после финального analytics fix | PASS: 448 файлов, 6059 тестов, 0 failed |
| Новые service-boundary integration tests | PASS: 12; входят в общий прогон. Настоящие checkout/payment/webhook/settlement/product-events/business-report, DB и внешние транспорты — fixtures |
| Целевой прогон analytics/checkout/route | PASS: 5 файлов / 99 тестов |
| Отдельная проверка legal seed/activation | PASS: 12 тестов |
| `npm run lint` | PASS: 0 errors, 83 warnings |
| `npx --no-install tsc --noEmit` | PASS, exit 0, после завершения сборки |
| `npm run build` | PASS, exit 0: Next 16.4.3 production build на Node 24.19.0, synthetic env; предупреждения Edge Runtime/Cache-Control/file tracing |
| Все шесть legal файлов в `.next/standalone` | PASS: существуют, побайтово совпадают с исходниками |
| Play Park browser fixture | PASS: 7 сценариев |
| Gazebo browser fixture | PASS: 8 сценариев; оговорка webServer path выше |
| PostgreSQL invariant harness | PASS: 10 проверок, оба порядка success/cancel |
| `git diff --check`, сохранность перечисленных путей main | PASS |
| Независимый scoped review и browser QA | PASS |
| Full paid Next/native Prisma/DB E2E | NOT RUN: native engine недоступен по указанному ограничению |
| Production Node 22 Docker image / VPS / real provider | NOT RUN в этом этапе |

Старые 5803 теста от 28.10 не использованы как итоговая проверка. Первая версия нового upgrade-test выявила дефект FakePrisma `not`-фильтра; после исправления fixture тест и общий прогон зелёные. Early-webhook integration сначала воспроизводимо падал (`paid=0`); после исправления тот же сценарий проходит. Все оставшиеся проверки и ограничения перечислены явно, мок-тесты не выданы за полный E2E.

Логи текущего этапа сохранены в workspace `play-park-reconciliation-20261031/logs/` для продолжения работы. Прежний Library artifact `libfile_e45d201fdfec81918981cc5090d2f4ec` содержит старую базу/commit и не обновлялся; его нельзя считать пакетом этого состояния.

## До выпуска

1. Завершить full paid E2E на разрешённом обычном Prisma Client с synthetic DB и локальным provider transport fixture/существующим test shop, без реальных списаний: success, cancel, параллельные запросы, early/late webhook, потерянный ответ, повтор, confirmationUrl recovery, один ledger entry, перенос, gazebo regression.
2. Проверить production Node 22 Docker build, наличие всех legal файлов в image, фактический deployed SHA/drift, целевой VPS и завершённый snapshot именно его диска, валидный DB dump и rollback. Подключение к VPS в рамках этого этапа не выполнялось; доступ в другой Mac-сессии не отрицается.
3. Публикация, push/merge, deploy, seed документов/активация на production требуют отдельного разрешённого следующего этапа. Здесь их явно запретили. Не запускать Actions и не пушить main, автоматически запускающий workflow.
4. При выпуске использовать Play Park offer v2. Отключение новых reservation командой `disable` сохраняет обработку уже созданных платежей; полный image rollback на старый handler после первых оплат требует сверки незавершённых платежей. См. прежний release-plan для подробностей, но его номера редакций и SHA заменяются этим отчётом.
