import { describe, it, expect } from "vitest";
import { buildLinkOtpEmail, buildSuperadminLinkInfoEmail } from "../otp-email";

/** PRD 2026-10-25 AC-E3.1 / AC-E3.7 — тексты писем самопривязки. */

describe("buildLinkOtpEmail (AC-E3.1)", () => {
  it("contains the code, the 10-minute validity and «если это были не вы» (text and html)", () => {
    const email = buildLinkOtpEmail("482913");
    for (const body of [email.text, email.html]) {
      expect(body).toContain("482913");
      expect(body).toContain("Код действует 10 минут");
      expect(body).toContain("Если это были не вы — проигнорируйте письмо");
    }
    expect(email.subject).not.toContain("482913");
    expect(email.html).toMatch(/^<!doctype html><html lang="ru">/);
  });

  it("rejects anything but 6 digits (no markup injection)", () => {
    expect(() => buildLinkOtpEmail("<b>1</b>")).toThrow();
    expect(() => buildLinkOtpEmail("12345")).toThrow();
  });
});

describe("buildSuperadminLinkInfoEmail (AC-E3.7)", () => {
  it("explains that a superadmin links Telegram from the profile and carries no code", () => {
    const email = buildSuperadminLinkInfoEmail();
    expect(email.text).toContain("Привязку Telegram к этому аккаунту выполняет суперадмин");
    expect(email.text).toContain("«Привязать Telegram» в профиле");
    expect(email.text).not.toMatch(/\d{6}/);
  });
});
