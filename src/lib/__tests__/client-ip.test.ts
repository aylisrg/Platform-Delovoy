import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { getClientIp } from "../client-ip";

function req(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

describe("getClientIp", () => {
  it("предпочитает X-Real-IP (его ставит nginx из $remote_addr)", () => {
    expect(
      getClientIp(req({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "6.6.6.6, 9.9.9.9" }))
    ).toBe("9.9.9.9");
  });

  it("из XFF берёт ПОСЛЕДНИЙ hop — его добавил nginx, начало спуфится", () => {
    expect(getClientIp(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("клиентский спуф XFF не влияет на ключ", () => {
    // Клиент прислал XFF: "evil-string"; nginx дописал реальный адрес.
    expect(getClientIp(req({ "x-forwarded-for": "evil-string, 9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("одиночный XFF (прямое обращение к nginx) работает", () => {
    expect(getClientIp(req({ "x-forwarded-for": "5.5.5.5" }))).toBe("5.5.5.5");
  });

  it("без заголовков — unknown", () => {
    expect(getClientIp(req({}))).toBe("unknown");
  });

  it("пустые/пробельные значения не ломают разбор", () => {
    expect(getClientIp(req({ "x-forwarded-for": " , , " }))).toBe("unknown");
    expect(getClientIp(req({ "x-real-ip": "  " , "x-forwarded-for": "7.7.7.7" }))).toBe("7.7.7.7");
  });
});
