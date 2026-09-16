import { describe, it, expect } from "vitest";
import { aggregateFunnelStats, type FunnelStatsRow } from "../funnel-stats";
import type { FunnelStatsData, WeeklyFunnelSidecar } from "../types";
import {
  HYPOTHESES_MARKER,
  HYPOTHESES_PLACEHOLDER,
  INSUFFICIENT_DATA_HYPOTHESES_LINE,
  MIN_TOP_SESSIONS_FOR_CONCLUSIONS,
  NOTABLE_DELTA_PP,
  WEEKLY_SIDECAR_SCHEMA_VERSION,
  appendHypothesisToMarkdown,
  buildHypothesisIssueBody,
  buildWeeklyFunnelReport,
  deltaPp,
  findPii,
  formatDeltaPp,
  isFreshSidecar,
  isStatsExportFresh,
  parseHypothesisProse,
  parseWeeklySidecar,
  parseWeeklyStatsExport,
  reportPathFor,
  sidecarPathFor,
  statsForPeriod,
  toDigestSummary,
} from "../weekly-report";

const CURRENT = { dateFrom: "2026-09-14", dateTo: "2026-09-20" };
const PREVIOUS = { dateFrom: "2026-09-07", dateTo: "2026-09-13" };

/** Строки одной воронки: view → slot_selected → submitted → paid. */
function rows(funnel: string, sessions: number[]): FunnelStatsRow[] {
  const steps =
    funnel === "cafe"
      ? ["view", "cart_item_added", "submitted", "paid"]
      : funnel === "rental"
        ? ["view", "form_started", "submitted"]
        : ["view", "slot_selected", "submitted", "paid"];
  return steps.map((step, i) => ({ funnel, step, events: sessions[i] ?? 0, sessions: sessions[i] ?? 0 }));
}

function stats(period: { dateFrom: string; dateTo: string }, all: FunnelStatsRow[]): FunnelStatsData {
  return aggregateFunnelStats(all, period);
}

/** Неделя с достаточными данными по всем воронкам. */
function healthyWeek(scale = 1): FunnelStatsRow[] {
  return [
    ...rows("gazebos", [400, 200, 60, 40].map((n) => Math.round(n * scale))),
    ...rows("ps-park", [300, 150, 50, 30].map((n) => Math.round(n * scale))),
    ...rows("cafe", [200, 80, 30, 20].map((n) => Math.round(n * scale))),
    ...rows("rental", [100, 40, 20].map((n) => Math.round(n * scale))),
  ];
}

function build(
  currentRows: FunnelStatsRow[],
  previousRows: FunnelStatsRow[],
  releases: { date: string; prs: { number: number; title: string }[] }[] = [],
) {
  return buildWeeklyFunnelReport({
    current: stats(CURRENT, currentRows),
    previous: stats(PREVIOUS, previousRows),
    reportDate: "2026-09-21",
    publishedAt: "2026-09-21T06:10:00.000Z",
    releases,
  });
}

describe("deltaPp / formatDeltaPp", () => {
  it("считает и печатает разницу в п.п. со знаком", () => {
    expect(deltaPp(24.7, 27.8)).toBe(-3.1);
    expect(deltaPp(10, 4)).toBe(6);
    expect(deltaPp(10, null)).toBeNull();
    expect(deltaPp(null, 10)).toBeNull();
    expect(formatDeltaPp(-3.1)).toBe("−3.1 п.п.");
    expect(formatDeltaPp(6)).toBe("+6.0 п.п.");
    expect(formatDeltaPp(0)).toBe("±0.0 п.п.");
    expect(formatDeltaPp(null)).toBe("—");
  });
});

