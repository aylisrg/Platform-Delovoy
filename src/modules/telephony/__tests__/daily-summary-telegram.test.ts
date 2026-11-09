import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audience: vi.fn(), recheck: vi.fn(), logs: vi.fn(), logCreate: vi.fn(), logUpdate: vi.fn(),
  card: vi.fn(), dispatch: vi.fn(), fetchSummary: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    notificationLog: { findMany: mocks.logs, create: mocks.logCreate, update: mocks.logUpdate },
    inAppNotification: { findFirst: mocks.card },
  },
}));
vi.mock("../novofon-client", () => ({ getNovofonDataApiToken: () => "test-token" }));
vi.mock("@/modules/notifications/audience", () => ({
  resolveStaffRouting: (input: { userIds?: string[] }) => (input.userIds ? mocks.recheck(input) : mocks.audience(input)),
}));
vi.mock("@/modules/notifications/dispatch/dispatcher", () => ({ dispatch: mocks.dispatch }));
vi.mock("../daily-summary-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../daily-summary-service")>()),
  fetchDailySummary: mocks.fetchSummary,
}));

import { TELEPHONY_DAILY_TELEGRAM_EVENT, processTelephonyTelegramSummaries, telegramSummaryClaimId } from "../daily-summary-telegram";

const NOW = new Date("2026-10-24T06:00:00Z"); // 09:00 MSK
const DATE = "2026-10-23";
const routing = (ids: string[]) => ({ recipients: ids.map((userId) => ({ userId, paths: ["default"] })), suppressed: [], groupChat: { send: false, reason: "n/a" } });
const summary = {
  reportDate: DATE, timeZone: "Europe/Moscow", generatedAt: NOW.toISOString(),
  total: 5, inbound: 4, answered: 3, missed: 1, outbound: 1, pending: 0, answerRate: 75,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.audience.mockResolvedValue(routing(["owner"]));
  mocks.recheck.mockResolvedValue(routing(["owner"]));
  mocks.logs.mockResolvedValue([]);
  mocks.logCreate.mockResolvedValue({});
  mocks.logUpdate.mockResolvedValue({});
  mocks.card.mockResolvedValue(null);
  mocks.fetchSummary.mockResolvedValue(summary);
  mocks.dispatch.mockResolvedValue({ status: "queued", outgoingId: "o1", scheduledFor: NOW });
});

describe("processTelephonyTelegramSummaries", () => {
  it("до 09:00 МСК ничего не делает", async () => {
    expect(await processTelephonyTelegramSummaries(new Date("2026-10-24T05:59:00Z"))).toMatchObject({ reportDate: null, queued: 0 });
    expect(mocks.audience).not.toHaveBeenCalled();
  });

  it("берёт получателей из общего резолвера и ставит одно сообщение с агрегатами", async () => {
    const result = await processTelephonyTelegramSummaries(NOW);
    expect(result).toEqual({ reportDate: DATE, queued: 1, skipped: 0 });
    expect(mocks.audience).toHaveBeenCalledWith({ eventType: TELEPHONY_DAILY_TELEGRAM_EVENT, moduleSlug: null });
    expect(mocks.logCreate.mock.calls[0][0].data).toMatchObject({ id: telegramSummaryClaimId(DATE, "owner"), status: "PENDING" });
    const event = mocks.dispatch.mock.calls[0][0];
    expect(event).toMatchObject({ userId: "owner", eventType: TELEPHONY_DAILY_TELEGRAM_EVENT, entityId: DATE });
    expect(event.payload.title).toBe("☎ Звонки за 23.10.2026");
    expect(event.payload.body).toContain("Всего — 5. Принято входящих — 3. Пропущено входящих — 1.");
    expect(mocks.logUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) }));
  });

  it("использует уже сохранённую карточку ленты — без второго запроса к Novofon", async () => {
    mocks.card.mockResolvedValue({ payload: { telephonySummary: summary } });
    await processTelephonyTelegramSummaries(NOW);
    expect(mocks.fetchSummary).not.toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  });

  it("второй прогон за день ничего не шлёт и не ходит к провайдеру", async () => {
    mocks.logs.mockResolvedValue([{ id: telegramSummaryClaimId(DATE, "owner") }]);
    expect(await processTelephonyTelegramSummaries(NOW)).toEqual({ reportDate: DATE, queued: 0, skipped: 1 });
    expect(mocks.fetchSummary).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("сбой провайдера — без claim, следующий прогон повторит", async () => {
    mocks.fetchSummary.mockRejectedValue(new Error("provider down"));
    await expect(processTelephonyTelegramSummaries(NOW)).rejects.toThrow();
    expect(mocks.logCreate).not.toHaveBeenCalled();
  });

  it("выключил или потерял доступ, пока строился отчёт, — пропуск без отправки", async () => {
    mocks.recheck.mockResolvedValue(routing([]));
    expect(await processTelephonyTelegramSummaries(NOW)).toMatchObject({ queued: 0, skipped: 1 });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.logUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "SKIPPED", error: "ACCESS_OR_SUBSCRIPTION_REVOKED" } }));
  });

  it("нет канала доставки — claim закрывается пропуском, без повторов весь день", async () => {
    mocks.dispatch.mockResolvedValue({ status: "skipped", reason: "no available channel" });
    expect(await processTelephonyTelegramSummaries(NOW)).toMatchObject({ queued: 0, skipped: 1 });
    expect(mocks.logUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "SKIPPED", error: "no available channel" } }));
  });
});
