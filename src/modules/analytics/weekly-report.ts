/**
 * Недельный отчёт по воронке (US-2/US-3 эпика #583, ADR
 * `docs/adr/2026-09-16-weekly-product-analyst-loop.md`).
 *
 * Здесь живут ВСЕ числа отчёта: дельты, пороги достаточности данных, сверка с
 * релизами, сайдкар для вечернего дайджеста, шаблон тела гипотезы и PII-guard.
 * Агент дописывает только прозу — граница «числа считает код, текст пишет
 * агент» (ADR §3) держится тем, что ни одну цифру отчёта нельзя получить в
 * обход этого файла.
 *
 * Файл чистый: ни одного импорта из `@/lib/*` (ни БД, ни Redis, ни логгера) —
 * его импортирует `scripts/funnel-weekly.ts`, обычный tsx-CLI без живого окружения.
 */
import { z } from "zod";
import { FUNNELS, getFunnel, getStepDef, type FunnelKey } from "./funnels";
import { aggregateFunnelStats, round1, type FunnelStatsRow } from "./funnel-stats";
import {
  WEEKLY_SIDECAR_SCHEMA_VERSION,
  type DateRange,
  type FunnelStats,
  type FunnelStatsData,
  type FunnelStepStats,
  type WeeklyFunnelDigest,
  type WeeklyFunnelSidecar,
  type WeeklyFunnelSummary,
  type WeeklyHypothesisRef,
} from "./types";

export { WEEKLY_SIDECAR_SCHEMA_VERSION };

// --- Пороги (AC-2.5). Одно место, покрыты тестами: подкрутить = строка + тест ---

/** Сессий на входе воронки за неделю, ниже — по воронке выводов не делаем. */
export const MIN_TOP_SESSIONS_FOR_CONCLUSIONS = 30;
/** Сессий на шаге, ниже — дельту шага не печатаем (шум больше сигнала). */
export const MIN_STEP_SESSIONS_FOR_DELTA = 10;
/** «Заметное изменение» сквозной конверсии — порог сверки с релизами (AC-2.2). */
export const NOTABLE_DELTA_PP = 5;
/** Максимум гипотез на неделю (AC-2.3). */
export const MAX_HYPOTHESES_PER_WEEK = 3;
/** Дайджест считает отчёт свежим, если он доехал в main за это окно (ADR §7). */
export const SIDECAR_FRESH_WINDOW_HOURS = 24;
/** Старше этого агрегаты прода считаются протухшими и экспорт передёргивается. */
export const WEEKLY_STATS_MAX_AGE_HOURS = 36;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- Пути артефактов недели (глоб дайджеста опирается на это имя) ---

export function reportPathFor(reportDate: string): string {
  return `docs/analytics/${reportDate}-funnel-weekly.md`;
}

export function sidecarPathFor(reportDate: string): string {
  return `docs/analytics/${reportDate}-funnel-weekly.json`;
}

// --- Форматирование чисел ---

export function deltaPp(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return round1(current - previous);
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} %`;
}

export function formatDeltaPp(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${Math.abs(value).toFixed(1)} п.п.`;
}

// --- Сводка по воронке ---

function stepOf(funnel: FunnelStats | undefined, step: string): FunnelStepStats | undefined {
  return funnel?.steps.find((s) => s.step === step);
}

function topSessionsOf(funnel: FunnelStats | undefined): number {
  return funnel?.steps[0]?.sessions ?? 0;
}

function endToEndOf(funnel: FunnelStats | undefined): number {
  return funnel?.steps.at(-1)?.conversionFromTop ?? 0;
}