describe("buildWeeklyFunnelReport — числа и дельты (AC-2.1)", () => {
  it("считает сквозную конверсию и дельту к прошлой неделе (рост и падение)", () => {
    // gazebos: 40/400 = 10 % сейчас против 20/400 = 5 % неделей раньше → +5 п.п.
    const current = [...rows("gazebos", [400, 200, 60, 40]), ...rows("cafe", [200, 80, 30, 10])];
    const previous = [...rows("gazebos", [400, 200, 60, 20]), ...rows("cafe", [200, 80, 30, 40])];
    const { sidecar } = build(current, previous);

    const gazebos = sidecar.funnels.find((f) => f.funnel === "gazebos")!;
    expect(gazebos.endToEndConversion).toBe(10);
    expect(gazebos.endToEndDeltaPp).toBe(5);

    const cafe = sidecar.funnels.find((f) => f.funnel === "cafe")!;
    expect(cafe.endToEndConversion).toBe(5);
    expect(cafe.endToEndDeltaPp).toBe(-15);
  });

  it("дельта null, когда сравнивать не с чем: прошлой недели по воронке нет", () => {
    const { sidecar } = build(healthyWeek(), []);
    expect(sidecar.funnels.every((f) => f.endToEndDeltaPp === null)).toBe(true);
  });

  it("biggestDrop* попадает в сайдкар с меткой шага и его конверсией", () => {
    const { sidecar, markdown } = build(healthyWeek(), healthyWeek());
    const gazebos = sidecar.funnels.find((f) => f.funnel === "gazebos")!;
    // 60/200 = 30 % — худший переход воронки (200/400 = 50 %, 40/60 ≈ 66.7 %)
    expect(gazebos.biggestDropStep).toBe("submitted");
    expect(gazebos.biggestDropLabel).toBe("Бронь отправлена");
    expect(gazebos.biggestDropConversion).toBe(30);
    expect(markdown).toContain("Наибольший отток: «Бронь отправлена» — 30.0 %");
  });

  it("пустая воронка не выдаёт «слабое место» из нулей", () => {
    const { sidecar, markdown } = build(rows("gazebos", [400, 200, 60, 40]), []);
    const empty = sidecar.funnels.find((f) => f.funnel === "rental")!;
    expect(empty.topSessions).toBe(0);
    expect(empty.biggestDropStep).toBeNull();
    expect(empty.biggestDropLabel).toBeNull();
    expect(empty.biggestDropConversion).toBeNull();
    expect(markdown).toContain("Наибольший отток: определить не по чему — событий за неделю нет.");
  });

  it("сайдкар несёт период, путь отчёта и пустой список гипотез", () => {
    const { sidecar } = build(healthyWeek(), healthyWeek());
    expect(sidecar.schemaVersion).toBe(WEEKLY_SIDECAR_SCHEMA_VERSION);
    expect(sidecar.period).toEqual(CURRENT);
    expect(sidecar.previousPeriod).toEqual(PREVIOUS);
    expect(sidecar.reportPath).toBe(reportPathFor("2026-09-21"));
    expect(sidecarPathFor("2026-09-21")).toBe("docs/analytics/2026-09-21-funnel-weekly.json");
    expect(sidecar.hypotheses).toEqual([]);
  });
});

describe("buildWeeklyFunnelReport — достаточность данных (AC-2.5)", () => {
  it("воронка ниже порога помечается insufficientData, но цифры остаются", () => {
    const thin = rows("gazebos", [MIN_TOP_SESSIONS_FOR_CONCLUSIONS - 1, 10, 5, 2]);
    const { sidecar, markdown } = build([...thin, ...rows("cafe", [200, 80, 30, 20])], healthyWeek());

    const gazebos = sidecar.funnels.find((f) => f.funnel === "gazebos")!;
    expect(gazebos.insufficientData).toBe(true);
    expect(gazebos.topSessions).toBe(29);
    expect(gazebos.endToEndDeltaPp).toBeNull(); // выводов не делаем — и дельту не показываем
    expect(markdown).toContain("⚠️ Мало данных: 29 сессий на входе при пороге 30");

    const cafe = sidecar.funnels.find((f) => f.funnel === "cafe")!;
    expect(cafe.insufficientData).toBe(false);
    expect(sidecar.insufficientData).toBe(false); // хватает хотя бы одной воронки
  });

  it("все воронки ниже порога → insufficientData на весь отчёт, гипотез нет", () => {
    const { sidecar, markdown } = build(healthyWeek(0.05), healthyWeek(0.05));
    expect(sidecar.insufficientData).toBe(true);
    expect(markdown).toContain(INSUFFICIENT_DATA_HYPOTHESES_LINE);
    expect(markdown).toContain("Данных за неделю недостаточно, чтобы отличить сигнал от шума");
    expect(markdown).not.toContain(HYPOTHESES_PLACEHOLDER);
  });

  it("дельта шага печатается как «—», когда сессий на шаге меньше порога", () => {
    const current = [...rows("gazebos", [400, 200, 60, 5]), ...rows("cafe", [200, 80, 30, 20])];
    const previous = [...rows("gazebos", [400, 200, 60, 4]), ...rows("cafe", [200, 80, 30, 20])];
    const { markdown } = build(current, previous);
    const paidRow = markdown.split("\n").find((l) => l.startsWith("| Оплачено | 5 |"))!;
    expect(paidRow.endsWith("| — |")).toBe(true);
  });
});

