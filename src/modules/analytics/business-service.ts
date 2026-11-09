import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { MetrikaClient } from "./metrika-client";
import { getCampaigns } from "./service";
import { BUSINESS_MODULES, type BusinessBucket, type BusinessBucketLine, type BusinessGranularity, type BusinessModule, type BusinessMoney, type BusinessRangeInput, type BusinessReport } from "./business-types";
const DAY = 86_400_000;
import { bucketKey, businessDay, businessWindow, defaultGranularity } from "./business-dates";
export { businessDay, businessWindow } from "./business-dates";
const emptyMoney = (): BusinessMoney => ({ receipts: 0, refunds: 0, adjustments: 0, net: 0, cash: 0, card: 0, online: 0 });
const cents = (value: { toString(): string } | number) => Math.round(Number(value.toString()) * 100);
const object = (value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue | undefined> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const labels = { gazebos: "Барбекю Парк", "ps-park": "Плей Парк", cafe: "Кафе" };
const coverage = {
  gazebos: "Только проводки: ручные предоплаты без записи в кассе не учтены.",
  "ps-park": "Ручные продажи абонементов могут отсутствовать в кассе. Товары в счёте сессии не переносятся повторно в кафе.",
  cafe: "Онлайн-оплаты учтены. Выданный заказ без проводки не подтверждает получение денег.",
};
function add(target: BusinessMoney, source: BusinessMoney) { for (const key of Object.keys(emptyMoney()) as (keyof BusinessMoney)[]) target[key] += source[key]; }
function rubles<T extends BusinessMoney>(money: T): T { for (const key of Object.keys(emptyMoney()) as (keyof BusinessMoney)[]) money[key] /= 100; return money; }
const SESSION_STEPS = ["view", "form_started", "cart_item_added", "slot_selected"];
const emptyBucketLine = (): BusinessBucketLine => ({ ...emptyMoney(), operations: 0, completed: 0, cancelled: 0 });
/** Calendar buckets clipped to the report range; every day of the range maps to exactly one bucket. */
function buildSeries(start: Date, days: number, granularity: BusinessGranularity) {
  const rows: BusinessBucket[] = [];
  const byDay = new Map<string, BusinessBucket>();
  for (let i = 0; i < days; i++) {
    const date = businessDay(new Date(start.getTime() + i * DAY));
    const key = bucketKey(date, granularity);
    let row = rows.at(-1);
    if (!row || bucketKey(row.from, granularity) !== key) {
      row = { ...emptyMoney(), from: date, to: date, lines: Object.fromEntries(BUSINESS_MODULES.map(slug => [slug, emptyBucketLine()])) as Record<BusinessModule, BusinessBucketLine> };
      rows.push(row);
    }
    row.to = date;
    byDay.set(date, row);
  }
  return { rows, byDay };
}
/**
 * Business report for a preset period (completed days up to `now`) or an
 * explicit inclusive Moscow date range. Money comes only from reconciled
 * ledger rows; nothing is estimated or extrapolated.
 */
export async function getBusinessReport(input: BusinessRangeInput, now = new Date(), includeMarketing = true, granularity?: BusinessGranularity): Promise<BusinessReport> {
  const { start, end, previousStart, days } = businessWindow(input, now);
  const series = buildSeries(start, days, granularity ?? defaultGranularity(days));
  const moduleFilter = { in: [...BUSINESS_MODULES] };
  // Repeatable snapshot avoids discrepancies between cards and exported totals.
  const [ledger, bookings, orders, events, sessionCounts] = await prisma.$transaction([
    prisma.financialTransaction.findMany({ where: { moduleSlug: moduleFilter, createdAt: { gte: previousStart, lt: end } }, select: { id: true, moduleSlug: true, type: true, totalAmount: true, cashAmount: true, cardAmount: true, metadata: true, createdAt: true } }),
    prisma.booking.findMany({ where: { moduleSlug: moduleFilter, deletedAt: null, startTime: { gte: previousStart, lt: end } }, select: { id: true, moduleSlug: true, status: true, startTime: true, userId: true } }),
    prisma.order.findMany({ where: { moduleSlug: "cafe", deletedAt: null, createdAt: { gte: previousStart, lt: end } }, select: { id: true, status: true, bookingId: true, createdAt: true, userId: true } }),
    // Entity steps are few; visitor-day steps are counted in SQL so a year of page views never loads into memory.
    prisma.productEvent.findMany({ where: { moduleSlug: moduleFilter, funnel: moduleFilter, step: { in: ["submitted", "paid"] }, createdAt: { gte: start, lt: end } }, select: { funnel: true, step: true, entityId: true } }),
    prisma.$queryRaw<{ funnel: string; stage: string; visitors: number }[]>`
      SELECT "funnel", CASE WHEN "step" = 'view' THEN 'view' ELSE 'started' END AS "stage", COUNT(DISTINCT "sessionKey")::int AS "visitors"
      FROM "ProductEvent"
      WHERE "funnel" IN (${Prisma.join([...BUSINESS_MODULES])}) AND "moduleSlug" IN (${Prisma.join([...BUSINESS_MODULES])})
        AND "step" IN (${Prisma.join(SESSION_STEPS)}) AND "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP BY 1, 2`,
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  const paymentIds = [...new Set(ledger.map(row => object(row.metadata).paymentId).filter((id): id is string => typeof id === "string"))];
  const payments = await prisma.payment.findMany({ where: { moduleSlug: moduleFilter, OR: [{ id: { in: paymentIds } }, { paidAt: { gte: previousStart, lt: end }, isTest: false, currency: "RUB", subjectType: { in: ["BOOKING", "ORDER", "SUBSCRIPTION"] }, status: { in: ["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"] } }] }, select: { id: true, isTest: true, currency: true, moduleSlug: true, subjectType: true, subjectId: true, status: true, amount: true, paidAt: true } });
  // Search ledger references outside the window too: a replay across a date
  // boundary must not turn the same payment/refund into new money.
  const references = payments.length ? await prisma.financialTransaction.findMany({
    where: { moduleSlug: moduleFilter, OR: payments.map(p => ({ metadata: { path: ["paymentId"], equals: p.id } })) },
    select: { id: true, moduleSlug: true, type: true, totalAmount: true, metadata: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  }) : [];
  const paymentMap = new Map(payments.map(p => [p.id, p]));
  const refundIds = [...new Set(ledger.filter(row => row.type === "REFUND").map(row => object(row.metadata).refundId).filter((id): id is string => typeof id === "string"))];
  const refunds = refundIds.length ? await prisma.paymentRefund.findMany({ where: { id: { in: refundIds } }, select: { id: true, paymentId: true, status: true, amount: true } }) : [];
  const refundMap = new Map(refunds.map(r => [r.id, r]));
  const firstReference = new Map<string, string>();
  for (const row of references) {
    const meta = object(row.metadata);
    const payment = typeof meta.paymentId === "string" ? paymentMap.get(meta.paymentId) : undefined;
    if (!payment || payment.isTest || payment.currency !== "RUB" || payment.moduleSlug !== row.moduleSlug || !["BOOKING", "ORDER", "SUBSCRIPTION"].includes(payment.subjectType) || !["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.status)) continue;
    let key: string | null = null;
    if (row.type === "ONLINE_PAYMENT" && cents(row.totalAmount) === cents(payment.amount)) key = `payment:${payment.id}`;
    if (row.type === "REFUND" && typeof meta.refundId === "string") {
      const refund = refundMap.get(meta.refundId);
      if (refund && refund.paymentId === payment.id && refund.status === "succeeded" && cents(row.totalAmount) === -cents(refund.amount)) key = `refund:${refund.id}`;
    }
    if (key && !firstReference.has(key)) firstReference.set(key, row.id);
  }
  const lines = BUSINESS_MODULES.map(slug => ({ ...emptyMoney(), slug, label: labels[slug], bookings: 0, completed: 0, cancelled: 0, noShows: 0, orders: 0, linkedOrders: 0, knownCustomers: 0, repeatCustomers: 0, unidentifiedOperations: 0, coverage: coverage[slug] }));
  const totals = emptyMoney(), previous = emptyMoney();
  const quality = { excludedLedgerRows: 0, duplicateLedgerRows: 0, unknownPaymentRows: 0, warnings: ["Это учтённое движение денег, не полная выручка и не прибыль.", "Офисы исключены. Парковка и сауна: денежные источники не подключены.", "Абонемент: деньги при продаже; расход часов не является новой оплатой.", "Повторные клиенты определяются только среди известных userId в текущем и предыдущем периодах. Гости и объединения аккаунтов ограничивают полноту.", "Воронка отражает события сайта: visitor-day для просмотра/начала и сущности для отправки/оплаты. Это не когортная конверсия; paid покрывает только часть онлайн-оплат."] };
  const missingLedger = payments.filter(p => !p.isTest && p.paidAt && p.paidAt >= previousStart && p.paidAt < end && !firstReference.has(`payment:${p.id}`)).length;
  if (missingLedger) quality.warnings.push(`Успешные онлайн-платежи без кассовой записи: ${missingLedger}. Нужна сверка, суммы не добавлены автоматически.`);
  const seen = new Set<string>();
  for (const row of ledger) {
    if (!BUSINESS_MODULES.includes(row.moduleSlug as typeof BUSINESS_MODULES[number])) continue;
    const meta = object(row.metadata), value = cents(row.totalAmount);
    let key = row.id;
    if (row.type === "ONLINE_PAYMENT" || row.type === "REFUND") {
      const payment = typeof meta.paymentId === "string" ? paymentMap.get(meta.paymentId) : undefined;
      if (!payment || payment.isTest || payment.currency !== "RUB" || payment.moduleSlug !== row.moduleSlug || !["BOOKING", "ORDER", "SUBSCRIPTION"].includes(payment.subjectType) || !["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.status)) {
        quality.excludedLedgerRows++; if (!payment) quality.unknownPaymentRows++; continue;
      }
      if (row.type === "REFUND") {
        const refund = typeof meta.refundId === "string" ? refundMap.get(meta.refundId) : undefined;
        if (!refund || refund.paymentId !== payment.id || refund.status !== "succeeded" || value !== -cents(refund.amount)) { quality.excludedLedgerRows++; continue; }
        key = `refund:${refund.id}`;
      } else {
        if (value !== cents(payment.amount)) { quality.excludedLedgerRows++; continue; }
        key = `payment:${payment.id}`;
      }
    }
    if (seen.has(key) || (firstReference.has(key) && firstReference.get(key) !== row.id)) { quality.duplicateLedgerRows++; continue; } seen.add(key);
    if ((row.type !== "REFUND" && value < 0) || (row.type === "REFUND" && value > 0)) { quality.excludedLedgerRows++; continue; }
    const money = emptyMoney();
    if (row.type === "REFUND") money.refunds = -value;
    else if (row.type === "ADJUSTMENT") money.adjustments = value;
    else money.receipts = value;
    if (row.type === "ONLINE_PAYMENT") money.online = value;
    else if (row.type !== "REFUND") { money.cash = cents(row.cashAmount); money.card = cents(row.cardAmount); }
    money.net = money.receipts + money.adjustments - money.refunds;
    if (row.createdAt < start) add(previous, money);
    else {
      add(totals, money); add(lines.find(l => l.slug === row.moduleSlug)!, money);
      const bucket = series.byDay.get(businessDay(row.createdAt));
      if (bucket) { add(bucket, money); add(bucket.lines[row.moduleSlug as BusinessModule], money); }
    }
  }
  // Operational cohorts use service date for bookings, creation date for cafe orders.
  for (const line of lines) {
    const completedUsers: string[] = [];
    const earlierUsers = new Set<string>();
    for (const b of bookings.filter(b => b.moduleSlug === line.slug)) {
      if (b.startTime < start) { if (b.status === "COMPLETED" && b.userId) earlierUsers.add(b.userId); continue; }
      line.bookings++; if (b.status === "CANCELLED") line.cancelled++; if (b.status === "NO_SHOW") line.noShows++;
      const slice = series.byDay.get(businessDay(b.startTime))?.lines[line.slug];
      if (slice) { slice.operations++; if (b.status === "CANCELLED") slice.cancelled++; if (b.status === "COMPLETED") slice.completed++; }
      if (b.status === "COMPLETED") { line.completed++; if (b.userId) completedUsers.push(b.userId); else line.unidentifiedOperations++; }
    }
    if (line.slug === "cafe") for (const o of orders) {
      if (o.createdAt < start) { if (o.status === "DELIVERED" && o.userId) earlierUsers.add(o.userId); continue; }
      line.orders++; if (o.bookingId) line.linkedOrders++; if (o.status === "CANCELLED") line.cancelled++;
      const slice = series.byDay.get(businessDay(o.createdAt))?.lines.cafe;
      if (slice) { slice.operations++; if (o.status === "CANCELLED") slice.cancelled++; if (o.status === "DELIVERED") slice.completed++; }
      if (o.status === "DELIVERED") { line.completed++; if (o.userId) completedUsers.push(o.userId); else line.unidentifiedOperations++; }
    }
    line.knownCustomers = new Set(completedUsers).size;
    line.repeatCustomers = [...new Set(completedUsers)].filter(id => earlierUsers.has(id) || completedUsers.filter(u => u === id).length > 1).length;
  }
  const funnel = BUSINESS_MODULES.map(slug => {
    const paidEntities = new Set(payments.filter(p => p.moduleSlug === slug && !p.isTest && p.currency === "RUB" && ["BOOKING", "ORDER"].includes(p.subjectType) && ["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(p.status)).map(p => p.subjectId));
    const rows = events.filter(e => e.funnel === slug && (e.step !== "paid" || (e.entityId && paidEntities.has(e.entityId))));
    const entities = (step: string) => new Set(rows.filter(e => e.step === step).map(e => e.entityId).filter(Boolean)).size;
    const visitors = (stage: string) => Number(sessionCounts.find(c => c.funnel === slug && c.stage === stage)?.visitors ?? 0);
    return { slug, views: visitors("view"), started: visitors("started"), submitted: entities("submitted"), paid: entities("paid") };
  });
  const from = businessDay(start), to = businessDay(new Date(end.getTime() - 1));
  const marketing: BusinessReport["marketing"] = { visits: null, adSpend: null, clicks: null, fetchedAt: new Date().toISOString(), scope: "Весь сайт и рекламный кабинет, включая офисы. Не входят в бизнес-итоги; сквозная атрибуция платежей отсутствует." };
  if (includeMarketing && process.env.YANDEX_OAUTH_TOKEN) {
    const [traffic, ads] = await Promise.allSettled([
      new MetrikaClient(process.env.YANDEX_OAUTH_TOKEN, process.env.YANDEX_METRIKA_COUNTER_ID || "73068007").getTrafficSummary(from, to),
      getCampaigns({ dateFrom: from, dateTo: to }, false),
    ]);
    if (traffic.status === "fulfilled") marketing.visits = traffic.value.visits;
    if (ads.status === "fulfilled") { marketing.adSpend = ads.value.totals.cost; marketing.clicks = ads.value.totals.clicks; marketing.fetchedAt = ads.value.cachedAt; }
  }
  return { period: { from, to, timezone: "Europe/Moscow", days }, generatedAt: new Date().toISOString(), totals: rubles(totals), previous: rubles(previous), lines: lines.map(rubles), series: { granularity: granularity ?? defaultGranularity(days), rows: series.rows.map(row => { rubles(row); for (const slug of BUSINESS_MODULES) rubles(row.lines[slug]); return row; }) }, funnel, quality, marketing };
}
const GRANULARITY_LABEL: Record<BusinessGranularity, string> = { day: "День", week: "Неделя", month: "Месяц" };
/**
 * One flat table for Excel: whole-period totals per direction first, then one
 * row per bucket × direction plus a bucket total. Every number is a sum of the
 * same reconciled ledger rows the screen shows.
 */
export function businessCsv(report: BusinessReport): string {
  const header = ["Срез", "Период с", "Период по", "Направление", "Поступления RUB", "Возвраты RUB", "Корректировки RUB", "Нетто RUB", "Наличные RUB", "Терминал RUB", "Онлайн RUB", "Брони / заказы", "Завершено", "Отменено", "Ограничение", "Обновлено", "Методика"];
  const method = "МСК; только учтённые проводки; офисы исключены; не прибыль";
  const money = (m: BusinessMoney) => [m.receipts, m.refunds, m.adjustments, m.net, m.cash, m.card, m.online].map(String);
  const rows = [header];
  for (const line of report.lines) {
    const operations = line.slug === "cafe" ? line.orders : line.bookings;
    rows.push(["Итог периода", report.period.from, report.period.to, line.label, ...money(line), String(operations), String(line.completed), String(line.cancelled), line.coverage, report.generatedAt, method]);
  }
  rows.push(["Итог периода", report.period.from, report.period.to, "Все направления", ...money(report.totals), "", "", "", "", report.generatedAt, method]);
  const slice = GRANULARITY_LABEL[report.series.granularity];
  for (const bucket of report.series.rows) {
    for (const line of report.lines) {
      const part = bucket.lines[line.slug];
      rows.push([slice, bucket.from, bucket.to, line.label, ...money(part), String(part.operations), String(part.completed), String(part.cancelled), "", report.generatedAt, method]);
    }
    rows.push([slice, bucket.from, bucket.to, "Все направления", ...money(bucket), "", "", "", "", report.generatedAt, method]);
  }
  return "\uFEFF" + rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(";")).join("\r\n");
}
