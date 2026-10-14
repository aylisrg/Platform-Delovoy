import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { classifyNotification, recordNovofonNotification } from "../call-journal";

const NOW = new Date("2026-10-14T09:00:00Z");

function makeDb() {
  const store = new Map<string, Record<string, unknown>>();
  const upsert = vi.fn(async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
    store.set(where.id, store.has(where.id) ? { ...store.get(where.id), ...update } : { ...create });
    return store.get(where.id);
  });
  return { store, db: { novofonCall: { upsert } } as never, upsert };
}

const FINISHED = {
  notification_name: "finished_call",
  call_session_id: 555,
  start_time: "2026-10-14 11:58:00",
  direction: "out",
  contact_phone_number: "70000000077",
  talk_time_duration: 30,
  total_time_duration: 40,
  wait_time_duration: 10,
  finish_reason: "subscriber_disconnects",
  employee_id: 9,
  employee_full_name: "Сотрудник",
};

describe("classifyNotification", () => {
  it("file_link -> recording", () => {
    expect(classifyNotification({ notification_name: "x", file_link: "https://a/b" })).toBe("recording");
  });
  it("finished_call / lost_call / finish_reason -> finished", () => {
    expect(classifyNotification({ notification_name: "finished_call" })).toBe("finished");
    expect(classifyNotification({ notification_name: "lost_call" })).toBe("finished");
    expect(classifyNotification({ notification_name: "Свой шаблон", finish_reason: "x" })).toBe("finished");
  });
  it("incoming_call -> null", () => {
    expect(classifyNotification({ notification_name: "incoming_call" })).toBeNull();
  });
});

describe("recordNovofonNotification", () => {
  it("завершение: все поля и время старта МСК", async () => {
    const { db, store } = makeDb();
    expect(await recordNovofonNotification(FINISHED, db, () => NOW)).toBe("finished");
    expect(store.get("555")).toMatchObject({
      id: "555",
      direction: "OUTBOUND",
      isLost: false,
      contactPhone: "70000000077",
      talkDuration: 30,
      totalDuration: 40,
      waitDuration: 10,
      employeeId: "9",
      startedAt: new Date("2026-10-14T08:58:00Z"),
      finishedAt: NOW,
    });
  });

  it("пропущенный: talk 0 -> isLost", async () => {
    const { db, store } = makeDb();
    await recordNovofonNotification({ ...FINISHED, direction: "in", talk_time_duration: 0 }, db, () => NOW);
    expect(store.get("555")).toMatchObject({ isLost: true, direction: "INBOUND" });
  });

  it("запись до завершения, затем завершение: одна строка, ссылка сохраняется", async () => {
    const { db, store } = makeDb();
    await recordNovofonNotification(
      { notification_name: "call_record", call_session_id: 555, file_link: "https://m.test/r" },
      db,
      () => NOW,
    );
    await recordNovofonNotification(FINISHED, db, () => NOW);
    expect(store.size).toBe(1);
    expect(store.get("555")).toMatchObject({ recordUrl: "https://m.test/r", talkDuration: 30 });
  });

  it("повтор: null-поля не затирают данные", async () => {
    const { db, store } = makeDb();
    await recordNovofonNotification(FINISHED, db, () => NOW);
    await recordNovofonNotification(
      { notification_name: "finished_call", call_session_id: 555, total_time_duration: 40 },
      db,
      () => NOW,
    );
    expect(store.size).toBe(1);
    expect(store.get("555")).toMatchObject({ employeeName: "Сотрудник", contactPhone: "70000000077" });
  });

  it("ссылка не http(s) игнорируется", async () => {
    const { db, upsert } = makeDb();
    expect(
      await recordNovofonNotification(
        { notification_name: "call_record", call_session_id: 1, file_link: "javascript:alert(1)" },
        db,
      ),
    ).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("без call_session_id -> null", async () => {
    const { db, upsert } = makeDb();
    expect(await recordNovofonNotification({ notification_name: "finished_call" }, db)).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });
});
