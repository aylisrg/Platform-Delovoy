import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseNovofonDate } from "./calls-sync";

/**
 * Журнал звонков из вебхуков Novofon 2.0 (#1066 PR2):
 * «Завершение звонка» и «Записанный разговор» пишутся в NovofonCall.
 * id строки = call_session_id (тот же id, что в get.calls_report),
 * поэтому повторное уведомление и последующий синк обновляют ту же строку.
 * Номера телефонов не логируются.
 */

export type JournalEventKind = "finished" | "recording";

type Body = Record<string, unknown>;

const FINISHED_NAMES = new Set(["finished_call", "lost_call", "call_finished", "end_call"]);
const RECORDING_NAMES = new Set(["call_record", "record_call", "recorded_call", "call_recording"]);

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);
const int = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
};

function firstLink(v: unknown): string | null {
  const raw = Array.isArray(v) ? v[0] : v;
  const s = str(raw);
  return s && /^https?:\/\//.test(s) ? s : null;
}

function safeDate(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  try {
    return parseNovofonDate(s);
  } catch {
    return null;
  }
}

export function classifyNotification(body: Body): JournalEventKind | null {
  const name = String(body.notification_name ?? "").toLowerCase();
  if (firstLink(body.file_link) || RECORDING_NAMES.has(name)) return "recording";
  if (
    FINISHED_NAMES.has(name) ||
    body.finish_reason !== undefined ||
    body.total_time_duration !== undefined
  ) {
    return "finished";
  }
  return null;
}

function direction(body: Body): "INBOUND" | "OUTBOUND" | null {
  const d = String(body.direction ?? "").toLowerCase();
  if (d === "out" || d === "outbound" || d === "outgoing") return "OUTBOUND";
  if (d === "in" || d === "inbound" || d === "incoming") return "INBOUND";
  return null;
}

/**
 * Обрабатывает уже аутентифицированное уведомление. Возвращает тип события
 * или null, если уведомление к журналу не относится (входящий, ответ и т.п.).
 */
export async function recordNovofonNotification(
  body: Body,
  db: Pick<typeof prisma, "novofonCall"> = prisma,
  now: () => Date = () => new Date(),
): Promise<JournalEventKind | null> {
  const id = str(body.call_session_id);
  if (!id) return null;
  const kind = classifyNotification(body);
  if (!kind) return null;

  const startedAt = safeDate(body.start_time) ?? safeDate(body.notification_time) ?? now();
  const dir = direction(body);

  if (kind === "recording") {
    const recordUrl = firstLink(body.file_link) ?? firstLink(body.record_file_links);
    if (!recordUrl) return null;
    await db.novofonCall.upsert({
      where: { id },
      create: { id, startedAt, direction: dir ?? "INBOUND", recordUrl },
      update: { recordUrl },
    });
    return kind;
  }

  const name = String(body.notification_name ?? "").toLowerCase();
  const talk = int(body.talk_time_duration);
  const contact =
    str(body.contact_phone_number) ??
    str(dir === "OUTBOUND" ? body.called_phone_number : body.calling_phone_number);
  const fields: Prisma.NovofonCallUpdateInput = {
    // A partial retry must not erase a confirmed missed call. Missing talk time
    // carries no new outcome; explicit lost_call remains authoritative.
    isLost: name === "lost_call" ? true : talk === null ? undefined : talk === 0,
    finishReason: str(body.finish_reason),
    virtualPhoneNumber: str(body.virtual_phone_number),
    contactPhone: contact,
    waitDuration: int(body.wait_time_duration),
    talkDuration: talk,
    totalDuration: int(body.total_time_duration),
    employeeId: str(body.employee_id),
    employeeName: str(body.employee_full_name),
    communicationId: str(body.communication_id),
    ...(dir && { direction: dir }),
  };
  const recordUrl = firstLink(body.record_file_links);
  if (recordUrl) fields.recordUrl = recordUrl;
  // null не затирает данные, уже пришедшие из синка или прошлого уведомления
  const update = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== null && v !== undefined),
  ) as Prisma.NovofonCallUpdateInput;

  await db.novofonCall.upsert({
    where: { id },
    create: {
      ...(fields as Prisma.NovofonCallCreateInput),
      id,
      startedAt,
      direction: dir ?? "INBOUND",
      finishedAt: now(),
    },
    update: { ...update, ...(body.start_time ? { startedAt } : {}) },
  });
  return kind;
}
