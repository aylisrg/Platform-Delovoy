import type { BusinessMoney, BusinessPreference, BusinessReport } from "../../src/modules/analytics/business-types";

// Fabricated UI-only data. Never seed these amounts into any database.
const money = (receipts: number, refunds: number, adjustments: number, cash: number, card: number, online: number): BusinessMoney => ({
  receipts, refunds, adjustments, net: receipts + adjustments - refunds, cash, card, online,
});

export const populatedBusinessReport: BusinessReport = {
  period: { from: "2026-10-19", to: "2026-10-25", timezone: "Europe/Moscow", days: 7 },
  generatedAt: "2026-10-26T06:00:00.000Z",
  totals: money(180000, 20000, 2500, 56500, 62000, 64000),
  previous: money(150000, 7000, 0, 40000, 50000, 60000),
  lines: [
    { ...money(80000, 10000, 0, 20000, 10000, 50000), slug: "gazebos", label: "Барбекю Парк", bookings: 24, completed: 18, cancelled: 4, noShows: 2, orders: 0, linkedOrders: 0, knownCustomers: 14, repeatCustomers: 5, unidentifiedOperations: 4, coverage: "Ручные авансы без финансовой проводки могут отсутствовать. Отмена брони сама по себе не означает возврат." },
    { ...money(70000, 8000, 2000, 25000, 40000, 7000), slug: "ps-park", label: "Плей Парк", bookings: 78, completed: 66, cancelled: 9, noShows: 3, orders: 0, linkedOrders: 0, knownCustomers: 48, repeatCustomers: 21, unidentifiedOperations: 12, coverage: "Списания часов абонемента не создают новые поступления. Ручные продажи абонементов без проводки не включены." },
    { ...money(30000, 2000, 500, 11500, 12000, 7000), slug: "cafe", label: "Кафе", bookings: 0, completed: 43, cancelled: 4, noShows: 0, orders: 47, linkedOrders: 17, knownCustomers: 29, repeatCustomers: 11, unidentifiedOperations: 14, coverage: "Связанный заказ не прибавляется к оплате сессии повторно. Выданные заказы без финансовой проводки не включены." },
  ],
  daily: [
    { date: "2026-10-19", ...money(10000, 0, 0, 3000, 2000, 5000) },
    { date: "2026-10-20", ...money(22000, 1000, 0, 6000, 8000, 8000) },
    { date: "2026-10-21", ...money(8000, 12000, 500, 2500, 2000, 4000) },
    { date: "2026-10-22", ...money(0, 0, 0, 0, 0, 0) },
    { date: "2026-10-23", ...money(45000, 5000, 0, 15000, 20000, 10000) },
    { date: "2026-10-24", ...money(63000, 0, 2000, 20000, 20000, 25000) },
    { date: "2026-10-25", ...money(32000, 2000, 0, 10000, 10000, 12000) },
  ],
  funnel: [
    { slug: "gazebos", views: 1240, started: 176, submitted: 24, paid: 15 },
    { slug: "ps-park", views: 2310, started: 302, submitted: 78, paid: 31 },
    { slug: "cafe", views: 890, started: 121, submitted: 47, paid: 19 },
  ],
  quality: {
    excludedLedgerRows: 4, duplicateLedgerRows: 2, unknownPaymentRows: 1,
    warnings: [
      "СИНТЕТИЧЕСКИЕ ДАННЫЕ ДЛЯ QA — это не показатели действующего бизнеса.",
      "Есть успешные реальные оплаты без финансовой проводки: проверьте сверку источников.",
      "Учёт частичный: ручные авансы, абонементы и офлайн-заказы без проводки могут отсутствовать.",
      "Рекламные расходы не связаны с конкретными платежами. Прибыль, ROAS и CAC не рассчитываются.",
    ],
  },
  marketing: { visits: 12840, adSpend: 21450.75, clicks: 1460, fetchedAt: "2026-10-26T06:00:00.000Z", scope: "Весь сайт и рекламный кабинет, включая страницы офисов. Это контекст привлечения, он не входит в бизнес-итоги." },
};

export const syntheticBusinessPreference: BusinessPreference = {
  enabled: false, telegramReady: false, timezone: "Europe/Moscow",
  schedule: "Понедельник после 09:00 МСК, за предыдущие понедельник–воскресенье",
  lastDelivery: null,
};