describe("buildWeeklyFunnelReport — сверка с релизами (AC-2.2)", () => {
  const notable = () => {
    // gazebos: 40/400 = 10 % против 10/400 = 2.5 % → +7.5 п.п. (> порога 5)
    const current = [...rows("gazebos", [400, 200, 60, 40]), ...rows("cafe", [200, 80, 30, 20])];
    const previous = [...rows("gazebos", [400, 200, 60, 10]), ...rows("cafe", [200, 80, 30, 20])];
    return { current, previous };
  };

  it("заметное изменение + релизы недели → строка с датами релизов", () => {
    const { current, previous } = notable();
    const { markdown } = build(current, previous, [
      { date: "2026-09-15", prs: [{ number: 881, title: "feat(gazebos): слоты на странице" }] },
      { date: "2026-09-17", prs: [] },
      { date: "2026-09-18", prs: [{ number: 884, title: "fix(cafe): корзина" }] },
    ]);
    expect(markdown).toContain("#881 — feat(gazebos): слоты на странице");
    expect(markdown).toContain("Беседки: заметное изменение +7.5 п.п.; релизы на неделе: 2026-09-15, 2026-09-18.");
  });

  it("заметное изменение без релизов → честное «выкаткой не объясняется»", () => {
    const { current, previous } = notable();
    const { markdown } = build(current, previous, []);
    expect(markdown).toContain("За отчётную неделю в прод не уехало ни одного PR.");
    expect(markdown).toContain(
      "Беседки: заметное изменение +7.5 п.п.; релизов на неделе не было — изменение не объясняется выкаткой.",
    );
  });

  it("изменений меньше порога — сверять не с чем, а не выдумывать связь", () => {
    const { markdown } = build(healthyWeek(), healthyWeek(), [
      { date: "2026-09-15", prs: [{ number: 881, title: "chore: мелочь" }] },
    ]);
    expect(markdown).toContain("Заметных изменений сквозной конверсии нет — сверять не с чем.");
    expect(NOTABLE_DELTA_PP).toBe(5);
  });
});

describe("buildWeeklyFunnelReport — приватность (AC-2.6)", () => {
  it("ни в markdown, ни в сайдкаре нет идентификаторов посетителя", () => {
    const { markdown, sidecar } = build(healthyWeek(), healthyWeek(), [
      { date: "2026-09-15", prs: [{ number: 881, title: "feat: что-то" }] },
    ]);
    const serialized = JSON.stringify(sidecar);
    for (const forbidden of [/sessionKey/i, /@/, /\bip\b/i, /user-?agent/i, /email/i, /телефон/i]) {
      expect(markdown).not.toMatch(forbidden);
      expect(serialized).not.toMatch(forbidden);
    }
    expect(findPii(markdown)).toBeNull();
    expect(findPii(serialized)).toBeNull();
    expect(markdown).toContain("## 7. Приватность");
  });
});

describe("appendHypothesisToMarkdown", () => {
  const ref = {
    issue: 812,
    title: "Показывать свободные слоты прямо на странице беседок",
    funnel: "gazebos",
    step: "slot_selected",
    baseline: "gazebos/slot_selected: …",
  };

  it("первая гипотеза снимает заглушку, вторая дописывается следом", () => {
    const { markdown } = build(healthyWeek(), healthyWeek());
    const once = appendHypothesisToMarkdown(markdown, ref);
    expect(once).not.toContain(HYPOTHESES_PLACEHOLDER);
    expect(once).toContain("- #812 — Показывать свободные слоты прямо на странице беседок (воронка «Беседки», шаг «Выбрал слот»)");

    const twice = appendHypothesisToMarkdown(once, { ...ref, issue: 813, title: "Вторая" });
    expect(twice).toContain("- #812 —");
    expect(twice).toContain("- #813 — Вторая");
    expect(twice).toContain("## 7. Приватность"); // структура отчёта не поехала
    expect(twice.indexOf("- #812")).toBeLessThan(twice.indexOf("- #813"));
    expect(twice.indexOf(HYPOTHESES_MARKER)).toBeLessThan(twice.indexOf("- #812"));
  });

  it("отчёт без маркера раздела — ошибка, а не молчаливая потеря гипотезы", () => {
    expect(() => appendHypothesisToMarkdown("# чужой файл", ref)).toThrow("маркера раздела");
  });
});