function summarize(current: FunnelStats, previous: FunnelStats | undefined): WeeklyFunnelSummary {
  const key = current.funnel as FunnelKey;
  const def = FUNNELS[key];
  const topSessions = topSessionsOf(current);
  const insufficientData = topSessions < MIN_TOP_SESSIONS_FOR_CONCLUSIONS;
  const endToEndConversion = endToEndOf(current);

  // Дельта молчит, когда сравнивать не с чем: мало данных в этой неделе (порог
  // выводов) или почти пустая прошлая (порог шага). Выдуманная дельта на пяти
  // сессиях — ровно та ложь, от которой AC-2.5 и защищает.
  const previousTop = topSessionsOf(previous);
  const endToEndDeltaPp =
    insufficientData || previous === undefined || previousTop < MIN_STEP_SESSIONS_FOR_DELTA
      ? null
      : deltaPp(endToEndConversion, endToEndOf(previous));

  // На пустой воронке «худший переход» — это 0 % из ниоткуда в никуда:
  // формально шаг есть, смысла нет. Молчим, чтобы не выдавать шум за слабое место.
  const dropStep = topSessions > 0 ? current.biggestDropStep : null;
  const dropStats = dropStep ? stepOf(current, dropStep) : undefined;

  return {
    funnel: key,
    label: def?.label ?? key,
    topSessions,
    endToEndConversion,
    endToEndDeltaPp,
    biggestDropStep: dropStep,
    biggestDropLabel: dropStats?.label ?? null,
    biggestDropConversion: dropStats?.conversionFromPrev ?? null,
    insufficientData,
  };
}

// --- Markdown-отчёт ---

/** Маркеры разделов агента: по ним CLI и сессия находят, куда писать прозу. */
export const INTERPRETATION_MARKER = "<!-- weekly-funnel:interpretation -->";
export const HYPOTHESES_MARKER = "<!-- weekly-funnel:hypotheses -->";
/** Заглушка раздела «Гипотезы» — снимается при регистрации первой гипотезы. */
export const HYPOTHESES_PLACEHOLDER = "_Гипотезы ещё не зарегистрированы._";
export const INSUFFICIENT_DATA_HYPOTHESES_LINE =
  "Данных за неделю недостаточно — гипотезы не формулируются.";

export type WeeklyReleases = { date: string; prs: { number: number; title: string }[] }[];

function funnelTable(current: FunnelStats, previous: FunnelStats | undefined): string[] {
  const lines = [
    "| Шаг | Сессии | События | % от предыдущего | % от входа | Δ п.п. к прошлой неделе |",
    "|---|---|---|---|---|---|",
  ];
  for (const step of current.steps) {
    const prev = stepOf(previous, step.step);
    // Дельта шага — только когда обе недели дают по нему не шум (AC-2.5).
    const comparable =
      prev !== undefined &&
      step.sessions >= MIN_STEP_SESSIONS_FOR_DELTA &&
      prev.sessions >= MIN_STEP_SESSIONS_FOR_DELTA;
    const delta = comparable ? deltaPp(step.conversionFromPrev, prev.conversionFromPrev) : null;
    lines.push(
      `| ${step.label} | ${step.sessions} | ${step.events} | ${formatPercent(step.conversionFromPrev)} | ` +
        `${formatPercent(step.conversionFromTop)} | ${formatDeltaPp(delta)} |`
    );
  }
  return lines;
}

function releasesSection(releases: WeeklyReleases, summaries: WeeklyFunnelSummary[]): string[] {
  const withPrs = releases.filter((r) => r.prs.length > 0);
  const lines: string[] = [];

  if (withPrs.length === 0) {
    lines.push("За отчётную неделю в прод не уехало ни одного PR.", "");
  } else {
    for (const day of withPrs) {
      lines.push(`- **${day.date}**`);
      for (const pr of day.prs) lines.push(`  - #${pr.number} — ${pr.title}`);
    }
    lines.push("");
  }

  lines.push(`**Сверка с заметными изменениями** (порог ${NOTABLE_DELTA_PP} п.п.):`, "");
  const notable = summaries.filter(
    (s) => s.endToEndDeltaPp !== null && Math.abs(s.endToEndDeltaPp) >= NOTABLE_DELTA_PP
  );
  if (notable.length === 0) {
    lines.push(
      `- Заметных изменений сквозной конверсии нет — сверять не с чем.`
    );
  } else {
    const dates = withPrs.map((r) => r.date).join(", ");
    for (const s of notable) {
      lines.push(
        withPrs.length > 0
          ? `- ${s.label}: заметное изменение ${formatDeltaPp(s.endToEndDeltaPp)}; релизы на неделе: ${dates}.`
          : `- ${s.label}: заметное изменение ${formatDeltaPp(s.endToEndDeltaPp)}; релизов на неделе не было — изменение не объясняется выкаткой.`
      );
    }
  }
  return lines;
}

/**
 * Весь отчёт и сайдкар за один вызов. Чистая функция: те же входные данные —
 * тот же байт в байт markdown, поэтому отчёт проверяем тестами, а не глазами.
 */
