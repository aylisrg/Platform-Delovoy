// #527: isPublicApiRoute раньше матчила по префиксу (startsWith("/api/gazebos")
// и т.п.) — это открывало анонимный GET-доступ ко ВСЕМ роутам под этими
// префиксами, включая админские с PII (booking history, timeline,
// active-sessions, /api/rental/[id] с полной карточкой арендатора). Эти
// тесты фиксируют точный allowlist: публичные роуты остаются публичными,
// PII-роуты требуют сессию.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { authConfig } from "../auth.config";

function req(pathname: string, method: string = "GET") {
  return new NextRequest(`http://localhost${pathname}`, { method });
}

async function authorized(pathname: string, method: string = "GET") {
  return authConfig.callbacks!.authorized!({
    auth: null,
    request: req(pathname, method),
  } as never);
}

describe("authConfig.authorized — публичные роуты (#527)", () => {
  const publicGetRoutes = [
    "/api/cafe",
    "/api/cafe/health",
    "/api/cafe/menu/images/photo.jpg",
    "/api/gazebos",
    "/api/gazebos/availability",
    "/api/gazebos/health",
    "/api/gazebos/cljabc123resourceid", // GET /api/gazebos/[id] — карточка беседки
    "/api/ps-park",
    "/api/ps-park/availability",
    "/api/ps-park/health",
    "/api/ps-park/cljabc123tableid", // GET /api/ps-park/[id] — карточка стола
    "/api/parking",
    "/api/parking/health",
    "/api/rental/health",
    "/api/inventory",
    "/api/inventory/health",
  ];

  for (const path of publicGetRoutes) {
    it(`GET ${path} доступен анонимно`, async () => {
      expect(await authorized(path)).toBe(true);
    });
  }
});

describe("authConfig.authorized — PII-роуты требуют сессию (#527)", () => {
  const protectedGetRoutes = [
    // Раньше были public по startsWith("/api/gazebos") — отдают
    // clientName/clientPhone/cashAmount/cardAmount анонимно.
    "/api/gazebos/bookings",
    "/api/gazebos/bookings/booking-1",
    "/api/gazebos/timeline",
    // Раньше были public по startsWith("/api/ps-park").
    "/api/ps-park/bookings",
    "/api/ps-park/bookings/booking-1",
    "/api/ps-park/timeline",
    "/api/ps-park/active-sessions",
    // Раньше были public по startsWith("/api/rental") — /api/rental/[id]
    // отдавал полную карточку арендатора (телефон, email, ИНН) анонимно.
    "/api/rental",
    "/api/rental/office-1",
    "/api/rental/contracts",
    "/api/rental/tenants",
  ];

  for (const path of protectedGetRoutes) {
    it(`GET ${path} без сессии → не anonymous-true (401 либо редирект)`, async () => {
      const result = await authorized(path);
      expect(result).not.toBe(true);
    });
  }
});

describe("authConfig.authorized — сохранённые исключения не задеты (#527)", () => {
  it("POST /api/gazebos/book (гостевое бронирование) остаётся публичным", async () => {
    expect(await authorized("/api/gazebos/book", "POST")).toBe(true);
  });

  it("POST /api/cafe/checkout (QR-чекаут) остаётся публичным", async () => {
    expect(await authorized("/api/cafe/checkout", "POST")).toBe(true);
  });

  it("GET /api/payments/pay-1 (поллинг статуса оплаты) остаётся публичным", async () => {
    expect(await authorized("/api/payments/pay-1")).toBe(true);
  });

  it("GET /api/tasks/track/public-id остаётся публичным", async () => {
    expect(await authorized("/api/tasks/track/public-id")).toBe(true);
  });
});
