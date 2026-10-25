import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Transactional email `sensitive` flag — ADR 2026-10-25-team-access-notifications
 * §5.0 / PRD AC-E3.2: one-time codes never land in logs, even without SMTP.
 */

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn(() => ({ sendMail })) } }));

const ENV_KEYS = ["SMTP_USER", "SMTP_PASS"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

async function load() {
  vi.resetModules();
  return import("../email");
}

type ConsoleSpy = { mock: { calls: unknown[][] }; mockRestore: () => void };
let spies: ConsoleSpy[] = [];
const logged = () => spies.flatMap((s) => s.mock.calls.map((c) => JSON.stringify(c))).join("\n");

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  sendMail.mockReset();
  spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const s of spies) s.mockRestore();
});

describe("sendTransactionalEmail — sensitive", () => {
  it("AC-E3.2: without SMTP a sensitive email fails with SMTP_NOT_CONFIGURED and logs neither body nor recipient", async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const { sendTransactionalEmail, isTransactionalEmailConfigured } = await load();

    expect(isTransactionalEmailConfigured()).toBe(false);
    const res = await sendTransactionalEmail({
      to: "secret@mail.ru",
      subject: "Код",
      html: "<b>482913</b>",
      text: "Ваш код: 482913",
      sensitive: true,
    });

    expect(res).toEqual({ success: false, error: "SMTP_NOT_CONFIGURED" });
    expect(logged()).not.toContain("482913");
    expect(logged()).not.toContain("secret@mail.ru");
  });

  it("non-sensitive emails keep the console fallback without SMTP (unchanged behaviour)", async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const { sendTransactionalEmail } = await load();
    const res = await sendTransactionalEmail({ to: "a@b.ru", subject: "Привет", html: "<p>hi</p>" });
    expect(res).toEqual({ success: true });
    expect(logged()).toContain("<p>hi</p>");
  });

  it("with SMTP a sensitive email is sent; a transport failure logs only the transport message", async () => {
    process.env.SMTP_USER = "robot@x.ru";
    process.env.SMTP_PASS = "pw";
    const { sendTransactionalEmail, isTransactionalEmailConfigured } = await load();
    expect(isTransactionalEmailConfigured()).toBe(true);

    sendMail.mockResolvedValueOnce({});
    expect(await sendTransactionalEmail({ to: "a@b.ru", subject: "s", html: "<b>111222</b>", sensitive: true })).toEqual({
      success: true,
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "a@b.ru", html: "<b>111222</b>" }));

    sendMail.mockRejectedValueOnce(new Error("Connection timeout"));
    const failed = await sendTransactionalEmail({ to: "a@b.ru", subject: "s", html: "<b>333444</b>", sensitive: true });
    expect(failed).toEqual({ success: false, error: "Connection timeout" });
    expect(logged()).toContain("Connection timeout");
    expect(logged()).not.toContain("333444");
  });
});
