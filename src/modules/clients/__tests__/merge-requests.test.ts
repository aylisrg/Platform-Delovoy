import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDb, makeUser, type MemoryDb, type Tables } from "./helpers/memory-db";

/**
 * «Запросы на объединение» — ADR 2026-10-25 §5.4, PRD US-E4 (AC-E4.2–E4.4).
 */

const h = vi.hoisted(() => ({
  db: null as null | { client: Record<string, unknown> },
  counters: new Map<string, number>(),
  incr: vi.fn(),
  expire: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: new Proxy({}, { get: (_t, prop: string) => h.db!.client[prop] }),
}));
vi.mock("@/lib/redis", () => ({
  redis: { incr: h.incr, expire: h.expire },
  redisAvailable: true,
}));

import {
  createMergeRequest,
  listMergeRequests,
  dismissMergeRequest,
  countPendingMergeRequests,
  sortPair,
  MERGE_REQUEST_LIMIT_PER_DAY,
} from "../merge-requests";

let db: MemoryDb;
function install(tables: Tables): Tables {
  db = createMemoryDb(tables);
  h.db = db;
  return tables;
}

const people = () => [
  makeUser({ id: "web", role: "MANAGER", name: "Пётр", email: "p@x.ru", createdAt: new Date("2026-01-02") }),
  makeUser({ id: "tg", name: "Петя", telegramId: "123456789", createdAt: new Date("2026-03-03") }),
  makeUser({ id: "other", name: "Другой" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  h.counters.clear();
  h.incr.mockImplementation(async (key: string) => {
    const next = (h.counters.get(key) ?? 0) + 1;
    h.counters.set(key, next);
    return next;
  });
  h.expire.mockResolvedValue(1);
});

const request = (a = "web", b = "tg", telegramId = "123456789") =>
  createMergeRequest({ userAId: a, userBId: b, reason: "telegram_conflict", telegramId });

describe("createMergeRequest (AC-E4.2 / AC-E4.4)", () => {
  it("AC-E4.2: creates one PENDING row for the sorted pair + audit by userA", async () => {
    const tables = install({ user: people() });

    expect(await request()).toBe("created");

    expect(tables.mergeCandidate).toHaveLength(1);
    expect(tables.mergeCandidate[0]).toMatchObject({
      primaryUserId: "tg",
      candidateUserId: "web",
      matchedFields: ["telegramId"],
      matchScore: 1,
      status: "PENDING",
    });
    expect(sortPair("web", "tg")).toEqual(["tg", "web"]);
    const audit = tables.auditLog.find((a) => a.action === "user.merge_request.created");
    expect(audit).toMatchObject({ userId: "web", entity: "MergeCandidate", entityId: tables.mergeCandidate[0].id });
    expect(JSON.stringify(audit!.metadata)).not.toContain("123456789");
    expect(h.expire).toHaveBeenCalledWith("merge-req:tg:123456789", 24 * 3600);
  });

  it("AC-E4.2: one open request per pair — a repeat (either order) returns exists and creates nothing", async () => {
    const tables = install({ user: people() });
    await request();
    expect(await request("tg", "web")).toBe("exists");
    expect(await request()).toBe("exists");
    expect(tables.mergeCandidate).toHaveLength(1);
    expect(tables.auditLog.filter((a) => a.action === "user.merge_request.created")).toHaveLength(1);
  });

  it("AC-E4.2: also «exists» for an unsorted legacy PENDING row of the same pair", async () => {
    install({
      user: people(),
      mergeCandidate: [{ id: "legacy", primaryUserId: "web", candidateUserId: "tg", status: "PENDING", matchedFields: ["phoneNormalized"] }],
    });
    expect(await request()).toBe("exists");
  });

  it("AC-E4.4: suppressed after «Это разные люди» or after a merge of the pair", async () => {
    install({
      user: people(),
      mergeCandidate: [{ id: "x", primaryUserId: "tg", candidateUserId: "web", status: "RESOLVED_KEPT_SEPARATE", matchedFields: ["telegramId"] }],
    });
    expect(await request()).toBe("suppressed");

    install({
      user: people(),
      mergeCandidate: [{ id: "x", primaryUserId: "web", candidateUserId: "tg", status: "RESOLVED_MERGED", matchedFields: [] }],
    });
    expect(await request()).toBe("suppressed");
  });

  it("AC-E4.4: suppressed when one side is merged or missing, or both ids are the same", async () => {
    install({ user: [...people(), makeUser({ id: "gone", mergedIntoUserId: "web" })] });
    expect(await request("web", "gone")).toBe("suppressed");
    expect(await request("web", "missing")).toBe("suppressed");
    expect(await request("web", "web")).toBe("suppressed");
    expect(h.incr).not.toHaveBeenCalled();
  });

  it("AC-E4.2: at most 3 new requests per Telegram per 24 h", async () => {
    install({
      user: [
        makeUser({ id: "tg" }),
        ...["a", "b", "c", "d"].map((id) => makeUser({ id })),
      ],
    });
    const results = [];
    for (const id of ["a", "b", "c", "d"]) results.push(await request(id, "tg"));
    expect(MERGE_REQUEST_LIMIT_PER_DAY).toBe(3);
    expect(results).toEqual(["created", "created", "created", "suppressed"]);
  });

  it("fails open when Redis is down (requests only come after a verified ownership proof)", async () => {
    install({ user: people() });
    h.incr.mockRejectedValue(new Error("redis down"));
    expect(await request()).toBe("created");
  });

  it("reopens a DISMISSED row of the pair (closed by an unrelated merge)", async () => {
    const tables = install({
      user: people(),
      mergeCandidate: [{ id: "old", primaryUserId: "tg", candidateUserId: "web", status: "DISMISSED", matchedFields: ["phoneNormalized"], resolvedByUserId: "sa" }],
    });
    expect(await request()).toBe("created");
    expect(tables.mergeCandidate).toHaveLength(1);
    expect(tables.mergeCandidate[0]).toMatchObject({ id: "old", status: "PENDING", matchedFields: ["telegramId"], resolvedByUserId: null });
  });

  it("a parallel duplicate insert (P2002) resolves to «exists»", async () => {
    install({ user: people() });
    (db.client.mergeCandidate as { create: () => Promise<never> }).create = async () => {
      throw Object.assign(new Error("dup"), { code: "P2002" });
    };
    expect(await request()).toBe("exists");
  });
});

describe("listMergeRequests / countPendingMergeRequests (AC-E4.3)", () => {
  function queue(): Tables {
    return install({
      user: [...people(), makeUser({ id: "gone", mergedIntoUserId: "web" })],
      mergeCandidate: [
        { id: "r1", primaryUserId: "tg", candidateUserId: "web", status: "PENDING", matchedFields: ["telegramId"], detectedAt: new Date("2026-10-01") },
        { id: "r2", primaryUserId: "other", candidateUserId: "web", status: "PENDING", matchedFields: ["phoneNormalized"], detectedAt: new Date("2026-10-02") },
        { id: "r3", primaryUserId: "gone", candidateUserId: "other", status: "PENDING", matchedFields: ["telegramId"], detectedAt: new Date("2026-10-03") },
        { id: "r4", primaryUserId: "other", candidateUserId: "tg", status: "RESOLVED_KEPT_SEPARATE", matchedFields: ["telegramId"], detectedAt: new Date("2026-10-04") },
      ],
    });
  }

  it("AC-E4.3: open Telegram requests between non-merged accounts; account briefs without telegramId", async () => {
    queue();
    const items = await listMergeRequests({ status: "PENDING" });
    expect(items.map((i) => i.id)).toEqual(["r1"]);
    expect(items[0]).toMatchObject({
      detectedAt: "2026-10-01T00:00:00.000Z",
      matchedFields: ["telegramId"],
      reasonLabel: "Telegram уже привязан к другому аккаунту",
    });
    expect(items[0].users).toEqual([
      { id: "tg", name: "Петя", role: "USER", email: null, phone: null, hasTelegram: true, createdAt: "2026-03-03T00:00:00.000Z" },
      { id: "web", name: "Пётр", role: "MANAGER", email: "p@x.ru", phone: null, hasTelegram: false, createdAt: "2026-01-02T00:00:00.000Z" },
    ]);
    expect(JSON.stringify(items)).not.toContain("123456789");
    expect(await countPendingMergeRequests()).toBe(1);
  });

  it("oldest first; filter by account", async () => {
    queue();
    const spy = vi.spyOn(db.client.mergeCandidate as { findMany: (a: unknown) => Promise<unknown> }, "findMany");
    expect((await listMergeRequests({ userId: "other" })).map((i) => i.id)).toEqual([]);
    expect((await listMergeRequests({ userId: "web" })).map((i) => i.id)).toEqual(["r1"]);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { detectedAt: "asc" } }));
  });
});

