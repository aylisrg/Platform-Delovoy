import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TelephonyDashboard } from "@/modules/telephony/dashboard-types";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/modules/telephony/dashboard-service", () => ({ getTelephonyDashboard: vi.fn() }));

import { auth } from "@/lib/auth";
import { getTelephonyDashboard } from "@/modules/telephony/dashboard-service";
import { TelephonySummaryCard } from "../summary-card";

const snapshot: TelephonyDashboard = {
  period: "today", dateFrom: "2026-10-24", dateTo: "2026-10-24", timeZone: "Europe/Moscow",
  summary: { total: 12, inbound: 10, answered: 7, missed: 2, pending: 1, outbound: 2, answerRate: 77.8, avgTalkSeconds: 80 },
  daily: [], calls: [], pagination: { page: 1, perPage: 25, total: 12, totalPages: 1 },
  source: { dataApiConfigured: true, webhookConfigured: true, lastCallAt: "2026-10-24T12:00:00Z", lastJournalUpdate: "2026-10-24T12:10:00Z" },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "owner", role: "SUPERADMIN" } } as never);
  vi.mocked(getTelephonyDashboard).mockResolvedValue(snapshot);
});

describe("TelephonySummaryCard", () => {
  it.each(["USER", "MANAGER", "ADMIN"])("does not read global calls for %s", async (role) => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "staff", role } } as never);
    expect(await TelephonySummaryCard()).toBeNull();
    expect(getTelephonyDashboard).not.toHaveBeenCalled();
  });

  it("does not read calls without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect(await TelephonySummaryCard()).toBeNull();
    expect(getTelephonyDashboard).not.toHaveBeenCalled();
  });

  it("shows owner metrics and opens the missed journal directly", async () => {
    const html = renderToStaticMarkup(await TelephonySummaryCard());
    expect(getTelephonyDashboard).toHaveBeenCalledWith({ period: "today", filter: "all", page: 1 });
    expect(html).toContain('href="/admin/telephony?filter=missed"');
    expect(html).toContain("Пропущено входящих: 2");
    expect(html).toContain("24-10-2026 15:10");
    expect(html).not.toContain("API подключено");
  });

  it("shows a loading failure instead of a misleading zero", async () => {
    vi.mocked(getTelephonyDashboard).mockRejectedValue(new Error("db unavailable"));
    const html = renderToStaticMarkup(await TelephonySummaryCard());
    expect(html).toContain("Не удалось загрузить статистику");
    expect(html).not.toContain("Всего звонков");
    expect(html).not.toContain("db unavailable");
  });

  it("distinguishes unconfigured sources from an empty journal", async () => {
    vi.mocked(getTelephonyDashboard).mockResolvedValue({
      ...snapshot, source: { dataApiConfigured: false, webhookConfigured: false, lastCallAt: null, lastJournalUpdate: null },
    });
    const html = renderToStaticMarkup(await TelephonySummaryCard());
    expect(html).toContain("Источники Novofon не настроены");
    expect(html).not.toContain("Ожидаем звонки");
  });
});
