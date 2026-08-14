import { describe, it, expect, vi, beforeEach } from "vitest";

// BOT_TOKEN/ADMIN_CHAT_ID в bot/index.ts читаются в module-level const при
// импорте — vi.stubEnv в beforeEach опоздал бы, поэтому ставим до импорта.
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_ADMIN_CHAT_ID = "-100777";
});

const telegramApiMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/telegram/client", () => ({
  telegramApi: telegramApiMock,
}));
vi.mock("../../src/lib/telegram/heartbeat", () => ({
  writeHeartbeat: vi.fn(),
}));
vi.mock("../../src/lib/db", () => ({ prisma: {} }));
vi.mock("../../src/lib/logger", () => ({ logEvent: vi.fn() }));

// sendAlert — единственный экспорт из bot/index.ts, безопасный для импорта
// в тестах: startBot() вызывается только под `require.main === module`,
// что здесь не выполняется (тот же паттерн, что и в bot/handlers/alerts.ts).
import { sendAlert } from "../index";

beforeEach(() => {
  telegramApiMock.mockReset();
  telegramApiMock.mockResolvedValue({ ok: true });
});

describe("sendAlert — экранирование HTML (#534)", () => {
  it("экранирует source/message/details перед отправкой с parse_mode:HTML", async () => {
    await sendAlert(
      "ERROR",
      "<b>evil-source</b>",
      "сообщение <script>alert(1)</script>",
      "детали & <i>подробности</i>"
    );

    expect(telegramApiMock).toHaveBeenCalledOnce();
    const [, payload] = telegramApiMock.mock.calls[0];
    const text = (payload as { text: string }).text;

    expect(text).toContain("&lt;b&gt;evil-source&lt;/b&gt;");
    expect(text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(text).toContain("детали &amp; &lt;i&gt;подробности&lt;/i&gt;");
    expect(text).not.toContain("<b>evil-source</b>");
    expect(text).not.toContain("<script>alert(1)</script>");
    // структурные теги шаблона остаются нетронутыми
    expect(text).toContain("<b>[ERROR]</b>");
  });

  it("не экранирует безобидные source/message без спецсимволов", async () => {
    await sendAlert("INFO", "health-check", "Всё в порядке");

    const [, payload] = telegramApiMock.mock.calls[0];
    const text = (payload as { text: string }).text;
    expect(text).toContain("health-check");
    expect(text).toContain("Всё в порядке");
  });
});