export function buildWeeklyFunnelReport(input: {
  current: FunnelStatsData;
  previous: FunnelStatsData;
  reportDate: string;
  publishedAt: string;
  releases: WeeklyReleases;
}): { markdown: string; sidecar: WeeklyFunnelSidecar } {
  const { current, previous, reportDate, publishedAt, releases } = input;
  const summaries = current.funnels.map((f) =>
    summarize(f, previous.funnels.find((p) => p.funnel === f.funnel))
  );
  const insufficientData = summaries.length === 0 || summaries.every((s) => s.insufficientData);

  const sidecar: WeeklyFunnelSidecar = {
    schemaVersion: WEEKLY_SIDECAR_SCHEMA_VERSION,
    reportDate,
    reportPath: reportPathFor(reportDate),
    period: current.period,
    previousPeriod: previous.period,
    publishedAt,
    insufficientData,
    funnels: summaries,
    hypotheses: [],
  };

  const lines: string[] = [
    `# Недельный отчёт по воронке — ${reportDate}`,
    "",
    "## 1. Период и источники",
    "",
    `- Отчётный период: **${current.period.dateFrom} … ${current.period.dateTo}** (закрытая неделя Пн–Вс, МСК)`,
    `- Неделя сравнения: ${previous.period.dateFrom} … ${previous.period.dateTo}`,
    "- Источник: агрегаты таблицы `ProductEvent` (first-party события воронки, ADR",
    "  `docs/adr/2026-09-16-product-event-funnel-instrumentation.md`)",
    "- Оговорка о точности: шаги, записываемые из браузера (выбор слота, товар в",
    "  корзине, начало заявки), систематически недосчитываются — блокировщики и уход",
    "  со страницы съедают часть событий; посетители за одним мобильным адресом",
    "  (CGNAT операторов РФ) склеиваются в одну сессию. Абсолютную конверсию читаем",
    "  как оценку снизу, доверяем динамике неделя-к-неделе.",
    "",
    "## 2. Воронки",
    "",
  ];

  for (const funnel of current.funnels) {
    const summary = summaries.find((s) => s.funnel === funnel.funnel);
    if (!summary) continue;
    const prev = previous.funnels.find((p) => p.funnel === funnel.funnel);
    lines.push(`### ${summary.label} (\`${summary.funnel}\`)`, "");
    lines.push(...funnelTable(funnel, prev));
    lines.push("");
    lines.push(
      summary.biggestDropLabel
        ? `Наибольший отток: «${summary.biggestDropLabel}» — ${formatPercent(summary.biggestDropConversion)} от предыдущего шага.`
        : "Наибольший отток: определить не по чему — событий за неделю нет."
    );
    lines.push(
      `Сквозная конверсия: ${formatPercent(summary.endToEndConversion)} ` +
        `(к прошлой неделе: ${formatDeltaPp(summary.endToEndDeltaPp)}).`
    );
    if (summary.insufficientData) {
      lines.push(
        `⚠️ Мало данных: ${summary.topSessions} сессий на входе при пороге ` +
          `${MIN_TOP_SESSIONS_FOR_CONCLUSIONS} — цифры выше остаются фактом, но выводов по этой воронке не делаем.`
      );
    }
    lines.push("");
  }

  lines.push("## 3. Релизы недели", "");
  lines.push(...releasesSection(releases, summaries));
  lines.push("");

  lines.push(
    "## 4. Достаточность данных",
    "",
    `Порог выводов — ${MIN_TOP_SESSIONS_FOR_CONCLUSIONS} сессий на входе воронки за неделю; ` +
      `дельта шага печатается от ${MIN_STEP_SESSIONS_FOR_DELTA} сессий.`,
    "",
    "| Воронка | Сессий на входе | Выводы |",
    "|---|---|---|",
    ...summaries.map(
      (s) => `| ${s.label} | ${s.topSessions} | ${s.insufficientData ? "мало данных — не делаем" : "делаем"} |`
    ),
    ""
  );
  if (insufficientData) {
    lines.push(
      "По всем воронкам данных за неделю недостаточно — отчёт остаётся фактологическим:",
      "интерпретации и гипотез в нём нет.",
      ""
    );
  }

  lines.push(
    "## 5. Интерпретация",
    "",
    INTERPRETATION_MARKER,
    insufficientData
      ? "Данных за неделю недостаточно, чтобы отличить сигнал от шума — выводы не делаем."
      : "_Раздел заполняет product-analyst (`.claude/commands/weekly-funnel.md`)._",
    "",
    "## 6. Гипотезы",
    "",
    HYPOTHESES_MARKER,
    insufficientData ? INSUFFICIENT_DATA_HYPOTHESES_LINE : HYPOTHESES_PLACEHOLDER,
    "",
    "## 7. Приватность",
    "",
    "Отчёт построен на агрегатах: только счётчики событий и уникальных посетителей",
    "по шагам воронок. Ни одной записи о конкретном человеке, ни одного",
    "идентификатора посетителя в отчёте и сайдкаре нет — это свойство типа данных,",
    "а не аккуратности автора.",
    ""
  );

  return { markdown: `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`, sidecar };
}