describe("parseWeeklySidecar", () => {
  const valid = (): WeeklyFunnelSidecar => build(healthyWeek(), healthyWeek()).sidecar;

  it("валидный сайдкар разбирается как есть", () => {
    const sidecar = valid();
    expect(parseWeeklySidecar(JSON.parse(JSON.stringify(sidecar)))).toEqual(sidecar);
  });

  it("мусор и чужая schemaVersion → null, а не исключение", () => {
    expect(parseWeeklySidecar(null)).toBeNull();
    expect(parseWeeklySidecar("не json-объект")).toBeNull();
    expect(parseWeeklySidecar({})).toBeNull();
    expect(parseWeeklySidecar({ ...valid(), schemaVersion: 2 })).toBeNull();
    expect(parseWeeklySidecar({ ...valid(), reportDate: "вчера" })).toBeNull();
    expect(parseWeeklySidecar({ ...valid(), funnels: "нет" })).toBeNull();
  });
});

describe("toDigestSummary", () => {
  it("оставляет только то, что нужно вечерней сводке", () => {
    const sidecar = build(healthyWeek(), healthyWeek()).sidecar;
    sidecar.hypotheses.push({
      issue: 812,
      title: "Слоты на странице",
      funnel: "gazebos",
      step: "slot_selected",
      baseline: "…",
    });
    const digest = toDigestSummary(sidecar);
    expect(digest.period).toEqual(CURRENT);
    expect(digest.reportPath).toBe(sidecar.reportPath);
    expect(digest.hypotheses).toEqual([{ issue: 812, title: "Слоты на странице" }]);
    expect(digest.funnels[0]).toEqual({
      label: sidecar.funnels[0].label,
      endToEndConversion: sidecar.funnels[0].endToEndConversion,
      endToEndDeltaPp: sidecar.funnels[0].endToEndDeltaPp,
      biggestDropLabel: sidecar.funnels[0].biggestDropLabel,
      biggestDropConversion: sidecar.funnels[0].biggestDropConversion,
      insufficientData: sidecar.funnels[0].insufficientData,
    });
  });
});

describe("isFreshSidecar (ADR §7 — вопрос PRD №5)", () => {
  const now = new Date("2026-09-21T18:00:00.000Z");

  it("доехал в main 2 часа назад — свежий", () => {
    expect(isFreshSidecar({ landedAt: "2026-09-21T16:00:00.000Z", publishedAt: "2026-09-21T06:00:00.000Z", now })).toBe(true);
  });

  it("доехал 25 часов назад — не свежий (в дайджест попадает ровно один раз)", () => {
    expect(isFreshSidecar({ landedAt: "2026-09-20T17:00:00.000Z", publishedAt: "2026-09-20T06:00:00.000Z", now })).toBe(false);
  });

  it("landedAt = null — решает publishedAt: свежий отчёт да, старый нет", () => {
    expect(isFreshSidecar({ landedAt: null, publishedAt: "2026-09-21T06:00:00.000Z", now })).toBe(true);
    expect(isFreshSidecar({ landedAt: null, publishedAt: "2026-09-14T06:00:00.000Z", now })).toBe(false);
  });

  it("нечитаемая дата — не свежий (дайджест просто не покажет блок)", () => {
    expect(isFreshSidecar({ landedAt: "позавчера", publishedAt: "вчера", now })).toBe(false);
  });
});

describe("buildHypothesisIssueBody (AC-2.3)", () => {
  const body = () =>
    buildHypothesisIssueBody({
      reportDate: "2026-09-21",
      funnel: "gazebos",
      step: "slot_selected",
      change: "Показывать свободные слоты прямо на карточке беседки.",
      expected: "Меньше кликов до выбора — часть посетителей сейчас уходит на шаге выбора.",
      baseline: {
        period: CURRENT,
        topSessions: 312,
        endToEndConversion: 6.2,
        endToEndDeltaPp: -1.8,
        stepConversion: 24.7,
        reportPath: "docs/analytics/2026-09-21-funnel-weekly.md",
      },
    });

  it("содержит все четыре обязательные секции", () => {
    const text = body();
    expect(text).toContain("### Что предлагается изменить");
    expect(text).toContain("### Ожидаемый результат и почему");
    expect(text).toContain("### Как измеряем");
    expect(text).toContain("### Baseline (подставлен автоматически из отчёта, не редактировать)");
  });

  it("baseline — числа из сайдкара, а не из прозы агента", () => {
    const text = body();
    expect(text).toContain("- Период: 2026-09-14 … 2026-09-20");
    expect(text).toContain("- Сессий на входе воронки: 312");
    expect(text).toContain("- Конверсия шага от предыдущего: 24.7 %");
    expect(text).toContain("- Сквозная конверсия воронки: 6.2 % (к прошлой неделе: −1.8 п.п.)");
    expect(text).toContain("`docs/analytics/2026-09-21-funnel-weekly.md`");
  });

  it("объясняет, что гипотеза ждёт владельца, и несёт машинный маркер", () => {
    const text = body();
    expect(text).toContain("в работу не берётся, пока владелец не скажет");
    expect(text).toContain("promote <N> P2");
    expect(text).toContain("<!-- funnel-hypothesis: 2026-09-21 gazebos/slot_selected -->");
    expect(text).toContain("Конверсия `view → slot_selected`");
  });

  it("проза агента попадает в отведённые ей секции", () => {
    expect(body()).toContain("Показывать свободные слоты прямо на карточке беседки.");
    expect(body()).toContain("Меньше кликов до выбора");
  });
});

