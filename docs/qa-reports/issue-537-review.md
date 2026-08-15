# Review: Issue #537 — удалить мёртвый код в src/lib/notifications.ts

## Вердикт: PASS

## Контекст проверки

Issue #537 требовал (1) повторно подтвердить отсутствие импортов, (2) удалить
`src/lib/notifications.ts` целиком (и тесты, если есть), (3) сохранить `npm
test`/`tsc`/`lint` зелёными. Issue's собственная grep-команда:
`grep -rn "from ['\"]@/lib/notifications['\"]"`.

Имплементация **отклонилась от буквальной инструкции**: удалила не весь файл,
а только 4 функции-нотификатора + `sendNotification`/`Notification`/
`NotificationChannel`, оставив `sendAlert`/`AlertLevel`/`LEVEL_EMOJI` и импорт
`telegramApi`. Причина — `sendAlert` используется в `src/lib/logger.ts` через
**относительный** импорт (`from "./notifications"`), который не совпадает с
паттерном `from ['"]@/lib/notifications['"]` из issue. Проверил это
независимо, не доверяя коммит-сообщению.

## Acceptance Criteria
| AC | Статус | Комментарий |
|----|--------|-------------|
| Повторно подтвердить отсутствие импортов перед удалением | PASS | Подтверждено собственным прогоном; см. раздел "Независимая проверка" ниже |
| Удалить весь `src/lib/notifications.ts` | **PASS (обоснованное отклонение)** | Буквально не выполнено — и это правильно. Полное удаление сломало бы `log.critical()` → Telegram-алертинг (issue #571 из этой же сессии). Issue's собственный grep-паттерн (alias-путь) не ловит relative-импорт в `logger.ts`, т.е. премиса issue устарела именно для `sendAlert` к моменту реализации. Удалены ровно те символы, для которых мёртвость подтверждена заново. |
| Удалить тесты, если есть | PASS | `git log --all --diff-filter=A -- "src/lib/__tests__/notifications*"` — файл теста для `src/lib/notifications.ts` никогда не существовал. Нечего удалять. |
| `npm test`/`tsc`/`lint` зелёные | PASS | См. раздел "Прогоны" ниже — 257/257 файлов, 3682/3682 тестов, `tsc --noEmit` без вывода, lint 0 errors / 16 warnings (все в несвязанных файлах, до этого PR). |

## Независимая проверка (не со слов коммита)

**1. `sendAlert` жив и используется реально, не просто "импортирован":**
`src/lib/logger.ts:4` — `import { sendAlert } from "./notifications";`
(относительный путь, подтверждено чтением файла). Цепочка вызова:
`log.critical()` (logger.ts:103-106) → `alertCritical()` (logger.ts:67-93) →
`sendAlert("CRITICAL", ...)` (logger.ts:89). Не dead code: покрыто
`src/lib/__tests__/logger.test.ts` (7 тестов на `log.critical`, включая явный
тест "шлёт Telegram-алерт через sendAlert()", строки 46-55), все тесты
проходят.

Интересная деталь, которую стоит отметить отдельно: `logger.test.ts:22`
мокает `vi.mock("@/lib/notifications", ...)` — **alias-путём**, хотя
`logger.ts` импортирует **относительным** путём. Оба резолвятся в один и тот
же абсолютный файл `src/lib/notifications.ts`, vitest/vite мокает по
абсолютному пути модуля, поэтому мок сработал независимо от синтаксиса пути
в исходнике — тесты это подтверждают (все проходят, мок действительно
перехватывает вызов). Это ещё раз показывает, почему grep по буквальному
паттерну пути ненадёжен для этой задачи, и оправдывает "символ-за-символом"
подход имплементера.

**2. Проверка issue's собственного grep-паттерна сейчас:**
```
grep -rn "from ['\"]@/lib/notifications['\"]" src/ bot/ scripts/
```
— возвращает 0 совпадений (exit code 1), включая и после удаления. То есть
даже сейчас, при живом `logger.ts` → `sendAlert`, буквальная grep-проверка из
issue сказала бы "безопасно удалить весь файл" — что было бы неверно и
сломало бы прод. Это подтверждает: отклонение от буквальной инструкции было
не отговоркой, а необходимой корректировкой устаревшей предпосылки issue.

**3. Мёртвость удалённых символов — грепнул каждый по всему репо
(`src/`, `scripts/`, `bot/`) отдельно от import-путей:**
- `sendNotification` — 0 совпадений вне файла. Единственные совпадения по
  подстроке — `webPush.sendNotification` в
  `src/modules/notifications/dispatch/channels/web-push/index.ts:92` и его
  тестовом моке — это метод объекта `webPush` из npm-пакета `web-push`,
  **не** одноимённая функция из `src/lib/notifications.ts`. Не спутал одно с
  другим.
- `notifyBookingConfirmed`, `notifyBookingReminder`, `notifyNewBooking`,
  `notifyBookingCancelled` — 0 совпадений где-либо в репозитории, включая сам
  файл после удаления.
- `NotificationChannel` (тип из `src/lib/notifications.ts`) — все реальные
  совпадения (`src/modules/notifications/{channels/index.ts,service.ts,types.ts}`)
  импортируют **другой** одноимённый тип из `@prisma/client`, не тот, что
  был в `src/lib/notifications.ts`. Тип из `src/lib/notifications.ts` нигде
  не импортировался.
- `Notification` (тип из `src/lib/notifications.ts`) — все совпадения по
  слову — либо браузерный `Notification` API (`notification-bell.tsx`,
  `WebPushOptIn.tsx`, `WebappPushOptIn.tsx`), либо комментарии/несвязанные
  строки. Ни одного реального импорта типа из `src/lib/notifications.ts`.

Символ-по-символу подтверждаю: все 7 удалённых символов
(`sendNotification`, `Notification`, `NotificationChannel`,
`notifyBookingConfirmed`, `notifyBookingReminder`, `notifyNewBooking`,
`notifyBookingCancelled`) были действительно мертвы, включая три
(`sendNotification`/`Notification`/`NotificationChannel`), не названных явно
в тексте issue, но относящихся к той же категории и того же файла —
это не scope creep, а логичное завершение зачистки одного файла по единому
критерию "мёртвый код в src/lib/notifications.ts".

**4. Итоговый файл самосогласован.** Прочитал `src/lib/notifications.ts`
целиком (47 строк): импорт `telegramApi`, тип `AlertLevel` (не экспортирован,
не экспортировался и до PR — не регрессия), `LEVEL_EMOJI: Record<AlertLevel,
...>`, `sendAlert()`. Всё используется внутри файла, ничего лишнего не
осталось. `escapeHtml`-импорт удалён корректно — grep `escapeHtml` по файлу
после изменения не даёт совпадений внутри тела файла (только имя самого
файла как путь); он использовался исключительно в удалённых функциях
(`sendNotification`, `notifyBooking*`) для эскейпинга пользовательских
данных перед вставкой в HTML-сообщение — эти вызовы удалены вместе с
функциями, поэтому импорт закономерно стал бы unused var.

## Scope Check
- Scope creep: Нет
- `git diff origin/main..HEAD --stat`: 1 файл, `src/lib/notifications.ts`, только удаления (99 строк). Никаких других файлов не тронуто.
- Удаление `sendNotification`/`Notification`/`NotificationChannel` сверх буквально названных в issue функций — не scope creep: тот же файл, та же категория (мёртвый код), подтверждено тем же методом проверки (grep по символу), явно упомянуто и обосновано в коммите. Оставлять их было бы неполной уборкой в рамках уже открытой задачи.

## Качество кода
- TypeScript strict: OK, `any` не использовано (это удаление, не новый код)
- Zod валидация: н/п (нет новых входных данных)
- API формат: н/п (`src/lib/notifications.ts` — не API route)
- Тесты: OK — теста для этого файла никогда не было, ничего не нужно было писать/удалять; регрессия по `logger.test.ts` (использующему `sendAlert` через мок) не возникла

## Безопасность
- **Secrets leakage**: `grep -rE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)' -i` по diff — совпадения только на именах переменных окружения `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ADMIN_CHAT_ID` (уже существовали до PR, читаются из `process.env`, не хардкод, не логируются в значении). Ничего нового не добавлено, весь diff — удаления.
- **RBAC**: н/п — `src/lib/notifications.ts` не API endpoint, RBAC не применим ни до, ни после изменения.
- **Injection**: н/п — нет raw SQL, нет пользовательского ввода в diff (только удаления существующего кода).
- **Supply chain**: новых зависимостей не добавлено, `package.json`/`package-lock.json` не тронуты.
- **Dangerous ops**: отсутствуют.
- Инцидентов не найдено.

## Прогоны (выполнены самостоятельно, не со слов коммита)
- `npm test -- --run`: **257 test files passed (257), 3682 tests passed (3682)** — совпадает с ожиданием в задаче.
- `npx tsc --noEmit`: чистый вывод, 0 ошибок.
- `npm run lint`: **0 errors, 16 warnings** — все 16 warnings в файлах, не относящихся к этому PR (`session-bill-modal.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `MessageBubble.tsx`, `messenger/types.ts`, `notifications/service.ts` — неиспользуемый экспорт `getRecipientUserIds`, `novofon-client.ts`). Ни одного warning про `src/lib/notifications.ts` или `src/lib/logger.ts` — подтверждает, что удаление `escapeHtml`-импорта было корректным (иначе тут был бы новый `no-unused-vars`).

## Что исправить (если NEEDS_CHANGES)
Нет — PR готов к мержу.

## Что хорошо
- Имплементер не выполнил задачу слепо по букве issue, а перепроверил премису issue заново на актуальном состоянии кода — обнаружил, что она устарела из-за параллельного изменения (#571) в той же сессии, и задокументировал это в теле коммита с конкретными путями и грепом.
- Проверка "мёртвости" сделана по символам, а не по путям импорта — это ровно то, что нужно, чтобы не повторить ту же ошибку, что сделала исходная issue (доверие к grep по alias-пути).
- Явно отделил `webPush.sendNotification` (метод стороннего пакета) от одноимённой локальной функции — частая ловушка при grep по короткому имени.
- Однострочная, единофайловая зачистка, без побочных правок в других модулях.
