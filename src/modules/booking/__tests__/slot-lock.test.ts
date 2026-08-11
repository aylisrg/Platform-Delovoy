import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { lockSlot, slotLockKey } from "../slot-lock";

/** Мок транзакционного клиента: нас интересует только вызов $executeRaw. */
function makeTx() {
  return { $executeRaw: vi.fn().mockResolvedValue(1) } as unknown as Prisma.TransactionClient & {
    $executeRaw: ReturnType<typeof vi.fn>;
  };
}

const DAY = new Date("2026-08-15T00:00:00.000Z");

describe("slotLockKey", () => {
  it("склеивает модуль, ресурс и календарный день", () => {
    expect(slotLockKey("gazebos", "res-1", DAY)).toBe("gazebos:res-1:2026-08-15");
  });

  // Главное свойство: два конкурента за один слот обязаны получить один ключ,
  // иначе блокировка их не встретит и гонка останется.
  it("совпадает для одного слота, даже если время суток в Date разное", () => {
    const a = slotLockKey("gazebos", "res-1", new Date("2026-08-15T00:00:00.000Z"));
    const b = slotLockKey("gazebos", "res-1", new Date("2026-08-15T18:42:13.000Z"));
    expect(a).toBe(b);
  });

  it.each([
    ["другой ресурс", "gazebos", "res-2", DAY],
    ["другой день", "gazebos", "res-1", new Date("2026-08-16T00:00:00.000Z")],
    ["другой модуль — resourceId уникален лишь внутри модуля", "ps-park", "res-1", DAY],
  ])("отличается: %s", (_case, slug, resourceId, date) => {
    expect(slotLockKey(slug, resourceId, date)).not.toBe(slotLockKey("gazebos", "res-1", DAY));
  });
});

describe("lockSlot", () => {
  it("выполняет ровно один запрос advisory-блокировки", async () => {
    const tx = makeTx();
    await lockSlot(tx, "gazebos", "res-1", DAY);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("берёт именно транзакционную блокировку — она снимается сама на commit и rollback", async () => {
    const tx = makeTx();
    await lockSlot(tx, "gazebos", "res-1", DAY);

    const sql = tx.$executeRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.strings.join("?")).toContain("pg_advisory_xact_lock");
    // Не сессионная: pg_advisory_lock без xact пришлось бы освобождать вручную,
    // и любой ранний return оставил бы слот заблокированным до конца коннекта.
    expect(sql.strings.join("?")).not.toContain("pg_advisory_lock(");
  });

  it("передаёт ключ параметром, а не склейкой строк", async () => {
    const tx = makeTx();
    await lockSlot(tx, "gazebos", "res-1", DAY);

    const sql = tx.$executeRaw.mock.calls[0][0] as Prisma.Sql;
    // Ключ приходит из внешних данных (resourceId), поэтому он обязан быть
    // placeholder-параметром — иначе это SQL-инъекция.
    expect(sql.values).toEqual(["gazebos:res-1:2026-08-15"]);
    expect(sql.strings.join("?")).not.toContain("res-1");
  });

  it("одинаковый слот → одинаковый параметр блокировки", async () => {
    const a = makeTx();
    const b = makeTx();
    await lockSlot(a, "gazebos", "res-1", new Date("2026-08-15T09:00:00.000Z"));
    await lockSlot(b, "gazebos", "res-1", new Date("2026-08-15T21:30:00.000Z"));

    const keyA = (a.$executeRaw.mock.calls[0][0] as Prisma.Sql).values[0];
    const keyB = (b.$executeRaw.mock.calls[0][0] as Prisma.Sql).values[0];
    expect(keyA).toBe(keyB);
  });
});
