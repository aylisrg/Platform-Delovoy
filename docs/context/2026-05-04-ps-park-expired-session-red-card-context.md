# Context Log — 2026-05-04 — F2: PS Park, красная карточка истёкшей активной сессии

> RUN_ID: `2026-05-04-ps-park-expired-session-red-card`
> Branch: `claude/fix-booking-session-closure-7SSOS` (общая для Wave 1)
> Wave 1 / 4 (план: `/root/.claude/plans/flickering-sauteeing-acorn.md`)

## Задача

Карточка активной PS Park-сессии в админке должна автоматически становиться красной, когда `now > endTime` (время сессии истекло, но менеджер ещё не закрыл её — сессия "висит в активных", как требует F1). Сейчас цвета: зелёный (>10 мин) → жёлтый (≤10 мин), красного состояния нет.

## Scope

- Только `src/components/admin/ps-park/active-session-card.tsx` (один файл).
- Только PS Park (в беседках UI «активной сессии» нет — отдельный тикет F3 не делает этот UI).

## Stages

- [ ] PO — PRD
- [ ] Architect — ADR
- [ ] Developer — implementation
- [ ] Reviewer — audit
- [ ] QA — verify
