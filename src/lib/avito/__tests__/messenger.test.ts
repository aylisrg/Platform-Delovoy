import { describe, it, expect } from "vitest";
import { parseInboundWebhook } from "../messenger";

describe("parseInboundWebhook", () => {
  it("parses a valid messenger webhook payload", () => {
    const payload = {
      id: "evt-1",
      version: "v3.0.0",
      timestamp: 1714300000,
      payload: {
        type: "message",
        value: {
          id: "msg-42",
          chat_id: "chat-7",
          user_id: 555,
          author_id: 999,
          created: 1714300000,
          type: "text",
          content: { text: "Здравствуйте, свободна ли беседка?" },
          item_id: 1234567890,
        },
      },
    };
    const out = parseInboundWebhook(payload);
    expect(out).not.toBeNull();
    expect(out?.avitoMessageId).toBe("msg-42");
    expect(out?.avitoChatId).toBe("chat-7");
    expect(out?.authorAvitoUserId).toBe("999");
    expect(out?.avitoItemId).toBe("1234567890");
    expect(out?.body).toBe("Здравствуйте, свободна ли беседка?");
    expect(out?.receivedAt).toBeInstanceOf(Date);
  });

  it("accepts string-form numeric ids", () => {
    const out = parseInboundWebhook({
      id: "e",
      payload: {
        type: "message",
        value: {
          id: "m",
          chat_id: "c",
          author_id: "1",
          created: 1,
          content: { text: "hi" },
          item_id: "999",
        },
      },
    });
    expect(out?.avitoItemId).toBe("999");
    expect(out?.authorAvitoUserId).toBe("1");
  });

  it("returns null when payload type is not 'message'", () => {
    const out = parseInboundWebhook({
      id: "e",
      payload: {
        type: "read",
        value: { id: "x", chat_id: "c", author_id: 1, created: 1, content: {} },
      },
    });
    expect(out).toBeNull();
  });

  it("returns null when text is empty (image-only or system)", () => {
    const out = parseInboundWebhook({
      id: "e",
      payload: {
        type: "message",
        value: {
          id: "x",
          chat_id: "c",
          author_id: 1,
          created: 1,
          content: {},
        },
      },
    });
    expect(out).toBeNull();
  });

  it("returns null on schema mismatch", () => {
    expect(parseInboundWebhook(null)).toBeNull();
    expect(parseInboundWebhook({ wrong: true })).toBeNull();
    expect(parseInboundWebhook({ id: "x", payload: { type: "message" } })).toBeNull();
  });
});
