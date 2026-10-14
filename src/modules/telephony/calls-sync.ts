import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getNovofonDataApiToken } from "./novofon-client";

/**
 * Синк журнала звонков из Novofon Data API (`get.calls_report`), #1066 PR1.
 *
 * - Первый запуск (таблица пуста): бэкфилл за BACKFILL_DAYS дней.
 * - Дальше инкремент: окно от последнего звонка минус OVERLAP_MINUTES
 *   (звонки, шедшие во время прошлого синка, доезжают с финальными полями).
 * - Идемпотентно: upsert по `id` сессии Novofon.
 * - Лимиты: ошибка -32029 -> пауза и повтор (до MAX_RATE_LIMIT_RETRIES).
 * - PII: номера телефонов не попадают в логи и в результат синка.
 *
 * Документация: https://novofon.github.io/data_api/report/get_calls_report/
 */

export const NOVOFON_DATA_API_URL = "https://dataapi-jsonrpc.novofon.ru/2.0";
export const BACKFILL_DAYS = 90;
export const OVERLAP_MINUTES = 60;
export const PAGE_LIMIT = 1000;
/** Novofon ограничивает offset значением 100 000. */
export const MAX_OFFSET = 100_000;
export const RATE_LIMIT_ERROR_CODE = -32029;
export const MAX_RATE_LIMIT_RETRIES = 3;
export const RATE_LIMIT_PAUSE_MS = 2_000;
/** Время в отчёте Novofon — время кабинета (МСК). */
export const NOVOFON_TZ_OFFSET = "+03:00";

const FIELDS = [
  "id",
  "communication_id",
  "start_time",
  "finish_time",
  "direction",
  "is_lost",
  "finish_reason",
  "virtual_phone_number",
  "contact_phone_number",
  "wait_duration",
  "talk_duration",
  "total_duration",
  "last_talked_employee_id",
  "last_talked_employee_full_name",
  "call_records",
] as const;

export type NovofonCallRow = {
  id: number | string;
  communication_id?: number | string | null;
  start_time: string;
  finish_time?: string | null;
  direction: "in" | "out";
  is_lost?: boolean | null;
  finish_reason?: string | null;
  virtual_phone_number?: string | null;
  contact_phone_number?: string | null;
  wait_duration?: number | null;
  talk_duration?: number | null;
  total_duration?: number | null;
  last_talked_employee_id?: number | string | null;
  last_talked_employee_full_name?: string | null;
  call_records?: string[] | null;
};

export class NovofonApiError extends Error {
  constructor(public code: number | string, message: string) {
    super(message);
    this.name = "NovofonApiError";
  }
}

type Deps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  db?: Pick<typeof prisma, "novofonCall">;
  token?: string;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Date -> "YYYY-MM-DD hh:mm:ss" во времени кабинета Novofon (МСК). */
export function formatNovofonDate(date: Date): string {
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return msk.toISOString().slice(0, 19).replace("T", " ");
}

/** "YYYY-MM-DD hh:mm:ss" (МСК) -> Date. */
export function parseNovofonDate(value: string): Date {
  const d = new Date(`${value.trim().replace(" ", "T")}${NOVOFON_TZ_OFFSET}`);
  if (Number.isNaN(d.getTime())) throw new Error("invalid Novofon date");
  return d;
}

const intOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
const strOrNull = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

export function mapCallRow(row: NovofonCallRow): Prisma.NovofonCallCreateInput {
  return {
    id: String(row.id),
    communicationId: strOrNull(row.communication_id),
    startedAt: parseNovofonDate(row.start_time),
    finishedAt: row.finish_time ? parseNovofonDate(row.finish_time) : null,
    direction: row.direction === "out" ? "OUTBOUND" : "INBOUND",
    isLost: row.is_lost === true,
    finishReason: strOrNull(row.finish_reason),
    virtualPhoneNumber: strOrNull(row.virtual_phone_number),
    contactPhone: strOrNull(row.contact_phone_number),
    waitDuration: intOrNull(row.wait_duration),
    talkDuration: intOrNull(row.talk_duration),
    totalDuration: intOrNull(row.total_duration),
    employeeId: strOrNull(row.last_talked_employee_id),
    employeeName: strOrNull(row.last_talked_employee_full_name),
    recordId: strOrNull(row.call_records?.[0]),
  };
}

export async function fetchCallsReportPage(
  params: { token: string; from: Date; till: Date; offset: number; limit: number },
  deps: Pick<Deps, "fetchImpl" | "sleep"> = {},
): Promise<NovofonCallRow[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(NOVOFON_DATA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "get.calls_report",
        params: {
          access_token: params.token,
          date_from: formatNovofonDate(params.from),
          date_till: formatNovofonDate(params.till),
          offset: params.offset,
          limit: params.limit,
          fields: FIELDS,
          sort: [{ field: "start_time", order: "asc" }],
        },
      }),
    });
    if (!res.ok) throw new NovofonApiError(res.status, `HTTP ${res.status}`);
    const body = (await res.json()) as {
      result?: { data?: NovofonCallRow[] };
      error?: { code?: number; message?: string };
    };
    if (body.error) {
      const code = body.error.code ?? "unknown";
      if (code === RATE_LIMIT_ERROR_CODE && attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep(RATE_LIMIT_PAUSE_MS * (attempt + 1));
        continue;
      }
      // message от Novofon не пробрасываем: в нём может оказаться ввод запроса.
      throw new NovofonApiError(code, `Novofon Data API error ${code}`);
    }
    return body.result?.data ?? [];
  }
}

export type SyncResult =
  | { skipped: true; reason: "not_configured" }
  | {
      skipped: false;
      mode: "backfill" | "incremental";
      from: string;
      till: string;
      fetched: number;
      upserted: number;
      truncated: boolean;
    };

export async function syncNovofonCalls(deps: Deps = {}): Promise<SyncResult> {
  const token = deps.token ?? getNovofonDataApiToken();
  if (!token) return { skipped: true, reason: "not_configured" };
  const db = deps.db ?? prisma;
  const now = (deps.now ?? (() => new Date()))();

  const last = await db.novofonCall.findFirst({
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  const backfillFrom = new Date(now.getTime() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  const from = last
    ? new Date(Math.max(last.startedAt.getTime() - OVERLAP_MINUTES * 60 * 1000, backfillFrom.getTime()))
    : backfillFrom;

  let offset = 0;
  let fetched = 0;
  let upserted = 0;
  let truncated = false;
  for (;;) {
    const rows = await fetchCallsReportPage(
      { token, from, till: now, offset, limit: PAGE_LIMIT },
      deps,
    );
    fetched += rows.length;
    for (const row of rows) {
      const data = mapCallRow(row);
      const { id, ...update } = data;
      await db.novofonCall.upsert({ where: { id }, create: data, update });
      upserted++;
    }
    if (rows.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
    if (offset > MAX_OFFSET) {
      truncated = true;
      break;
    }
  }

  return {
    skipped: false,
    mode: last ? "incremental" : "backfill",
    from: from.toISOString(),
    till: now.toISOString(),
    fetched,
    upserted,
    truncated,
  };
}
