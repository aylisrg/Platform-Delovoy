# QA Report: issue #564 — ps-park: остальные мутации не фильтруют deletedAt: null

## Вердикт: PASS

## Скоуп
Независимая верификация коммита `e12ac104` на ветке `claude/issue-564-ps-park-deletedat-followup`
(продолжение #512). Диф: `src/modules/ps-park/service.ts` (+6/-6, добавлен `deletedAt: null` в
`prisma.booking.findFirst` внутри `updateBookingStatus`, `cancelBooking`, `markNoShow`,
`addItemsToBooking`, `extendBooking`, `getBookingBill`) + `__tests__/service.test.ts` (+86, 6 новых
regression-тестов). PRD/review-документов для этого issue не создавалось — точечный tech-debt fix,
без AC от PO; тест-план построен на самом диффе и на паттерне #512.

## Что сделано

1. **Мутационное тестирование 4 из 6 фиксов, не проверенных ревьюером** (`updateBookingStatus`,
   `cancelBooking`, `addItemsToBooking`, `extendBooking`). Одновременно откатил `, deletedAt: null`
   в этих 4 функциях (sed по точным номерам строк 346/876/1296/1652), прогнал
   `npx vitest run src/modules/ps-park/__tests__/service.test.ts` — упали **ровно** 4 теста:
   `updateBookingStatus filters by deletedAt: null`, `cancelBooking filters by deletedAt: null`,
   `addItemsToBooking filters by deletedAt: null`, `extendBooking filters by deletedAt: null`
   (112/116 passed, 4 failed). Ассерты падали именно на отсутствии `deletedAt: null` в `where` —
   ложных срабатываний в других тестах нет. Восстановил файл из бэкапа, `git diff --quiet` → clean
   (дерево идентично HEAD).
2. **Полный набор**: `npm test -- --run` → 266 файлов / 3789 тестов, все зелёные (совпадает с
   заявленным).
3. **Типы/линт**: `npx tsc --noEmit` — чисто (0 ошибок), до и после мутационного теста.
   `npx eslint src/modules/ps-park/service.ts src/modules/ps-park/__tests__/service.test.ts` — чисто.
4. **Регрессия модуля**: `npx vitest run src/modules/ps-park/` — 2 файла / 165 тестов, все зелёные.
5. **Независимая проверка `softDeleteBooking`/`hardDeleteBooking`**: прочитал обе функции целиком
   (`service.ts:2126-2179`). `softDeleteBooking` после `findFirst` явно читает `booking.deletedAt`,
   чтобы бросить `BOOKING_ALREADY_DELETED` вместо `BOOKING_NOT_FOUND` — если бы `findFirst`
   фильтровал по `deletedAt: null`, уже удалённая бронь всегда возвращала бы `null`, и различение
   кодов ошибок было бы невозможно. `hardDeleteBooking` использует `!booking.deletedAt` в вычислении
   `shouldReturn` (не возвращать товар на склад повторно, если бронь уже была soft-deleted и товар
   уже вернули) и должен физически удалить строку независимо от текущего `deletedAt` — иначе
   hard-delete уже мягко удалённой брони был бы недостижим. Логика подтверждена, оставление этих
   двух findFirst без фильтра — осознанное и корректное решение, не пропуск.

## Замечания
Диф — чистое сужение поведения для уже существующих путей (те же коды ошибок, тот же формат ответа),
новых эндпоинтов/RBAC-веток не добавлено, поэтому полная RBAC-матрица (USER/MANAGER/SUPERADMIN/
анонимный) по чек-листу QA не прогонялась отдельно — она не задета этим диффом; RBAC на уровне route
handlers (`requireAdminSection`/`hasModuleAccess`) не менялся и не проверялся заново.

## Итог
Все 6 фиксов подтверждены мутационным тестированием (2 — ревьюером ранее, 4 — QA сейчас), полный
набор тестов зелёный, типы и линт чисты, обоснование для двух намеренно нефильтрованных функций
проверено независимым чтением кода и логически корректно. Working tree после проверки идентично
HEAD. Регрессий не найдено.
