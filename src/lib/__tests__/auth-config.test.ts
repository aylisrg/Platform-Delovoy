import { describe, it, expect } from "vitest";
import { authConfig } from "@/lib/auth.config";

/**
 * Матрица публичных маршрутов authorized() (middleware-слой).
 * Проверяем контракт для гостевого чекаута кафе и платёжного контура:
 * анонимные запросы либо проходят к роуту (true — у роута своя защита),
 * либо получают 401 Response.
 */

type AuthorizedResult = boolean | Response;

async function authorize(
  method: string,
  pathname: string,
  auth: unknown = null
): Promise<AuthorizedResult> {
  const authorized = authConfig.callbacks?.authorized;
  if (!authorized) throw new Error("authorized callback is not defined");
  return (await authorized({
    auth,
    request: { method, nextUrl: new URL(`http://localhost${pathname}`) },
  } as never)) as AuthorizedResult;
}

async function expectAnon401(result: AuthorizedResult) {
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(401);
}

describe("authorized(): гостевой чекаут кафе", () => {
  it("анонимный POST /api/cafe/checkout проходит к роуту", async () => {
    expect(await authorize("POST", "/api/cafe/checkout")).toBe(true);
  });

  it("анонимный GET /api/cafe (меню) по-прежнему открыт", async () => {
    expect(await authorize("GET", "/api/cafe")).toBe(true);
  });

  it("анонимный POST /api/cafe/order (легаси-роут) остаётся за сессией", async () => {
    await expectAnon401(await authorize("POST", "/api/cafe/order"));
  });
});

describe("authorized(): платёжный контур", () => {
  it("анонимный GET /api/payments/{id} (поллинг страницы оплаты) проходит", async () => {
    expect(await authorize("GET", "/api/payments/clxyzabc123")).toBe(true);
  });

  it("админский список GET /api/payments (без trailing slash) остаётся за сессией", async () => {
    await expectAnon401(await authorize("GET", "/api/payments"));
  });

  it("POST вебхука ЮKassa проходит (роут сам сверяет секрет)", async () => {
    expect(
      await authorize("POST", "/api/payments/yookassa/webhook/whsec123")
    ).toBe(true);
  });

  it("GET reconciliation-cron проходит (роут сам сверяет CRON_SECRET)", async () => {
    expect(await authorize("GET", "/api/cron/payments-reconcile")).toBe(true);
  });

  it("другие /api/cron/* остаются закрытыми (фикс отдельным issue)", async () => {
    await expectAnon401(await authorize("GET", "/api/cron/process-outgoing"));
  });

  it("POST /api/payments/{id}/refund остаётся за сессией", async () => {
    // isPublicApiRoute действует только на GET; POST по этому префиксу — 401.
    await expectAnon401(await authorize("POST", "/api/payments/clxyz/refund"));
  });
});

describe("authorized(): юридические документы и управление бронью", () => {
  it("анонимный GET /api/legal/current проходит — форма должна знать редакцию", async () => {
    expect(await authorize("GET", "/api/legal/current")).toBe(true);
  });

  it("анонимный GET /api/booking/{token} проходит — страница работает без входа", async () => {
    expect(await authorize("GET", "/api/booking/AbCdEf0123456789")).toBe(true);
  });

  it("анонимный POST /api/booking/{token} проходит — отмена и перенос по токену", async () => {
    expect(await authorize("POST", "/api/booking/AbCdEf0123456789")).toBe(true);
  });

  it("голый /api/booking (без токена) остаётся за сессией", async () => {
    await expectAnon401(await authorize("GET", "/api/booking"));
    await expectAnon401(await authorize("POST", "/api/booking"));
  });

  it("админские роуты броней анонимно не открываются", async () => {
    await expectAnon401(await authorize("GET", "/api/gazebos/bookings"));
    await expectAnon401(await authorize("GET", "/api/gazebos/timeline"));
  });
});