describe("dismissMergeRequest («Это разные люди», AC-E4.3)", () => {
  it("closes the request as RESOLVED_KEPT_SEPARATE with the actor and an audit row", async () => {
    const tables = install({
      user: people(),
      mergeCandidate: [{ id: "r1", primaryUserId: "tg", candidateUserId: "web", status: "PENDING", matchedFields: ["telegramId"] }],
    });
    expect(await dismissMergeRequest("r1", "sa")).toEqual({ id: "r1", status: "RESOLVED_KEPT_SEPARATE" });
    expect(tables.mergeCandidate[0]).toMatchObject({ status: "RESOLVED_KEPT_SEPARATE", resolvedByUserId: "sa" });
    expect(tables.mergeCandidate[0].resolvedAt).toBeInstanceOf(Date);
    expect(tables.auditLog).toEqual([
      expect.objectContaining({
        userId: "sa",
        action: "user.merge_request.dismissed",
        entity: "MergeCandidate",
        entityId: "r1",
        metadata: { userAId: "tg", userBId: "web" },
      }),
    ]);
    // AC-E4.4: never offered again
    expect(await request()).toBe("suppressed");
  });

  it("404 unknown, 409 already closed", async () => {
    install({
      user: people(),
      mergeCandidate: [{ id: "done", primaryUserId: "tg", candidateUserId: "web", status: "RESOLVED_MERGED", matchedFields: [] }],
    });
    await expect(dismissMergeRequest("nope", "sa")).rejects.toMatchObject({ code: "MERGE_REQUEST_NOT_FOUND", status: 404 });
    await expect(dismissMergeRequest("done", "sa")).rejects.toMatchObject({ code: "MERGE_REQUEST_CLOSED", status: 409 });
  });
});
