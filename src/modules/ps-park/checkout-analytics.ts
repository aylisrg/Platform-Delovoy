import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { EVENT_SOURCES } from "@/lib/event-sources";
import { recordFunnelStepAsync, recordPaidStep } from "@/modules/analytics/product-events";

/** Telemetry never delays the checkout response or provider request. */
export function recordPSParkCheckoutAnalytics(input: { bookingId: string; paymentId: string; sessionKey: string | null }): void {
  void (async () => {
    await recordFunnelStepAsync({ funnel: "ps-park", step: "submitted", entityId: input.bookingId, sessionKey: input.sessionKey });
    // An early success webhook may have run before submitted existed. Recover
    // only from the actual payment; a returned confirmation URL proves nothing.
    const payment = await prisma.payment.findFirst({
      where: {
        id: input.paymentId, subjectId: input.bookingId, subjectType: "BOOKING", moduleSlug: "ps-park",
        status: "SUCCEEDED", isTest: false, currency: "RUB",
      },
      select: { amount: true },
    });
    if (payment) await recordPaidStep("ps-park", input.bookingId, { amountRub: Number(payment.amount) });
  })().catch(() => {
    // Analytics failures must not become unhandled promise rejections either.
    try {
      void Promise.resolve(log.warn(EVENT_SOURCES.ANALYTICS_PRODUCT_EVENT, "Не удалось сверить воронку оплаты Плей Парка", {
        bookingId: input.bookingId, paymentId: input.paymentId,
      })).catch(() => {});
    } catch { /* Logger availability is not a checkout prerequisite. */ }
  });
}
