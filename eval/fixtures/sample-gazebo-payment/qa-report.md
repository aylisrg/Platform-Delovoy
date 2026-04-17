# QA Report: Онлайн-оплата бронирования беседки

## Вердикт: PASS

## Acceptance Criteria

- AC-1: PASS — кнопка "Оплатить" появляется после валидного выбора даты и времени
- AC-2: PASS — webhook переводит booking в CONFIRMED (проверено mock-payment'ом)
- AC-3: PASS — получены уведомления в Telegram и на email
- AC-4: PASS — возврат 50% при отмене 10ч до начала, 100% при отмене 48ч до начала
- AC-5: PASS — бейдж отображается для оплаченных
- AC-6: PASS — возврат через менеджера — OK

## RBAC

| Кейс | Ожидание | Факт |
|------|----------|------|
| Анонимный → POST /api/payments/create | 401 | 401 ✅ |
| USER не-владелец брони → POST /api/payments/create | 403 | 403 ✅ |
| USER владелец → POST /api/payments/create | 200 | 200 ✅ |
| MANAGER модуля gazebos → POST /api/payments/:id/refund | 200 | 200 ✅ |
| MANAGER модуля cafe → POST /api/payments/:id/refund | 403 | 403 ✅ |
| Webhook без signature | 400 | 400 ✅ |

## Rate Limiting
- 15 запросов/мин от одного USER → 11-й получает 429 ✅

## Edge Cases
- Двойной webhook на один платёж → idempotent, второй игнорируется
- Отмена брони в момент webhook'а → транзакция rollback
- ЮKassa вернула SUCCEEDED после CANCELLED локально → логируется WARNING, деньги не теряются
- Оплата ровно в момент начала брони → возврат 0% (cancellation window expired)
- Сумма 0 ₽ → 422 VALIDATION_ERROR

## Тесты
- `npm test` — 847 passed, 0 failed
- Покрытие `src/modules/payments/` — 92%