/**
 * Дописывает зарегистрированную гипотезу в раздел «Гипотезы» отчёта.
 * Порядок пунктов = порядок регистрации; заглушка снимается первой гипотезой.
 */
export function appendHypothesisToMarkdown(markdown: string, ref: WeeklyHypothesisRef): string {
  const lines = markdown.split("\n");
  const markerIdx = lines.indexOf(HYPOTHESES_MARKER);
  if (markerIdx === -1) {
    throw new Error("в отчёте нет маркера раздела «Гипотезы» — отчёт собран не этим кодом");
  }
  let end = markerIdx + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end++;

  const section = lines
    .slice(markerIdx + 1, end)
    .filter((l) => l.trim() !== HYPOTHESES_PLACEHOLDER && l.trim() !== "");
  const stepLabel = getStepDef(ref.funnel, ref.step)?.label ?? ref.step;
  const funnelLabel = getFunnel(ref.funnel)?.label ?? ref.funnel;
  section.push(`- #${ref.issue} — ${ref.title} (воронка «${funnelLabel}», шаг «${stepLabel}»)`);

  return [...lines.slice(0, markerIdx + 1), ...section, "", ...lines.slice(end)].join("\n");
}

// --- Сайдкар: контракт с вечерним дайджестом ---

const dateRangeSchema = z.object({
  dateFrom: z.string().regex(ISO_DATE_RE),
  dateTo: z.string().regex(ISO_DATE_RE),
});

const sidecarSchema = z.object({
  schemaVersion: z.literal(WEEKLY_SIDECAR_SCHEMA_VERSION),
  reportDate: z.string().regex(ISO_DATE_RE),
  reportPath: z.string().min(1),
  period: dateRangeSchema,
  previousPeriod: dateRangeSchema,
  publishedAt: z.string().min(1),
  insufficientData: z.boolean(),
  funnels: z.array(
    z.object({
      funnel: z.string(),
      label: z.string(),
      topSessions: z.number(),
      endToEndConversion: z.number(),
      endToEndDeltaPp: z.number().nullable(),
      biggestDropStep: z.string().nullable(),
      biggestDropLabel: z.string().nullable(),
      biggestDropConversion: z.number().nullable(),
      insufficientData: z.boolean(),
    })
  ),
  hypotheses: z.array(
    z.object({
      issue: z.number(),
      title: z.string(),
      funnel: z.string(),
      step: z.string(),
      baseline: z.string(),
    })
  ),
});

/**
 * Разбор сайдкара для дайджеста. Никогда не бросает: битый или чужой по схеме
 * файл означает «свежего отчёта нет», а не падение вечерней сводки.
 */
