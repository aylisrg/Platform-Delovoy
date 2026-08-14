# QA-отчёт: issue #536 — escape avitoItem.url в Telegram-алерте негативных отзывов Avito

**Ветка:** `claude/issue-536-escape-avito-url` (коммит `ec370dc` поверх `main`)
**Тип:** fix-only, P2, без PRD (по scope-guard — однострочный багфикс)

## Скоуп

`sendNegativeReviewAlert` в `src/lib/avito/reviews.ts` строит текст Telegram-алерта с `parse_mode: "HTML"` для негативных отзывов Avito (рейтинг ≤ `NEGATIVE_RATING_THRESHOLD`). Поле `Ссылка: ${args.avitoItem.url}` подставлялось без `escapeHtml`, в отличие от соседних `title`/`authorName`/`body` в той же функции. Риск: неэкранированный `&` в URL (например, `?a=1&b=2`) делает Telegram-сообщение невалидным HTML и алерт молча теряется (не injection — URL не используется в `href`, источник — Avito API).

## Acceptance criteria

### AC1 — `args.avitoItem.url` обёрнут в `escapeHtml(...)` в месте интерполяции
**PASS.** `src/lib/avito/reviews.ts:254`:
```ts
args.avitoItem.url ? `Ссылка: ${escapeHtml(args.avitoItem.url)}` : null,
```
Функция `escapeHtml` (`src/lib/telegram/escape.ts`) — канонический хелпер, экранирует `&`, `<`, `>` в правильном порядке (`&` первым).

### AC2 — регресс-тест, падающий без фикса
**PASS.** `src/lib/avito/__tests__/reviews.test.ts`, новый кейс `"escapes avitoItem.url in the Telegram HTML alert text"`:
- URL с `&` и `<script>`: `https://avito.ru/item?a=1&b=<script>`
- Ассерт: текст алерта (аргумент мока `sendTelegramAlert`) содержит `https://avito.ru/item?a=1&amp;b=&lt;script&gt;` и не содержит `<script>`.

Проверено вручную: временно откатил только `reviews.ts` к версии `main` (тестовый файл — версия фикса) и прогнал `vitest run src/lib/avito/__tests__/reviews.test.ts` — новый тест падает с ожидаемым diff (`Ссылка: ...&b=<script>` вместо экранированного), остальные 14 тестов зелёные. После проверки файл восстановлен (`git checkout -- src/lib/avito/reviews.ts`), `git status` чистый, diff идентичен коммиту `ec370dc`. Тест корректно детектирует регресс.

### AC3 — экранирование title/authorName/body не тронуто
**PASS.** `git diff main...HEAD -- src/lib/avito/reviews.ts` показывает единственное изменение — одна строка (URL). Строки `Объявление: ${escapeHtml(...)}`, `Автор: ${escapeHtml(...)}`, `escapeHtml(clipBody(args.body))` — без изменений, экранирование сохранено.

### AC4 — `npm test`, `npx tsc --noEmit`, `npm run lint` чистые
**PASS.**
- `npm test -- --run`: 255 test files, 3627 tests — все зелёные.
- `npx tsc --noEmit`: без вывода, 0 ошибок.
- `npm run lint`: 0 errors, 16 warnings — все в файлах, не относящихся к PR (`session-bill-modal.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `MessageBubble.tsx`, `messenger/types.ts`, `notifications/service.ts`, `novofon-client.ts`) — предсуществующие, не регрессия этого PR.

### AC5 — узкий скоуп изменений
**PASS.** `git diff main...HEAD --stat`:
```
 src/lib/avito/__tests__/reviews.test.ts | 19 +++++++++++++++++++
 src/lib/avito/reviews.ts                |  2 +-
 2 files changed, 20 insertions(+), 1 deletion(-)
```
Только два файла, ровно как заявлено.

## Security-чеклист (agents/qa.md / SECURITY.md)

Изменение точечное (форматирование текста уведомления), не затрагивает endpoints, RBAC, rate limiting или обработку input с клиента — соответствующие кейсы неприменимы к этому диффу.

- **Data leakage**: не применимо — алерт уходит только в закрытый Telegram admin-чат (`sendTelegramAlert`), не в публичный API response. URL берётся из собственных данных Avito-объявления (`AvitoItem.url`), PII не добавляется и не убирается фиксом.
- **Injection**: issue явно отмечает, что это не injection-риск (URL не в `href`), фикс закрывает риск "битого" HTML/потери алерта, что и подтверждено тестом.
- Секреты (`grep -rE 'password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN'` по изменённым файлам) — не встречаются в диффе.

## Регрессия

Полный прогон `npm test -- --run` — 3627/3627 тестов зелёные, включая весь `src/lib/avito/__tests__/` и смежные Telegram/notifications suites. Регрессий не найдено.

## Результат

- Проверено AC: 5
- PASS: 5
- FAIL: 0

## Вердикт: PASS
