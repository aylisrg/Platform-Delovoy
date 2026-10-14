import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  BACKFILL_DAYS,
  MAX_RATE_LIMIT_RETRIES,
  NovofonApiError,
  PAGE_LIMIT,
  fetchCallsReportPage,
  formatNovofonDate,
  mapCallRow,
  parseNovofonDate,
  syncNovofonCalls,
  type NovofonCallRow,
} from "../calls-sync";

const NOW = new Date("2026-10-14T09:00:00Z");

function row(id: number, over: Partial<NovofonCallRow> = {}): NovofonCallRow {
  return {
    id,
    communication_id: 5000 + id,
    start_time: "2026-10-14 11:00:00",
    finish_time: "2026-10-14 11:02:30",
    direction: "in",
    is_lost: false,
    finish_reason: "subscriber_disconnects",
    virtual_phone_number: "70000000000",
    contact_phone_number: "79990000000",
    wait_duration: 5,
    talk_duration: 140,
    total_duration: 150,
    last_talked_employee_id: 77,
    last_talked_employee_full_name: "Сотрудник",
    call_records: ["rec-1"],
    ...over,
  };
}

function rpc(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200 });
}

function makeDb(lastStartedAt: Date | null) {
  const store = new Map<string, Record<string, unknown>>();
  return {
    store,
    db: {
      novofonCall: {
        findFirst: vi.fn(async () => (lastStartedAt ? { startedAt: lastStartedAt } : null)),
        upsert: vi.fn(async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          store.set(where.id, store.has(where.id) ? { ...store.get(where.id), ...update } : create);
          return store.get(where.id);
        }),
      },
    },
  };
}

describe("даты Novofon (МСК)", () => {
  it("format и parse взаимно обратны", () => {
    expect(formatNovofonDate(NOW)).toBe("2026-10-14 12:00:00");
    expect(parseNovofonDate("2026-10-14 12:00:00").toISOString()).toBe(NOW.toISOString());
  });
  it("кривая дата -> ошибка", () => {
    expect(() => parseNovofonDate("not a date")).toThrow();
  });
});

describe("mapCallRow", () => {
  it("маппит поля спеки PR1", () => {
    const m = mapCallRow(row(1));
    expect(m).toMatchObject({
      id: "1",
      communicationId: "5001",
      direction: "INBOUND",
      isLost: false,
      finishReason: "subscriber_disconnects",
      virtualPhoneNumber: "70000000000",
      waitDuration: 5,
      talkDuration: 140,
      totalDuration: 150,
      employeeId: "77",
      employeeName: "Сотрудник",
      recordId: "rec-1",
    });
    expect((m.startedAt as Date).toISOString()).toBe("2026-10-14T08:00:00.000Z");
  });
  it("исходящий, пропущенный, без записи и сотрудника", () => {
    const m = mapCallRow(
      row(2, { direction: "out", is_lost: true, call_records: [], last_talked_employee_id: null, finish_time: null }),
    );
    expect(m).toMatchObject({ direction: "OUTBOUND", isLost: true, recordId: null, employeeId: null, finishedAt: null });
  });
});

describe("fetchCallsReportPage", () => {
  const sleep = vi.fn(async () => {});
  beforeEach(() => sleep.mockClear());

  it("шлёт get.calls_report с датами, пагинацией и токеном в params", async () => {
    const fetchImpl = vi.fn(async () => rpc({ result: { data: [row(1)] } }));
    const rows = await fetchCallsReportPage(
      { token: "tkn", from: new Date("2026-10-14T00:00:00Z"), till: NOW, offset: 1000, limit: 1000 },
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep },
    );
    expect(rows).toHaveLength(1);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.method).toBe("get.calls_report");
    expect(body.params).toMatchObject({
      access_token: "tkn",
      date_from: "2026-10-14 03:00:00",
      date_till: "2026-10-14 12:00:00",
      offset: 1000,
      limit: 1000,
    });
  });

  it("-32029: пауза и повтор", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(rpc({ error: { code: -32029, message: "limit" } }))
      .mockResolvedValueOnce(rpc({ result: { data: [] } }));
    await expect(
      fetchCallsReportPage({ token: "t", from: NOW, till: NOW, offset: 0, limit: 10 }, { fetchImpl, sleep }),
    ).resolves.toEqual([]);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("-32029 дольше лимита ретраев -> ошибка", async () => {
    const fetchImpl = vi.fn(async () => rpc({ error: { code: -32029, message: "limit" } }));
    await expect(
      fetchCallsReportPage({ token: "t", from: NOW, till: NOW, offset: 0, limit: 10 }, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep }),
    ).rejects.toBeInstanceOf(NovofonApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_RATE_LIMIT_RETRIES + 1);
  });

  it("другая ошибка: без ретрая, текст Novofon не пробрасывается", async () => {
    const fetchImpl = vi.fn(async () => rpc({ error: { code: -32602, message: "bad 79990000000" } }));
    const err = await fetchCallsReportPage(
      { token: "t", from: NOW, till: NOW, offset: 0, limit: 10 },
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(NovofonApiError);
    expect(String(err.message)).not.toContain("79990000000");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("HTTP-ошибка -> NovofonApiError", async () => {
    const fetchImpl = vi.fn(async () => new Response("x", { status: 502 }));
    await expect(
      fetchCallsReportPage({ token: "t", from: NOW, till: NOW, offset: 0, limit: 10 }, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep }),
    ).rejects.toMatchObject({ code: 502 });
  });
});

