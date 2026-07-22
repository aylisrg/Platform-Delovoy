import { describe, it, expect } from "vitest";
import { buildChannelTestMessage } from "../test-message";

describe("buildChannelTestMessage", () => {
  it("builds the unified HTML test text with the channel name", () => {
    expect(buildChannelTestMessage("Кафе")).toBe(
      "✅ Это тестовое сообщение в канал «<b>Кафе</b>» от Бота Деловой.\n\nВсё работает штатно."
    );
  });

  it("escapes HTML-significant characters in the channel name", () => {
    const text = buildChannelTestMessage("A & B <x>");
    expect(text).toContain("«<b>A &amp; B &lt;x&gt;</b>»");
    expect(text).not.toContain("<x>");
  });
});
