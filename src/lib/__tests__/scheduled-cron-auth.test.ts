import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { authConfig } from "../auth.config";

// Exercise the real proxy authorization decision AND the real route guards.
// Only business work is mocked: no database, external calls or deliveries.
vi.mock("@/modules/inventory/service-v2", () => ({ getExpiringBatches: vi.fn().mockResolvedValue([]) }));
vi.mock("@/modules/inventory/alerts", () => ({ runLowStockAlertSweep: vi.fn().mockResolvedValue({ checked: 0, alerted: 0 }) }));
vi.mock("@/modules/telephony/calls-sync", () => ({ syncNovofonCalls: vi.fn().mockResolvedValue({ skipped: false }), NovofonApiError: class extends Error {} }));
vi.mock("@/modules/rental/scheduler", () => ({ runRentalPaymentReminders: vi.fn().mockResolvedValue({}) }));
vi.mock("@/modules/booking/overdue-reminders", () => ({ scanAndDispatchOverdue: vi.fn().mockResolvedValue({}) }));
vi.mock("@/modules/management/service", () => ({ processRecurring: vi.fn().mockResolvedValue({}) }));
vi.mock("@/modules/notifications/scheduler", () => ({ processScheduledNotifications: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/modules/notifications/dispatch/dispatcher", () => ({ processOutgoing: vi.fn().mockResolvedValue({}) }));
vi.mock("@/modules/payments/service", () => ({ reconcilePayments: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/yookassa/client", () => ({ isYooKassaConfigured: () => true }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getExpiringBatches } from "@/modules/inventory/service-v2";
import { runLowStockAlertSweep } from "@/modules/inventory/alerts";
import { syncNovofonCalls } from "@/modules/telephony/calls-sync";
import { runRentalPaymentReminders } from "@/modules/rental/scheduler";
import { scanAndDispatchOverdue } from "@/modules/booking/overdue-reminders";
import { processRecurring } from "@/modules/management/service";
import { processScheduledNotifications } from "@/modules/notifications/scheduler";
import { processOutgoing } from "@/modules/notifications/dispatch/dispatcher";
import { reconcilePayments } from "@/modules/payments/service";
import { GET as inventory } from "@/app/api/cron/inventory/route";
import { GET as novofon } from "@/app/api/cron/novofon-calls-sync/route";
import { GET as rental } from "@/app/api/cron/rental-payment-reminders/route";
import { GET as overdue } from "@/app/api/cron/overdue-session-reminders/route";
import { GET as recurring } from "@/app/api/cron/process-recurring/route";
import { GET as notifications } from "@/app/api/cron/notifications/route";
import { GET as outgoing } from "@/app/api/cron/process-outgoing/route";
import { GET as payments } from "@/app/api/cron/payments-reconcile/route";

const scheduled = [
  { slug: "inventory", handler: inventory, work: getExpiringBatches },
  { slug: "novofon-calls-sync", handler: novofon, work: syncNovofonCalls },
  { slug: "rental-payment-reminders", handler: rental, work: runRentalPaymentReminders },
  { slug: "overdue-session-reminders", handler: overdue, work: scanAndDispatchOverdue },
  { slug: "process-recurring", handler: recurring, work: processRecurring },
  { slug: "notifications", handler: notifications, work: processScheduledNotifications },
  { slug: "process-outgoing", handler: outgoing, work: processOutgoing },
  { slug: "payments-reconcile", handler: payments, work: reconcilePayments },
];

function authorize(request: NextRequest) {
  return authConfig.callbacks!.authorized!({ request, auth: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "test-only-cron-secret");
  vi.stubEnv("NEXTAUTH_SECRET", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("scheduled cron proxy → handler authentication", () => {
  it("covers every cron registered by deployment", () => {
    const deploy = readFileSync(".github/workflows/deploy.yml", "utf8");
    const deployed = [...deploy.matchAll(/upsert_cron '\/api\/cron\/([^']+)'/g)].map((m) => m[1]);
    expect(scheduled.map((r) => r.slug).sort()).toEqual(deployed.sort());
  });

  for (const { slug, handler, work } of scheduled) {
    describe(slug, () => {
      async function dispatch(header?: string, query = "") {
        const request = new NextRequest(`http://localhost/api/cron/${slug}${query}`, {
          headers: header ? { authorization: header } : {},
        });
        const decision = await authorize(request);
        // Do not silently bypass a denial from the proxy in a handler-only test.
        expect(decision).toBe(true);
        return handler(request);
      }

      it("accepts Bearer without a NextAuth session and runs work once", async () => {
        expect((await dispatch("Bearer test-only-cron-secret")).status).toBe(200);
        expect(work).toHaveBeenCalledTimes(1);
      });

      it.each([undefined, "Bearer wrong", "Basic test-only-cron-secret", "Bearer"])(
        "rejects missing/invalid authorization (%s) before any work", async (header) => {
          const response = await dispatch(header);
          expect(response.status).toBe(401);
          expect((await response.json()).error.code).toBe("UNAUTHORIZED");
          for (const route of scheduled) expect(route.work).not.toHaveBeenCalled();
          expect(runLowStockAlertSweep).not.toHaveBeenCalled();
        },
      );

      it("rejects a secret in the query string", async () => {
        expect((await dispatch(undefined, "?token=test-only-cron-secret")).status).toBe(401);
        expect(work).not.toHaveBeenCalled();
      });

      it("fails closed when no cron secret is configured", async () => {
        vi.stubEnv("CRON_SECRET", "");
        expect((await dispatch("Bearer test-only-cron-secret")).status).toBe(503);
        expect(work).not.toHaveBeenCalled();
      });

      it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD"])("does not exempt %s from session auth", async (method) => {
        const decision = await authorize(new NextRequest(`http://localhost/api/cron/${slug}`, { method }));
        expect(decision).toBeInstanceOf(Response);
        expect((decision as Response).status).toBe(401);
      });

      it.each(["/other", "-other"])("does not exempt neighboring paths (%s)", async (suffix) => {
        const decision = await authorize(new NextRequest(`http://localhost/api/cron/${slug}${suffix}`));
        expect((decision as Response).status).toBe(401);
      });
    });
  }

  it.each([
    "/api/cron/avito-account-sync", "/api/cron/avito-reviews-sync",
    "/api/cron/avito-stats-sync", "/api/cron/avito-messenger-poll",
    "/api/cron/no-show", "/api/ps-park/auto-complete", "/api/cron/future-job",
  ])("keeps unscheduled/unknown routes behind the session guard: %s", async (path) => {
    const decision = await authorize(new NextRequest(`http://localhost${path}`));
    expect((decision as Response).status).toBe(401);
  });
});
