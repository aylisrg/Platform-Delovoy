import { z } from "zod";

export const initiateCallSchema = z.object({
  bookingId: z.string().min(1),
  moduleSlug: z.enum(["gazebos", "ps-park"]),
});

/** Direct call by phone number (no bookingId required — for tenant contacts etc.) */
export const initiateDirectCallSchema = z.object({
  phone: z
    .string()
    .regex(/^\d{10,15}$/, "Телефон должен содержать 10–15 цифр без +"),
  tenantId: z.string().optional(),
  context: z.string().max(100).optional(),
});

export const callFilterSchema = z.object({
  bookingId: z.string().optional(),
  moduleSlug: z.string().optional(),
  status: z
    .enum(["INITIATED", "RINGING", "ANSWERED", "NO_ANSWER", "BUSY", "FAILED", "COMPLETED"])
    .optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
});

export const novofonWebhookSchema = z
  .object({
    event: z.string(),
    call_id: z.string(),
    direction: z.enum(["inbound", "outbound"]).optional(),
    duration: z.number().int().nonnegative().optional(),
    recording_url: z.string().url().optional(),
    caller: z.string().optional(),
    callee: z.string().optional(),
  })
  .passthrough();

/**
 * Novofon 2.0 HTTP notification ("Интеграции → HTTP-уведомления").
 * The body is a user-editable template; Novofon fills {{...}} placeholders.
 * call_session_id arrives as a number, direction as "in"/"out".
 * Docs: https://novofon.github.io/data_api , https://novofon.github.io/call_api
 */
const numOrStr = z.union([z.string(), z.number()]);
export const novofonV2NotificationSchema = z
  .object({
    notification_name: z.string().min(1),
    call_session_id: numOrStr,
    direction: z.string().nullish(),
    calling_phone_number: numOrStr.nullish(),
    called_phone_number: numOrStr.nullish(),
    contact_phone_number: numOrStr.nullish(),
    virtual_phone_number: numOrStr.nullish(),
    talk_time_duration: z.coerce.number().nullish(),
    total_time_duration: z.coerce.number().nullish(),
    record_file_links: z.union([z.array(z.string()), z.string()]).nullish(),
  })
  .passthrough();

function v2EventName(name: string, talk: number | null | undefined): string {
  switch (name) {
    case "incoming_call":
    case "outgoing_call":
    case "outbound_call":
      return "call.ringing";
    case "answered_call":
    case "call_answered":
      return "call.answered";
    case "finished_call":
    case "lost_call":
      return talk && talk > 0 ? "call.completed" : "call.no_answer";
    default:
      return name;
  }
}

function v2Direction(d: string | null | undefined): "inbound" | "outbound" | undefined {
  if (!d) return undefined;
  const v = d.toLowerCase();
  if (v === "in" || v === "inbound" || v === "incoming") return "inbound";
  if (v === "out" || v === "outbound" || v === "outgoing") return "outbound";
  return undefined;
}

/**
 * Accepts both the legacy payload ({event, call_id, ...}) and the current
 * Novofon 2.0 notification ({notification_name, call_session_id, ...})
 * and returns the internal legacy shape. Returns null if neither matches.
 */
export function normalizeNovofonWebhook(body: unknown): NovofonWebhookInput | null {
  const legacy = novofonWebhookSchema.safeParse(body);
  if (legacy.success) return legacy.data;

  const v2 = novofonV2NotificationSchema.safeParse(body);
  if (!v2.success) return null;
  const n = v2.data;
  const direction =
    v2Direction(n.direction) ??
    (n.notification_name === "incoming_call" ? "inbound" : undefined);
  const contact = n.contact_phone_number ?? (direction === "outbound" ? n.called_phone_number : n.calling_phone_number);
  const links = n.record_file_links;
  const recording = Array.isArray(links) ? links[0] : links || undefined;
  const talk = n.talk_time_duration ?? undefined;

  return {
    ...n,
    event: v2EventName(n.notification_name, talk),
    call_id: String(n.call_session_id),
    ...(direction && { direction }),
    ...(talk !== undefined && { duration: Math.max(0, Math.round(talk)) }),
    ...(recording && /^https?:\/\//.test(recording) && { recording_url: recording }),
    ...(contact != null && contact !== "" && { caller: String(contact) }),
  } as NovofonWebhookInput;
}

export type InitiateCallInput = z.infer<typeof initiateCallSchema>;
export type InitiateDirectCallInput = z.infer<typeof initiateDirectCallSchema>;
export type CallFilter = z.infer<typeof callFilterSchema>;
export type NovofonWebhookInput = z.infer<typeof novofonWebhookSchema>;