export function parseWeeklySidecar(raw: unknown): WeeklyFunnelSidecar | null {
  const parsed = sidecarSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function toDigestSummary(sidecar: WeeklyFunnelSidecar): WeeklyFunnelDigest {
  return {
    period: sidecar.period,
    reportPath: sidecar.reportPath,
    insufficientData: sidecar.insufficientData,
    funnels: sidecar.funnels.map((f) => ({
      label: f.label,
      endToEndConversion: f.endToEndConversion,
      endToEndDeltaPp: f.endToEndDeltaPp,
      biggestDropLabel: f.biggestDropLabel,
      biggestDropConversion: f.biggestDropConversion,
      insufficientData: f.insufficientData,
    })),
    hypotheses: sidecar.hypotheses.map((h) => ({ issue: h.issue, title: h.title })),
  };
}

/**
 * «Отчёт доехал в main за последние сутки» (ADR §7, вопрос PRD №5).
 * `landedAt` — время коммита сайдкара (`git log -1 --format=%cI`); его нет при
 * мелком checkout или локальном прогоне, тогда меряем по `publishedAt` — у
 * старого отчёта он тоже старый, ложных срабатываний это не даёт.
 */
export function isFreshSidecar(input: {
  landedAt: string | null;
  publishedAt: string;
  now: Date;
}): boolean {
  const reference = Date.parse(input.landedAt ?? input.publishedAt);
  if (Number.isNaN(reference)) return false;
  const ageMs = input.now.getTime() - reference;
  // Небольшой минус — расхождение часов раннера и коммита, а не «из будущего».
  const toleranceMs = 60 * 60 * 1000;
  return ageMs < SIDECAR_FRESH_WINDOW_HOURS * 3.6e6 && ageMs > -toleranceMs;
}

// --- Агрегаты прода (repo variable FUNNEL_WEEKLY_STATS) ---

const statsExportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().min(1),
  periods: z.object({ current: dateRangeSchema, previous: dateRangeSchema }),
  rows: z.array(
    z.object({
      funnel: z.string(),
      step: z.string(),
      day: z.string().regex(ISO_DATE_RE),
      events: z.number().int().nonnegative(),
      sessions: z.number().int().nonnegative(),
    })
  ),
});

export type WeeklyStatsExport = z.infer<typeof statsExportSchema>;