describe("syncNovofonCalls", () => {
  const sleep = async () => {};
  const now = () => NOW;

  it("без токена -> skipped, к API не ходит", async () => {
    const fetchImpl = vi.fn();
    const { db } = makeDb(null);
    const r = await syncNovofonCalls({ token: "", fetchImpl, db: db as never, now, sleep });
    expect(r).toEqual({ skipped: true, reason: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("пустая таблица -> бэкфилл за 90 дней", async () => {
    const fetchImpl = vi.fn(async () => rpc({ result: { data: [row(1), row(2)] } }));
    const { db, store } = makeDb(null);
    const r = await syncNovofonCalls({ token: "t", fetchImpl: fetchImpl as unknown as typeof fetch, db: db as never, now, sleep });
    expect(r).toMatchObject({ skipped: false, mode: "backfill", fetched: 2, upserted: 2 });
    const from = new Date(NOW.getTime() - BACKFILL_DAYS * 86_400_000);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.params.date_from).toBe(formatNovofonDate(from));
    expect(store.size).toBe(2);
  });

  it("инкремент: окно от последнего звонка минус час", async () => {
    const fetchImpl = vi.fn(async () => rpc({ result: { data: [] } }));
    const { db } = makeDb(new Date("2026-10-14T08:30:00Z"));
    const r = await syncNovofonCalls({ token: "t", fetchImpl: fetchImpl as unknown as typeof fetch, db: db as never, now, sleep });
    expect(r).toMatchObject({ mode: "incremental", from: "2026-10-14T07:30:00.000Z" });
  });

  it("идемпотентно: повтор того же отчёта не создаёт дублей", async () => {
    const fetchImpl = vi.fn(async () => rpc({ result: { data: [row(1), row(2)] } }));
    const { db, store } = makeDb(null);
    const deps = { token: "t", fetchImpl: fetchImpl as unknown as typeof fetch, db: db as never, now, sleep };
    await syncNovofonCalls(deps);
    await syncNovofonCalls(deps);
    expect(store.size).toBe(2);
    expect(db.novofonCall.upsert.mock.calls[0][0].where).toEqual({ id: "1" });
  });

  it("пагинация: полная страница -> следующий offset", async () => {
    const full = Array.from({ length: PAGE_LIMIT }, (_, i) => row(i + 1));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(rpc({ result: { data: full } }))
      .mockResolvedValueOnce(rpc({ result: { data: [row(PAGE_LIMIT + 1)] } }));
    const { db } = makeDb(null);
    const r = await syncNovofonCalls({ token: "t", fetchImpl, db: db as never, now, sleep });
    expect(r).toMatchObject({ fetched: PAGE_LIMIT + 1, truncated: false });
    const second = JSON.parse((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(second.params.offset).toBe(PAGE_LIMIT);
  });

  it("результат не содержит номеров телефонов", async () => {
    const fetchImpl = vi.fn(async () => rpc({ result: { data: [row(1)] } }));
    const { db } = makeDb(null);
    const r = await syncNovofonCalls({ token: "t", fetchImpl: fetchImpl as unknown as typeof fetch, db: db as never, now, sleep });
    expect(JSON.stringify(r)).not.toContain("79990000000");
  });
});
