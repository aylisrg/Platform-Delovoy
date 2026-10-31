import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { MetrikaClient } from "./metrika-client";
import { getCampaigns } from "./service";
import { BUSINESS_MODULES, type BusinessMoney, type BusinessPeriod, type BusinessReport } from "./business-types";
const DAY = 86_400_000;
import { businessDay, businessWindow } from "./business-dates";
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
export async function getBusinessReport(period: BusinessPeriod, now = new Date(), includeMarketing = true): Promise<BusinessReport> {
  const { start, end, previousStart, days } = businessWindow(period, now);
  const moduleFilter = { in: [...BUSINESS_MODULES] };
  // Repeatable snapshot avoids discrepancies between cards and exported totals.
  const [ledger, bookings, orders, events] = await prisma.$transaction([
    prisma.financialTransaction.findMany({ where: { moduleSlug: moduleFilter, createdAt: { gte: previousStart, lt: end } }, select: { id: true, moduleSlug: true, type: true, totalAmount: true, cashAmount: true, cardAmount: true, metadata: true, createdAt: true } }),
    prisma.booking.findMany({ where: { moduleSlug: moduleFilter, deletedAt: null, startTime: { gte: previousStart, lt: end } }, select: { id: true, moduleSlug: true, status: true, startTime: true, userId: true } }),
    prisma.order.findMany({ where: { moduleSlug: "cafe", deletedAt: null, createdAt: { gte: previousStart, lt: end } }, select: { id: true, status: true, bookingId: true, createdAt: true, userId: true } }),
    prisma.productEvent.findMany({ where: { moduleSlug: moduleFilter, funnel: moduleFilter, createdAt: { gte: start, lt: end } }, select: { funnel: true, step: true, sessionKey: true, entityId: true } }),
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
  const daily = Array.from({ length: days }, (_, i) => ({ ...emptyMoney(), date: businessDay(new Date(start.getTime() + i * DAY)) }));
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
    else { add(totals, money); add(lines.find(l => l.slug === row.moduleSlug)!, money); const day = daily.find(d => d.date === businessDay(row.createdAt)); if (day) add(day, money); }
  }
  // Operational cohorts use service date for bookings, creation date for cafe orders.
  for (const line of lines) {
    const completedUsers: string[] = [];
    const earlierUsers = new Set<string>();
    for (const b of bookings.filter(b => b.moduleSlug === line.slug)) {
      if (b.startTime < start) { if (b.status === "COMPLETED" && b.userId) earlierUsers.add(b.userId); continue; }
      line.bookings++; if (b.status === "CANCELLED") line.cancelled++; if (b.status === "NO_SHOW") line.noShows++;
      if (b.status === "COMPLETED") { line.completed++; if (b.userId) completedUsers.push(b.userId); else line.unidentifiedOperations++; }
    }
    if (line.slug === "cafe") for (const o of orders) {
      if (o.createdAt < start) { if (o.status === "DELIVERED" && o.userId) earlierUsers.add(o.userId); continue; }
      line.orders++; if (o.bookingId) line.linkedOrders++; if (o.status === "CANCELLED") line.cancelled++;
      if (o.status === "DELIVERED") { line.completed++; if (o.userId) completedUsers.push(o.userId); else line.unidentifiedOperations++; }
    }
    line.knownCustomers = new Set(completedUsers).size;
    line.repeatCustomers = [...new Set(completedUsers)].filter(id => earlierUsers.has(id) || completedUsers.filter(u => u === id).length > 1).length;
  }
  const funnel = BUSINESS_MODULES.map(slug => {
    const paidEntities = new Set(payments.filter(p => p.moduleSlug === slug && !p.isTest && p.currency === "RUB" && ["BOOKING", "ORDER"].includes(p.subjectType) && ["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(p.status)).map(p => p.subjectId));
    const rows = events.filter(e => e.funnel === slug && (e.step !== "paid" || (e.entityId && paidEntities.has(e.entityId))));
    const count = (steps: string[], entity: boolean) => new Set(rows.filter(e => steps.includes(e.step)).map(e => entity ? e.entityId : e.sessionKey).filter(Boolean)).size;
    return { slug, views: count(["view"], false), started: count(["form_started", "cart_item_added", "slot_selected"], false), submitted: count(["submitted"], true), paid: count(["paid"], true) };
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
  return { period: { from, to, timezone: "Europe/Moscow", days }, generatedAt: new Date().toISOString(), totals: rubles(totals), previous: rubles(previous), lines: lines.map(rubles), daily: daily.map(rubles), funnel, quality, marketing };
}
export function businessCsv(report: BusinessReport): string {
  const rows = [["Направление", "Период с", "Период по", "Поступления RUB", "Возвраты RUB", "Корректировки RUB", "Нетто RUB", "Ограничение", "Обновлено", "Методика"]];
  for (const line of report.lines) rows.push([line.label, report.period.from, report.period.to, String(line.receipts), String(line.refunds), String(line.adjustments), String(line.net), line.coverage, report.generatedAt, "МСК; только учтённые проводки; офисы исключены; не прибыль"]);
  return "\uFEFF" + rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(";")).join("\r\n");
}