export function parseWeeklyStatsExport(raw: unknown): WeeklyStatsExport | null {
  const parsed = statsExportSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function isStatsExportFresh(
  generatedAt: string,
  now: Date,
  maxAgeHours: number = WEEKLY_STATS_MAX_AGE_HOURS
): boolean {
  const ts = Date.parse(generatedAt);
  if (Number.isNaN(ts)) return false;
  return now.getTime() - ts < maxAgeHours * 3.6e6;
}

/**
 * Дневные строки экспорта → те же `FunnelStatsData`, что отдаёт
 * `GET /api/analytics/funnel`. Суммировать дневные `sessions` за неделю
 * корректно: ключ сессии включает календарную дату МСК (ADR #725 §4), то есть
 * один посетитель в два дня — это две разные сессии и в БД, и здесь.
 */
export function statsForPeriod(rows: WeeklyStatsExport["rows"], period: DateRange): FunnelStatsData {
  const totals = new Map<string, FunnelStatsRow>();
  for (const row of rows) {
    if (row.day < period.dateFrom || row.day > period.dateTo) continue;
    const key = `${row.funnel} ${row.step}`;
    const acc = totals.get(key);
    if (acc) {
      acc.events += row.events;
      acc.sessions += row.sessions;
    } else {
      totals.set(key, { funnel: row.funnel, step: row.step, events: row.events, sessions: row.sessions });
    }
  }
  return aggregateFunnelStats([...totals.values()], period);
}

// --- Гипотеза: тело issue (AC-2.3) ---

export type HypothesisBaseline = {
  period: DateRange;
  /** Сессий на входе воронки за отчётную неделю. */
  topSessions: number;
  endToEndConversion: number;
  endToEndDeltaPp: number | null;
  /** Конверсия выбранного шага от предыдущего; null — в отчёте не выделена. */
  stepConversion: number | null;
  reportPath: string;
};

export type HypothesisInput = {
  reportDate: string;
  funnel: string;
  step: string;
  /** Проза агента: что предлагается изменить. */
  change: string;
  /** Проза агента: ожидаемый результат и почему. */
  expected: string;
  baseline: HypothesisBaseline;
};

/** Короткая строка baseline для сайдкара и дайджеста. */
export function formatHypothesisBaseline(
  funnel: string,
  step: string,
  baseline: HypothesisBaseline
): string {
  const stepPart =
    baseline.stepConversion === null
      ? "конверсия шага в отчёте не выделена"
      : `конверсия шага ${formatPercent(baseline.stepConversion)}`;
  return (
    `${funnel}/${step} за ${baseline.period.dateFrom}…${baseline.period.dateTo}: ` +
    `${baseline.topSessions} сессий на входе, ${stepPart}, ` +
    `сквозная ${formatPercent(baseline.endToEndConversion)} (${formatDeltaPp(baseline.endToEndDeltaPp)})`
  );
}

/**
 * Тело issue-гипотезы. Шаблон нормативно живёт здесь, а не в отдельном
 * справочном документе (ADR §5): baseline подставляется кодом, и агент
 * физически не может опубликовать гипотезу с выдуманными числами.
 */
export function buildHypothesisIssueBody(input: HypothesisInput): string {
  const def = getFunnel(input.funnel);
  const stepDef = getStepDef(input.funnel, input.step);
  const stepLabel = stepDef?.label ?? input.step;
  const steps = def?.steps ?? [];
  const idx = steps.findIndex((s) => s.step === input.step);
  const prevStep = idx > 0 ? steps[idx - 1] : undefined;
  const metric = prevStep
    ? `Конверсия \`${prevStep.step} → ${input.step}\` по воронке \`${input.funnel}\` ` +
      `(шаг \`${input.step}\`, поле \`conversionFromPrev\` в \`GET /api/analytics/funnel\`)`
    : `Сессии на шаге \`${input.step}\` воронки \`${input.funnel}\` ` +
      `(поле \`sessions\` в \`GET /api/analytics/funnel\`)`;

  return [
    `## Гипотеза недели ${input.baseline.period.dateFrom} … ${input.baseline.period.dateTo}`,
    "",
    `**Воронка:** ${def?.label ?? input.funnel} · **Шаг:** «${stepLabel}» (\`${input.funnel}/${input.step}\`)`,
    "",
    "### Что предлагается изменить",
    "",
    input.change.trim(),
    "",
    "### Ожидаемый результат и почему",
    "",
    input.expected.trim(),
    "",
    "### Как измеряем",
    "",
    `${metric}, сравнение недели после раскатки с baseline ниже.`,
    `Без изменения ≥ ${NOTABLE_DELTA_PP} п.п. гипотеза считается неподтверждённой.`,
    "",
    "### Baseline (подставлен автоматически из отчёта, не редактировать)",
    "",
    `- Период: ${input.baseline.period.dateFrom} … ${input.baseline.period.dateTo}`,
    `- Сессий на входе воронки: ${input.baseline.topSessions}`,
    `- Конверсия шага от предыдущего: ${formatPercent(input.baseline.stepConversion)}`,
    `- Сквозная конверсия воронки: ${formatPercent(input.baseline.endToEndConversion)} ` +
      `(к прошлой неделе: ${formatDeltaPp(input.baseline.endToEndDeltaPp)})`,
    `- Отчёт: \`${input.baseline.reportPath}\``,
    "",
    "---",
    "",
    "Это **гипотеза**, а не задача: в работу не берётся, пока владелец не скажет",
    "«делай». Дать ход: `npx tsx scripts/issue-queue.ts promote <N> P2`.",
    "",
    `<!-- funnel-hypothesis: ${input.reportDate} ${input.funnel}/${input.step} -->`,
    "",
  ].join("\n");
}

/**
 * Проза агента разбирается на две секции шаблона — остальные три (как измеряем,
 * baseline, оговорка про «ждёт владельца») подставляет код.
 */
export function parseHypothesisProse(text: string): { change: string; expected: string } | null {
  const changeRe = /###\s*Что предлагается изменить\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/;
  const expectedRe = /###\s*Ожидаемый результат и почему\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/;
  const change = changeRe.exec(text)?.[1]?.trim();
  const expected = expectedRe.exec(text)?.[1]?.trim();
  if (!change || !expected) return null;
  return { change, expected };
}

// --- PII-guard (AC-2.6) ---

const PII_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  {
    label: "телефон",
    pattern: /(?:\+7|\b8)[\s(-]{0,3}\d{3}[\s)-]{0,3}\d{3}[\s-]{0,2}\d{2}[\s-]{0,2}\d{2}\b/,
  },
  { label: "ИНН", pattern: /\b(?:\d{10}|\d{12})\b/ },
];

/**
 * Единственная поверхность, куда PII может попасть текстом, — проза агента
 * (числа отчёта персональными быть не могут по типу). Дёшево, детерминированно
 * и тестируемо: нашли — issue не создаём (CLI, exit 6).
 *
 * Возвращает описание находки или null, если текст чист.
 */
export function findPii(text: string): string | null {
  for (const { label, pattern } of PII_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return `${label}: ${match[0].slice(0, 40)}`;
  }
  return null;
}
