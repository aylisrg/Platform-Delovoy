# /weekly-funnel — недельный отчёт по воронке и гипотезы недели

Программа понедельничной сессии product-analyst (US-2/US-3 эпика #583, ADR
`docs/adr/2026-09-16-weekly-product-analyst-loop.md`). Запускается Routine
«Product Analyst: недельный отчёт по воронке» (`0 6 * * 1` UTC = понедельник
09:00 МСК), но руками выполняется точно так же.

**Граница ответственности жёсткая:** все числа — конверсии, дельты, вердикт
«данных мало», сверка с релизами, baseline гипотез — считает код
(`src/modules/analytics/weekly-report.ts`, покрыт тестами). Ты пишешь **только
прозу** в двух разделах и вызываешь CLI. Ни одной цифры руками: если числа нет
в сгенерированном отчёте, его нет и в тексте.

---

## 0. Репозиторий на месте

```bash
ls /home/user/Platform-Delovoy/CLAUDE.md || exit   # нет репозитория — заверши сессию
cd /home/user/Platform-Delovoy && git checkout main && git pull origin main
```

## 1. Агрегаты прода

```bash
npx tsx scripts/funnel-weekly.ts stats --out /tmp/funnel-stats.json
```

Команда читает repo variable `FUNNEL_WEEKLY_STATS`; если та пуста или старше
36 часов — сама дёргает `analytics-funnel-export.yml` и ждёт до 12 минут.

- **exit 4** — агрегаты так и не доехали. Заведи задачу и **заверши сессию**
  (владельцу не пишем — CLAUDE.md §9 `/next-issue`):

  ```bash
  npx tsx scripts/issue-queue.ts create --title "Недельный экспорт воронки не отработал" \
    --prio P2 --ready --dedup-key funnel-export-failed
  ```

## 2. Отчёт и сайдкар

```bash
npx tsx scripts/funnel-weekly.ts build --stats-file /tmp/funnel-stats.json
```

Пишет `docs/analytics/<дата>-funnel-weekly.md` (для человека) и `.json`
(сайдкар — по нему вечерняя сводка узнаёт, что отчёт вышел).

- **exit 3** — отчёт за этот период уже есть. Это не ошибка, а идемпотентность:
  повторный прогон Routine не плодит вторые отчёты. **Заверши сессию.**
- stdout: `{ reportPath, sidecarPath, insufficientData, funnels: [...] }`.

## 3. Данных мало — честный конец

`insufficientData: true` (все воронки ниже порога в 30 сессий на входе) —
правильный результат это **одна честная фраза**, а не гипотезы из шума:
допиши в раздел «Интерпретация» одно предложение о том, что данных за неделю
недостаточно для выводов, гипотезы **не формулируй** и иди к шагу 5.

То же правило поштучно: воронка с `insufficientData: true` не может стать
источником гипотезы — CLI откажет (exit 5).

## 4. Интерпретация и гипотезы

Запусти субагента `product-analyst` (роль — `agents/analytics.md`). Он:

- читает сгенерированный отчёт (и только его: своих SQL-запросов к
  `ProductEvent` не пишем — числа уже посчитаны и проверены тестами);
- пишет раздел «Интерпретация» — **после** маркера
  `<!-- weekly-funnel:interpretation -->`: где теряем, что изменилось к прошлой
  неделе, связано ли заметное изменение с релизами недели (раздел 3 отчёта уже
  содержит машинную сверку — суждение о связи твоё, и «корреляция ≠ причинность»
  здесь не формальность);
- предлагает **не больше трёх** гипотез, каждая — по конкретной воронке и шагу
  из отчёта.

На каждую гипотезу — файл прозы ровно с двумя секциями (остальное подставит код):

```markdown
### Что предлагается изменить
<что именно меняем, конкретно и проверяемо>

### Ожидаемый результат и почему
<какой шаг воронки и почему должен вырасти>
```

```bash
npx tsx scripts/funnel-weekly.ts hypothesis --report-date <D> \
  --funnel <gazebos|ps-park|cafe|rental> --step <шаг> \
  --title "<заголовок issue>" --body-file /tmp/hyp-1.md
```

CLI сам подставит baseline из сайдкара, заведёт issue с лейблами
`auto:hypothesis` + `from-analytics`, допишет её в отчёт и сайдкар. Отказы —
не повод спорить с ними, а сигнал остановиться:

| Код | Что случилось |
|-----|---------------|
| 5 | по этой воронке данных за неделю мало — гипотеза не регистрируется |
| 6 | в тексте найдены персональные данные (email/телефон/ИНН) — убери их |
| 7 | трёх гипотез достаточно; четвёртая не берётся |
| 3 | гипотеза по этому шагу за эту неделю уже заведена |

**Гипотеза — не задача.** Она не попадает ни во входящие, ни в очередь: ход ей
даёт только владелец словом «делай» (дальше — `issue-queue.ts promote <N> <P>`).
Приоритет не назначаем и в работу её не берём — ни в этой сессии, ни в
следующей.

## 5. Ветка, коммит, PR

```bash
git checkout -b claude/weekly-funnel-<reportDate>
git add docs/analytics/
git commit -m "docs(analytics): недельный отчёт по воронке <период>"
git push -u origin claude/weekly-funnel-<reportDate>
npx tsx scripts/funnel-weekly.ts pr --branch claude/weekly-funnel-<reportDate> --report-date <D>
```

## 6. Вердикты ревью-агентов

Как шаг 5 `/next-issue`: субагент `code-reviewer`, затем (после PASS)
`qa-engineer`. Оба PASS — публикуй маркеры, без них гейт вернёт `hold`, и отчёт
не доедет до вечерней сводки:

```bash
npx tsx scripts/issue-queue.ts verdict $PR code-reviewer
npx tsx scripts/issue-queue.ts verdict $PR qa-engineer
```

## 7. Мерж

```bash
npx tsx scripts/issue-queue.ts pr-wait $PR 30
npx tsx scripts/issue-queue.ts pr-merge $PR
```

Не успел или CI медленный — не страшно: ветка `claude/**`, подметальщик
(`issue-queue-merge.yml`, каждые 15 минут) домержит сам, как только CI позеленеет.

## 8. Владельцу — ничего

Сводку доставит `owner-digest.yml` в 21:00 МСК: он сам увидит сайдкар,
доехавший в `main` за сутки, и покажет выжимку и список гипотез, ждущих его
«делай». Писать владельцу отдельно не нужно (CLAUDE.md §9 `/next-issue`).
