import { describe, expect, it } from "vitest";
import {
  createChatSchema,
  editMessageSchema,
  markReadSchema,
  messageBodySchema,
  sendMessageSchema,
} from "../validation";

describe("messageBodySchema", () => {
  it("accepts valid body", () => {
    expect(messageBodySchema.parse("Hello")).toBe("Hello");
  });
  it("trims whitespace", () => {
    expect(messageBodySchema.parse("  Hi  ")).toBe("Hi");
  });
  it("rejects empty", () => {
    expect(() => messageBodySchema.parse("   ")).toThrow();
  });
  it("rejects body over 4000 chars", () => {
    expect(() => messageBodySchema.parse("a".repeat(4001))).toThrow();
  });
});

describe("createChatSchema", () => {
  it("parses SUPPORT", () => {
    const result = createChatSchema.parse({ kind: "SUPPORT" });
    expect(result.kind).toBe("SUPPORT");
  });

  it("parses DIRECT with otherUserId", () => {
    const id = "clxxxxxxxxxxxxxxxxxxxxxx";
    const result = createChatSchema.parse({ kind: "DIRECT", otherUserId: id });
    expect(result.kind).toBe("DIRECT");
    if (result.kind === "DIRECT") {
      expect(result.otherUserId).toBe(id);
    }
  });

  it("rejects DIRECT without otherUserId", () => {
    expect(() => createChatSchema.parse({ kind: "DIRECT" })).toThrow();
  });

  it("parses GROUP with title and participants", () => {
    const result = createChatSchema.parse({
      kind: "GROUP",
      title: "Residents",
      participantUserIds: ["clxxxxxxxxxxxxxxxxxxxxxx"],
    });
    expect(result.kind).toBe("GROUP");
    if (result.kind === "GROUP") {
      expect(result.title).toBe("Residents");
    }
  });

  it("rejects GROUP without title", () => {
    expect(() =>
      createChatSchema.parse({
        kind: "GROUP",
        participantUserIds: ["clxxxxxxxxxxxxxxxxxxxxxx"],
      }),
    ).toThrow();
  });

  it("rejects GROUP with too many participants", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `cl${"x".repeat(24)}${i}`.slice(0, 25));
    expect(() =>
      createChatSchema.parse({ kind: "GROUP", title: "Big", participantUserIds: ids }),
    ).toThrow();
  });
});

describe("sendMessageSchema", () => {
  it("parses body", () => {
    const r = sendMessageSchema.parse({ body: "Hey" });
    expect(r.body).toBe("Hey");
    expect(r.clientId).toBeUndefined();
  });
  it("parses body + clientId", () => {
    const r = sendMessageSchema.parse({ body: "Hey", clientId: "abc123" });
    expect(r.clientId).toBe("abc123");
  });
});

describe("editMessageSchema", () => {
  it("accepts valid body", () => {
    expect(editMessageSchema.parse({ body: "Updated" }).body).toBe("Updated");
  });
  it("rejects empty body", () => {
    expect(() => editMessageSchema.parse({ body: "" })).toThrow();
  });
});

describe("markReadSchema", () => {
  it("accepts cuid", () => {
    const id = "clxxxxxxxxxxxxxxxxxxxxxx";
    expect(markReadSchema.parse({ upToMessageId: id }).upToMessageId).toBe(id);
  });
  it("rejects non-cuid", () => {
    expect(() => markReadSchema.parse({ upToMessageId: "not-a-cuid" })).toThrow();
  });
});
