# Roadmap Backlog — Open GitHub Issues (snapshot 2026-04-25)

> **Зачем этот файл.** В сессии 2026-04-25 владелец задал вопрос «задачи — куда они подевались?». Ответ: в [GitHub Issues репозитория](https://github.com/aylisrg/platform-delovoy/issues). Этот документ — снапшот открытых задач, сгруппированных по фазам дорожной карты из `CLAUDE.md`. Обновляется вручную при значимых изменениях бэклога.

## Сводка

| Фаза | Кол-во | Статус |
|------|-------|--------|
| Phase 5.0 — Запуск | 2 | До 17 апреля 2026 |
| Phase 5.1 — Программа лояльности | 4 | После запуска |
| Phase 5.2 — Резиденты Делового | 4 | После запуска |
| Phase 5.3 — Дашборд владельца | 4 | После запуска |
| Tech-debt (QA findings) | 2 | Low priority |
| **Итого открытых issues** | **16** | |

---

## Phase 5.0 — Production launch (17 апреля 2026)

| # | Title | Что внутри |
|---|-------|-----------|
| [#59](https://github.com/aylisrg/platform-delovoy/issues/59) | feat(deploy): production launch — smoke test всех модулей | Деплой на Timeweb, smoke по 6 модулям, SSL, бот, Telegram-алерты |
| [#60](https://github.com/aylisrg/platform-delovoy/issues/60) | chore(monitoring): настроить алерты и дежурство на первую неделю | Telegram-канал алертов, health checks, ежедневный отчёт |

---

## Phase 5.1 — Loyalty programme

Единая карта участника парка: PS Park / кафе / беседки / бани. 1 балл = 1 ₽; уровни Гость → Резидент → VIP.

| # | Title | Размер |
|---|-------|--------|
| [#61](https://github.com/aylisrg/platform-delovoy/issues/61) | feat(loyalty): схема БД — LoyaltyAccount, LoyaltyTransaction, уровни | M |
| [#62](https://github.com/aylisrg/platform-delovoy/issues/62) | feat(loyalty): API — начисление/списание баллов, баланс, история | L |
| [#63](https://github.com/aylisrg/platform-delovoy/issues/63) | feat(loyalty): UI личного кабинета — баланс, уровень, история | M |
| [#64](https://github.com/aylisrg/platform-delovoy/issues/64) | feat(loyalty): Telegram-бот — /balance, уведомления о начислении | S |

**Зависимость:** #61 → #62 → (#63 ‖ #64).

---

## Phase 5.2 — Residents directory

Каталог бизнесов арендаторов парка. CRM-импорт + claim-механика на email/телефон из договора.

| # | Title | Размер |
|---|-------|--------|
| [#65](https://github.com/aylisrg/platform-delovoy/issues/65) | feat(residents): импорт профилей из CRM — авто-создание карточек | M |
| [#66](https://github.com/aylisrg/platform-delovoy/issues/66) | feat(residents): claim механика — invite-link + OTP верификация | L |
| [#67](https://github.com/aylisrg/platform-delovoy/issues/67) | feat(residents): публичная витрина /residents — каталог бизнесов | M |
| [#68](https://github.com/aylisrg/platform-delovoy/issues/68) | feat(residents): кабинет резидента — редактирование с модерацией | M |

**Зависимость:** #65 → #66 → #67 + #68 параллельно.

---

## Phase 5.3 — Owner dashboard

«Центр управления» — один экран, полная картина всех бизнесов. Метрики, графики, алерты, прогноз.

| # | Title | Размер |
|---|-------|--------|
| [#69](https://github.com/aylisrg/platform-delovoy/issues/69) | feat(dashboard): агрегация метрик — единый сервис бизнес-аналитики | L |
| [#70](https://github.com/aylisrg/platform-delovoy/issues/70) | feat(dashboard): UI обзорный экран всех бизнесов | M |
| [#71](https://github.com/aylisrg/platform-delovoy/issues/71) | feat(dashboard): детальный экран по модулю — тренды, сравнение | M |
| [#72](https://github.com/aylisrg/platform-delovoy/issues/72) | feat(dashboard): система алертов — аномалии, дедлайны, триггеры | L |

**Зависимость:** #69 → (#70 ‖ #71 ‖ #72).

---

## Tech-debt (QA findings из старых PR)

| # | Title | Severity |
|---|-------|----------|
| [#147](https://github.com/aylisrg/platform-delovoy/issues/147) | Rate limiting на admin backup/deploy endpoints (GAP-001) | LOW |
| [#148](https://github.com/aylisrg/platform-delovoy/issues/148) | Explicit USER/MANAGER RBAC tests на admin backup/deploy routes (GAP-002) | LOW |

---

## Что сейчас НЕ в бэклоге, но могло бы быть

Ничего критичного. После рефакторинга 2026-04-25 закрыты:
- ✅ Magic-link uerId-replay уязвимость (commit `8830143`).
- ✅ Видимость личного кабинета USER (`/dashboard` теперь доступен через Navbar и redirectAfterLogin).
- ✅ CLAUDE.md синхронизирован с реальностью (актуальный список модулей + scope-guard правила).
- ✅ `.claude/settings.json` починен на cross-platform (Mac → `$CLAUDE_PROJECT_DIR`).

## Когда обновлять этот файл

- При добавлении новой issue в открытое состояние.
- При закрытии issue (помечать ✅ или удалять строку).
- При завершении фазы — переносить в исторический раздел или удалять.

При значительных изменениях в roadmap (новая фаза, отмена фичи) — синхронно обновляется и `CLAUDE.md`, и этот файл, в одном PR.
