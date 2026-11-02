import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/logger", () => ({ log: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/payments/service", () => ({
  syncPaymentByProviderId: vi.fn(), syncRefundByProviderId: vi.fn(),
}));
import { syncPaymentByProviderId, syncRefundByProviderId } from "@/modules/payments/service";
import { POST } from "../route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/payments/yookassa/webhook/test-only", {
    method: "POST", body: JSON.stringify(body),
  });
}
const event = {
  type: "notification", event: "payment.succeeded",
  object: { id: "provider-1", status: "succeeded", amount: { value: "999999.00", currency: "RUB" } },
};
const params = Promise.resolve({ secret: "test-only" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("YOOKASSA_WEBHOOK_SECRET", "test-only");
});
afterEach(() => vi.unstubAllEnvs());

describe("YooKassa webhook — проверка источника", () => {
  it("без настройки секрета закрыт", async () => {
    vi.stubEnv("YOOKASSA_WEBHOOK_SECRET", "");
    expect((await POST(request(event), { params })).status).toBe(503);
    expect(syncPaymentByProviderId).not.toHaveBeenCalled();
  });
  it.each(["wrong", "test-only-longer"])("неверный секрет %s не запускает обработку", async (secret) => {
    expect((await POST(request(event), { params: Promise.resolve({ secret }) })).status).toBe(401);
    expect(syncPaymentByProviderId).not.toHaveBeenCalled();
  });
  it("передаёт только id в re-fetch, не доверяет статусу и сумме из тела", async () => {
    expect((await POST(request(event), { params })).status).toBe(200);
    expect(syncPaymentByProviderId).toHaveBeenCalledExactlyOnceWith("provider-1");
    expect(syncRefundByProviderId).not.toHaveBeenCalled();
  });
  it("ошибка re-fetch возвращает 500 для повторной доставки", async () => {
    vi.mocked(syncPaymentByProviderId).mockRejectedValue(new Error("provider unavailable"));
    expect((await POST(request(event), { params })).status).toBe(500);
  });
  it("невалидное уведомление отклоняется", async () => {
    expect((await POST(request({ ...event, object: {} }), { params })).status).toBe(400);
    expect(syncPaymentByProviderId).not.toHaveBeenCalled();
  });
  it("неизвестное событие не меняет платежи", async () => {
    expect((await POST(request({ ...event, event: "unknown" }), { params })).status).toBe(200);
    expect(syncPaymentByProviderId).not.toHaveBeenCalled();
    expect(syncRefundByProviderId).not.toHaveBeenCalled();
  });
});