describe("parseHypothesisProse", () => {
  it("разбирает файл агента на две секции", () => {
    const parsed = parseHypothesisProse(
      ["### Что предлагается изменить", "Убрать e-mail из формы.", "", "### Ожидаемый результат и почему", "Меньше полей — выше конверсия."].join("\n"),
    );
    expect(parsed).toEqual({ change: "Убрать e-mail из формы.", expected: "Меньше полей — выше конверсия." });
  });

  it("файл без обязательных секций — null (CLI откажет, а не выдумает)", () => {
    expect(parseHypothesisProse("просто текст")).toBeNull();
    expect(parseHypothesisProse("### Что предлагается изменить\nТолько это")).toBeNull();
  });
});

describe("findPii (AC-2.6)", () => {
  it("ловит email, российский телефон и ИНН", () => {
    expect(findPii("пиши на ivan.petrov@example.com")).toContain("email");
    expect(findPii("звонил +7 916 123-45-67")).toContain("телефон");
    expect(findPii("клиент 89161234567 жаловался")).toContain("телефон");
    expect(findPii("ИНН 7701234567 в заявке")).toContain("ИНН");
    expect(findPii("ИНН 770123456789 в заявке")).toContain("ИНН");
  });

  it("не ложится на обычный русский текст с процентами и датами", () => {
    const text = [
      "Конверсия шага «Выбрал слот» упала с 27.8 % до 24.7 % — это −3.1 п.п. за неделю",
      "2026-09-14 … 2026-09-20. Порог выводов — 30 сессий, заметное изменение — 5 п.п.",
      "Из 312 сессий до брони дошли 19; неделей раньше было 8 из 280.",
    ].join("\n");
    expect(findPii(text)).toBeNull();
  });
});

describe("parseWeeklyStatsExport / statsForPeriod / isStatsExportFresh", () => {
  const exported = {
    schemaVersion: 1,
    generatedAt: "2026-09-21T05:42:11.000Z",
    periods: { current: CURRENT, previous: PREVIOUS },
    rows: [
      { funnel: "gazebos", step: "view", day: "2026-09-14", events: 40, sessions: 30 },
      { funnel: "gazebos", step: "view", day: "2026-09-15", events: 20, sessions: 15 },
      { funnel: "gazebos", step: "slot_selected", day: "2026-09-15", events: 12, sessions: 9 },
      { funnel: "gazebos", step: "view", day: "2026-09-08", events: 100, sessions: 80 },
    ],
  };

  it("валидирует экспорт и отвергает мусор", () => {
    expect(parseWeeklyStatsExport(exported)).not.toBeNull();
    expect(parseWeeklyStatsExport({ ...exported, schemaVersion: 7 })).toBeNull();
    expect(parseWeeklyStatsExport("[]")).toBeNull();
    expect(parseWeeklyStatsExport({ ...exported, rows: [{ funnel: "gazebos" }] })).toBeNull();
  });

  it("складывает дни периода и не берёт чужую неделю", () => {
    const parsed = parseWeeklyStatsExport(exported)!;
    const data = statsForPeriod(parsed.rows, CURRENT);
    const gazebos = data.funnels.find((f) => f.funnel === "gazebos")!;
    expect(gazebos.steps[0]).toMatchObject({ step: "view", events: 60, sessions: 45 });
    expect(gazebos.steps[1]).toMatchObject({ step: "slot_selected", sessions: 9, conversionFromPrev: 20 });
    expect(data.period).toEqual(CURRENT);

    const prevWeek = statsForPeriod(parsed.rows, PREVIOUS);
    expect(prevWeek.funnels.find((f) => f.funnel === "gazebos")!.steps[0].sessions).toBe(80);
  });

  it("свежесть агрегатов считается от generatedAt", () => {
    const now = new Date("2026-09-21T06:00:00.000Z");
    expect(isStatsExportFresh("2026-09-21T05:42:11.000Z", now)).toBe(true);
    expect(isStatsExportFresh("2026-09-19T05:42:11.000Z", now)).toBe(false);
    expect(isStatsExportFresh("никогда", now)).toBe(false);
  });
});
