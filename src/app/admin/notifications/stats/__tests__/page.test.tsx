import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * /admin/notifications/stats — server gate (ADR 2026-10-25 §7, PRD AC-D1.1):
 * no session → sign-in with a way back; not SUPERADMIN → /admin/forbidden.
 * Plus the «Уведомления» tabs on the routing page (Матрица/Статистика only
 * for SUPERADMIN).
 */

const mockAuth = vi.fn();
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
vi.mock("@/components/admin/header", () => ({ AdminHeader: () => null }));
vi.mock("@/components/admin/notifications/stats/stats-page", () => ({ StatsPage: () => null }));
vi.mock("@/components/admin/notifications/NotificationRouting", () => ({ NotificationRouting: () => null }));
vi.mock("@/components/admin/notifications/WebPushOptIn", () => ({ WebPushOptIn: () => null }));

import { renderToStaticMarkup } from "react-dom/server";
import NotificationStatsPage from "../page";
import NotificationsRoutingPage from "../../page";

beforeEach(() => {
  vi.clearAllMocks();
});

function hrefs(node: ReactElement): string[] {
  return [...renderToStaticMarkup(node).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

describe("/admin/notifications/stats gate (AC-D1.1)", () => {
  it("guest → /auth/signin with callbackUrl back to the page", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(NotificationStatsPage()).rejects.toThrow(
      "NEXT_REDIRECT:/auth/signin?callbackUrl=%2Fadmin%2Fnotifications%2Fstats",
    );
  });

  it.each(["ADMIN", "MANAGER", "USER"])("AC-D1.1: %s → /admin/forbidden", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "x", role, adminSections: ["notifications"] } });
    await expect(NotificationStatsPage()).rejects.toThrow("NEXT_REDIRECT:/admin/forbidden");
  });

  it("SUPERADMIN gets the page with the tabs", async () => {
    mockAuth.mockResolvedValue({ user: { id: "sa", role: "SUPERADMIN", adminSections: [] } });
    const links = hrefs(await NotificationStatsPage());
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(links).toEqual([
      "/admin/notifications",
      "/admin/notifications/matrix",
      "/admin/notifications/stats",
      "/admin/notifications/broadcast",
    ]);
  });
});

describe("notification tabs on /admin/notifications", () => {
  it("SUPERADMIN sees Маршрутизация / Матрица / Статистика / Рассылка", async () => {
    mockAuth.mockResolvedValue({ user: { id: "sa", role: "SUPERADMIN", adminSections: [] } });
    const html = renderToStaticMarkup(await NotificationsRoutingPage());
    for (const label of ["Маршрутизация", "Матрица", "Статистика", "Рассылка"]) expect(html).toContain(label);
    expect(html).toContain('aria-current="page"');
  });

  it("others don't get the SUPERADMIN-only Матрица / Статистика links", async () => {
    mockAuth.mockResolvedValue({ user: { id: "m", role: "MANAGER", adminSections: ["notifications"] } });
    const links = hrefs(await NotificationsRoutingPage());
    expect(links).toEqual(["/admin/notifications", "/admin/notifications/broadcast"]);
  });
});
