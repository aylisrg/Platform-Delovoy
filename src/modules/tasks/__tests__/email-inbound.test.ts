import { describe, it, expect, vi } from "vitest";
import { processIncomingMessage, type InboundDeps } from "../email-inbound";

function makeDeps(overrides: Partial<InboundDeps> = {}): InboundDeps {
  return {
    findTaskByPublicId: vi.fn().mockResolvedValue(null),
    findCommentByMessageId: vi.fn().mockResolvedValue(false),
    findTaskByEmailThreadId: vi.fn().mockResolvedValue(null),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    categorizeByKeywords: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("processIncomingMessage — skip paths", () => {
  it("skips when sender address is missing", async () => {
    const res = await processIncomingMessage(
      { subject: "x", text: "body" },
      makeDeps()
    );
    expect(res.type).toBe("skip");
  });

  it("skips when body is empty", async () => {
    const res = await processIncomingMessage(
      { from: { address: "a@b.com" }, subject: "hi", text: "" },
      makeDeps()
    );
    expect(res.type).toBe("skip");
  });
});

describe("processIncomingMessage — reply to existing ticket", () => {
  it("returns comment action for reply with [TASK-XXXXX]", async () => {
    const deps = makeDeps({
      findTaskByPublicId: vi.fn().mockResolvedValue({ id: "task-db-id" }),
    });
    const res = await processIncomingMessage(
      {
        from: { address: "tenant@x.ru", name: "Tenant" },
        subject: "Re: Протечка [TASK-ABCDE]",
        text: "Спасибо, ожидаем!",
        messageId: "<m1@mail>",
      },
      deps
    );
    expect(res.type).toBe("comment");
    if (res.type === "comment") {
      expect(res.taskId).toBe("task-db-id");
      expect(res.emailMessageId).toBe("<m1@mail>");
      expect(res.author.email).toBe("tenant@x.ru");
      expect(res.body).toBe("Спасибо, ожидаем!");
    }
  });

  it("is idempotent — skip when messageId already stored", async () => {
    const deps = makeDeps({
      findTaskByPublicId: vi.fn().mockResolvedValue({ id: "task-db-id" }),
      findCommentByMessageId: vi.fn().mockResolvedValue(true),
    });
    const res = await processIncomingMessage(
      {
        from: { address: "tenant@x.ru" },
        subject: "[TASK-ABCDE]",
        text: "duplicate",
        messageId: "<seen@mail>",
      },
      deps
    );
    expect(res.type).toBe("skip");
  });

  it("falls back to new_issue when ticket id doesn't resolve", async () => {
    const deps = makeDeps({
      findTaskByPublicId: vi.fn().mockResolvedValue(null),
    });
    const res = await processIncomingMessage(
      {
        from: { address: "tenant@x.ru" },
        subject: "Re: старое [TASK-ZZZZZ]",
        text: "hello",
        messageId: "<m2@mail>",
      },
      deps
    );
    expect(res.type).toBe("new_issue");
  });
});

describe("processIncomingMessage — messageId-level dedup for new_issue", () => {
  it("skips when a Task with the same emailThreadId already exists", async () => {
    const deps = makeDeps({
      findTaskByEmailThreadId: vi.fn().mockResolvedValue({ id: "already-created" }),
    });
    const res = await processIncomingMessage(
      {
        from: { address: "a@b.com" },
        subject: "fresh issue",
        text: "body",
        messageId: "<dup-mid@mail>",
      },
      deps
    );
    expect(res.type).toBe("skip");
  });
});

describe("processIncomingMessage — new issue", () => {
  it("creates new issue with externalContact when sender is unknown", async () => {
    const deps = makeDeps();
    const res = await processIncomingMessage(
      {
        from: { address: "stranger@x.ru", name: "Stranger" },
        subject: "Что-то сломалось",
        text: "Опишу подробнее…",
        messageId: "<m3@mail>",
      },
      deps
    );
    expect(res.type).toBe("new_issue");
    if (res.type === "new_issue") {
      expect(res.reporterUserId).toBeNull();
      expect(res.externalContact.email).toBe("stranger@x.ru");
      expect(res.title).toBe("Что-то сломалось");
    }
  });

  it("links to existing User when email matches", async () => {
    const deps = makeDeps({
      findUserByEmail: vi.fn().mockResolvedValue({ id: "u-known" }),
    });
    const res = await processIncomingMessage(
      {
        from: { address: "known@x.ru" },
        subject: "проблема",
        text: "ой",
        messageId: "<m4@mail>",
      },
      deps
    );
    if (res.type === "new_issue") {
      expect(res.reporterUserId).toBe("u-known");
    }
  });

  it("auto-categorizes via keyword match", async () => {
    const deps = makeDeps({
      categorizeByKeywords: vi.fn().mockResolvedValue("c-plumbing"),
    });
    const res = await processIncomingMessage(
      {
        from: { address: "a@b.com" },
        subject: "Протечка в офисе",
        text: "Течёт кран",
        messageId: "<m5@mail>",
      },
      deps
    );
    if (res.type === "new_issue") {
      expect(res.categoryId).toBe("c-plumbing");
    }
    expect(deps.categorizeByKeywords).toHaveBeenCalled();
  });

  it("sanitizes HTML-only body", async () => {
    const deps = makeDeps();
    const res = await processIncomingMessage(
      {
        from: { address: "a@b.com" },
        subject: "problem",
        html: "<p>Hello <script>alert(1)</script><b>world</b></p>",
        messageId: "<m6@mail>",
      },
      deps
    );
    expect(res.type).toBe("new_issue");
    if (res.type === "new_issue") {
      expect(res.description).not.toContain("<script>");
      expect(res.description).not.toContain("alert");
      expect(res.description).toContain("Hello");
      expect(res.description).toContain("world");
    }
  });

  it("uses body prefix as title when subject is empty", async () => {
    const res = await processIncomingMessage(
      {
        from: { address: "a@b.com" },
        text: "В кабинете нет света уже третий час подряд",
        messageId: "<m7@mail>",
      },
      makeDeps()
    );
    if (res.type === "new_issue") {
      expect(res.title.length).toBeGreaterThan(5);
      expect(res.title).toContain("В кабинете");
    }
  });
});
