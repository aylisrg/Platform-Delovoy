/**
 * Avito Call Tracking — webhook payload parsing, idempotent persistence
 * and missed-call → Task creation.
 *
 * Architecture: docs/architecture/2026-04-28-delovoy-avito-adr.md (sections 2.7 & 7).
 * PRD: docs/product/2026-04-28-delovoy-avito-prd.md (US-4.1).
 */

import { z } from "zod";
import type { AvitoCallStatus, Prisma, TaskPriority } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";

// === Public types =================================================

/**
 * Whitelist of supported Avito call event types.
 * `call.missed` is the only one that creates a Task in MVP (US-4.1).
 * `call.answered` and `call.failed` are persisted for audit/stats but
 * do not produce a Task.
 */
export const AVITO_CALL_TYPES = [
  "call.missed",
  "call.answered",
  "call.failed",
] as const;
export type AvitoCallType = (typeof AVITO_CALL_TYPES)[number];

/** Map Avito payload type → AvitoCallStatus enum value. */
const TYPE_TO_STATUS: Record<AvitoCallType, "MISSED" | "ANSWERED" | "FAILED"> = {
  "call.missed": "MISSED",
  "call.answered": "ANSWERED",
  "call.failed": "FAILED",
};

// === Zod schemas ===================================================

/**
 * Webhook payload from Avito Call Tracking API.
 * Mirrors ADR section 3 (`AvitoCallWebhookSchema`).
 *
 * Note on `item_id`/`call_id`: Avito ships these as numbers; we coerce
 * to string at the schema boundary so downstream code never deals
 * with two different shapes.
 */
export const AvitoCallWebhookSchema = z.object({
  id: z.string().min(1),
  payload: z.object({
    type: z.enum(AVITO_CALL_TYPES),
    value: z.object({
      call_id: z.union([z.string().min(1), z.number()]).transform(String),
      item_id: z
        .union([z.string(), z.number()])
        .optional()
        .transform((v) => (v === undefined || v === null ? undefined : String(v))),
      caller_phone: z.string().optional(),
      duration: z.number().int().nonnegative().optional(),
      started_at: z.number().int(),
    }),
  }),
});

export type AvitoCallWebhookPayload = z.infer<typeof AvitoCallWebhookSchema>;

// === Persistence ===================================================

/** Result of `processCallWebhook`. */
export type ProcessCallResult = {
  /** True if a fresh AvitoCallEvent row was inserted. */
  created: boolean;
  /** Internal id of the AvitoCallEvent (existing or freshly created). */
  callEventId: string | null;
  /** True if a Task was created off this call (only for missed calls). */
  taskCreated: boolean;
  /** Internal id of the created Task, if any. */
  taskId: string | null;
};

/**
 * Idempotently persist an AvitoCallEvent and, for missed calls, create a Task.
 *
 * Idempotency contract — UNIQUE constraint on `AvitoCallEvent.avitoCallId`:
 *   - If a row already exists for `payload.value.call_id`, no new row is
 *     inserted, no Task is created and the existing row id is returned.
 *   - If insert succeeds and the call is `MISSED`, we route a Task using
 *     the avito item's `moduleSlug`.
 *
 * Errors during Task creation are not propagated — they are logged in
 * SystemEvent so the webhook itself can still respond 200 OK.
 */
export async function processCallWebhook(
  parsed: AvitoCallWebhookPayload
): Promise<ProcessCallResult> {
  const { value, type } = parsed.payload;
  const status = TYPE_TO_STATUS[type];

  // Resolve avitoItem (FK on AvitoCallEvent.avitoItemId — internal cuid).
  let avitoItemDbId: string | null = null;
  if (value.item_id) {
    const item = await prisma.avitoItem.findUnique({
      where: { avitoItemId: value.item_id },
      select: { id: true },
    });
    avitoItemDbId = item?.id ?? null;
  }

  const startedAt = new Date(value.started_at * 1000);
  // If Avito sent a non-finite timestamp, fall back to now() rather than NaN.
  const safeStartedAt = Number.isFinite(startedAt.getTime()) ? startedAt : new Date();

  // Idempotent insert — UNIQUE on avitoCallId. On P2002 we fetch existing.
  let callEvent: {
    id: string;
    status: AvitoCallStatus;
    avitoItemId: string | null;
    callerPhone: string | null;
    startedAt: Date;
  } | null = null;
  let created = false;
  try {
    callEvent = await prisma.avitoCallEvent.create({
      data: {
        avitoCallId: value.call_id,
        avitoItemId: avitoItemDbId,
        callerPhone: value.caller_phone ?? null,
        status,
        durationSec: value.duration ?? null,
        startedAt: safeStartedAt,
        rawPayload: parsed as unknown as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        status: true,
        avitoItemId: true,
        callerPhone: true,
        startedAt: true,
      },
    });
    created = true;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const existing = await prisma.avitoCallEvent.findUnique({
        where: { avitoCallId: value.call_id },
        select: {
          id: true,
          status: true,
          avitoItemId: true,
          callerPhone: true,
          startedAt: true,
        },
      });
      callEvent = existing;
      created = false;
    } else {
      throw err;
    }
  }

  if (!callEvent) {
    return { created: false, callEventId: null, taskCreated: false, taskId: null };
  }

  // Only create a Task for genuinely fresh missed calls.
  if (!created || callEvent.status !== "MISSED") {
    return { created, callEventId: callEvent.id, taskCreated: false, taskId: null };
  }

  let taskId: string | null = null;
  let taskCreated = false;
  try {
    const taskResult = await createTaskFromMissedCall({
      callEventId: callEvent.id,
      avitoItemDbId: callEvent.avitoItemId,
      callerPhone: callEvent.callerPhone,
      startedAt: callEvent.startedAt,
    });
    taskId = taskResult.taskId;
    taskCreated = taskResult.taskCreated;

    if (taskId) {
      await prisma.avitoCallEvent.update({
        where: { id: callEvent.id },
        data: { taskId },
      });
    }
  } catch (err) {
    await prisma.systemEvent
      .create({
        data: {
          level: "ERROR",
          source: "avito.calls",
          message: "Failed to create Task from missed call",
          metadata: {
            callEventId: callEvent.id,
            error: err instanceof Error ? err.message : String(err),
          },
        },
      })
      .catch(() => {
        /* swallow logging failure */
      });
  }

  return {
    created,
    callEventId: callEvent.id,
    taskCreated,
    taskId,
  };
}

// === Task creation =================================================

/** Slug of the TaskCategory that should hold the new missed-call task. */
type MissedCallCategorySlug =
  | "avito-missed-call-gazebos"
  | "avito-missed-call-ps-park"
  | "avito-missed-call-unassigned";

const MODULE_TO_CATEGORY: Record<string, MissedCallCategorySlug> = {
  gazebos: "avito-missed-call-gazebos",
  "ps-park": "avito-missed-call-ps-park",
};

const CATEGORY_NAMES: Record<MissedCallCategorySlug, string> = {
  "avito-missed-call-gazebos": "Пропущенный звонок: Барбекю",
  "avito-missed-call-ps-park": "Пропущенный звонок: PS Park",
  "avito-missed-call-unassigned": "Пропущенный звонок: без модуля",
};

type CreateTaskInput = {
  callEventId: string;
  avitoItemDbId: string | null;
  callerPhone: string | null;
  startedAt: Date;
};

type CreateTaskResult = {
  taskCreated: boolean;
  taskId: string | null;
};

/**
 * Create a Task in the proper TaskCategory for a missed Avito call.
 *
 * Routing (per ADR section 1.3):
 *   - If the AvitoItem is bound to `moduleSlug` "gazebos" or "ps-park" →
 *     `avito-missed-call-{slug}`.
 *   - Otherwise (no item OR item without moduleSlug) →
 *     `avito-missed-call-unassigned`.
 *
 * Phone matching:
 *   - Caller phone is normalized via @/lib/phone.normalizePhone.
 *   - Looked up against User.phone, User.phoneNormalized and Tenant.phone.
 *   - If matched, the user/tenant id is recorded in `Task.metadata.linkedUserId`
 *     or `Task.metadata.linkedTenantId`. This is **enrichment** — it never
 *     blocks Task creation.
 *
 * Categories are created lazily (idempotent upsert by slug).
 */
export async function createTaskFromMissedCall(
  input: CreateTaskInput
): Promise<CreateTaskResult> {
  // 1. Resolve module slug + category slug from the AvitoItem (if any).
  let moduleSlug: string | null = null;
  let avitoItemPublicId: string | null = null;
  let avitoItemTitle: string | null = null;
  if (input.avitoItemDbId) {
    const item = await prisma.avitoItem.findUnique({
      where: { id: input.avitoItemDbId },
      select: { moduleSlug: true, avitoItemId: true, title: true },
    });
    moduleSlug = item?.moduleSlug ?? null;
    avitoItemPublicId = item?.avitoItemId ?? null;
    avitoItemTitle = item?.title ?? null;
  }

  const mappedCategory =
    moduleSlug && moduleSlug.length > 0 ? MODULE_TO_CATEGORY[moduleSlug] : undefined;
  const categorySlug: MissedCallCategorySlug =
    mappedCategory ?? "avito-missed-call-unassigned";

  // 2. Lazily ensure the TaskCategory exists.
  const category = await ensureMissedCallCategory(categorySlug);

  // 3. Phone enrichment — best effort, never fatal.
  const phoneEnrichment = await lookupPhoneOwner(input.callerPhone);

  // 4. Compose Task metadata (TaskAvitoMetadata in ADR section 1.3).
  const taskMetadata: Record<string, unknown> = {
    source: "avito",
    kind: "missed_call",
    avitoCallEventId: input.callEventId,
    startedAt: input.startedAt.toISOString(),
  };
  if (input.avitoItemDbId) taskMetadata.avitoItemId = input.avitoItemDbId;
  if (avitoItemPublicId) taskMetadata.avitoItemPublicId = avitoItemPublicId;
  if (phoneEnrichment.linkedUserId) taskMetadata.linkedUserId = phoneEnrichment.linkedUserId;
  if (phoneEnrichment.linkedTenantId) taskMetadata.linkedTenantId = phoneEnrichment.linkedTenantId;

  const titleParts = [
    "Пропущенный звонок Авито",
    avitoItemTitle ? `— ${avitoItemTitle}` : null,
  ].filter(Boolean);
  const title = titleParts.join(" ").slice(0, 200);

  const descriptionLines = [
    `Время: ${input.startedAt.toISOString()}`,
    `Номер: ${input.callerPhone ?? "не передан"}`,
    avitoItemTitle ? `Объявление: ${avitoItemTitle}` : null,
    moduleSlug ? `Модуль: ${moduleSlug}` : "Объявление не привязано к модулю",
  ].filter(Boolean);
  const description = descriptionLines.join("\n");

  const externalContact: Record<string, unknown> = {};
  if (input.callerPhone) externalContact.phone = input.callerPhone;
  if (phoneEnrichment.normalized) externalContact.phoneNormalized = phoneEnrichment.normalized;

  // 5. Resolve a board + first column for this category.
  let boardId: string | null = category.defaultBoardId;
  if (!boardId) {
    const defaultBoard = await prisma.taskBoard.findFirst({
      where: { isDefault: true, isArchived: false },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    });
    boardId =
      defaultBoard?.id ??
      (
        await prisma.taskBoard.findFirst({
          where: { isArchived: false },
          orderBy: { sortOrder: "asc" },
          select: { id: true },
        })
      )?.id ??
      null;
  }
  if (!boardId) {
    // Cannot create Task without a board — drop a SystemEvent and bail.
    await prisma.systemEvent.create({
      data: {
        level: "ERROR",
        source: "avito.calls",
        message: "Cannot create missed-call Task: no TaskBoard configured",
        metadata: { callEventId: input.callEventId },
      },
    });
    return { taskCreated: false, taskId: null };
  }
  const firstColumn = await prisma.taskColumn.findFirst({
    where: { boardId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  if (!firstColumn) {
    await prisma.systemEvent.create({
      data: {
        level: "ERROR",
        source: "avito.calls",
        message: "Cannot create missed-call Task: board has no columns",
        metadata: { callEventId: input.callEventId, boardId },
      },
    });
    return { taskCreated: false, taskId: null };
  }

  // 6. Create the Task. publicId collisions are extremely rare; use a
  //    short retry loop matching tasks/service.ts behaviour.
  const { generatePublicId } = await import("@/modules/tasks/public-id");
  let taskRecord: { id: string; publicId: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const publicId = generatePublicId();
    try {
      taskRecord = await prisma.task.create({
        data: {
          publicId,
          boardId,
          columnId: firstColumn.id,
          categoryId: category.id,
          title,
          description,
          priority: category.priorityHint ?? "HIGH",
          source: "API",
          externalContact:
            Object.keys(externalContact).length > 0
              ? (externalContact as unknown as Prisma.InputJsonValue)
              : undefined,
        },
        select: { id: true, publicId: true },
      });
      break;
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }
  if (!taskRecord) {
    return { taskCreated: false, taskId: null };
  }

  // Persist metadata — Task.externalContact is the typed field; the wider
  // "avito" metadata bag piggybacks on TaskEvent.metadata so that downstream
  // code can pull it from the timeline without a schema change.
  await prisma.taskEvent.create({
    data: {
      taskId: taskRecord.id,
      kind: "CREATED",
      metadata: taskMetadata as unknown as Prisma.InputJsonValue,
    },
  });

  // Auto-assign default responsible if the category specifies one.
  if (category.defaultResponsibleUserId) {
    await prisma.taskAssignee
      .create({
        data: {
          taskId: taskRecord.id,
          userId: category.defaultResponsibleUserId,
          role: "RESPONSIBLE",
        },
      })
      .catch(() => {
        /* duplicate or stale FK — non-fatal */
      });
  }

  // AuditLog — actorless creation. Use system marker per pattern in tasks/service.ts.
  await prisma.auditLog
    .create({
      data: {
        userId: "system",
        action: "task.create",
        entity: "Task",
        entityId: taskRecord.id,
        metadata: {
          publicId: taskRecord.publicId,
          source: "API",
          via: "avito.call.missed",
          callEventId: input.callEventId,
        },
      },
    })
    .catch(() => {
      /* audit failure must not break the webhook */
    });

  // Fire-and-forget notification to assignees (event type `avito.call.missed`).
  // We use the shared task-event dispatcher so quiet-hours, dedup, and
  // per-user channel preferences kick in just like for any other task.
  void dispatchMissedCallNotification(taskRecord.id, taskRecord.publicId, title);

  return { taskCreated: true, taskId: taskRecord.id };
}

/**
 * Fan-out notification for the created missed-call Task.
 * Imported lazily to keep this module light and to avoid an import cycle
 * with `src/modules/tasks/notify.ts`.
 */
async function dispatchMissedCallNotification(
  taskId: string,
  publicId: string,
  title: string
): Promise<void> {
  try {
    const { dispatchTaskEvent } = await import("@/modules/tasks/notify");
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://delovoy-park.ru";
    await dispatchTaskEvent({
      taskId,
      eventType: "avito.call.missed",
      actorUserId: null,
      payload: {
        title: `Пропущенный звонок Авито (${publicId})`,
        body: title,
        actions: [
          { label: "Открыть задачу", url: `${baseUrl}/admin/tasks/${publicId}` },
        ],
        metadata: { entityType: "Task", entityId: taskId, publicId },
      },
    });
  } catch (err) {
    // Logged via SystemEvent — never throw from fire-and-forget.
    await prisma.systemEvent
      .create({
        data: {
          level: "WARNING",
          source: "avito.calls",
          message: "Failed to dispatch avito.call.missed notification",
          metadata: {
            taskId,
            error: err instanceof Error ? err.message : String(err),
          },
        },
      })
      .catch(() => {
        /* swallow */
      });
  }
}

// === Helpers =======================================================

type EnsuredCategory = {
  id: string;
  defaultBoardId: string | null;
  defaultResponsibleUserId: string | null;
  priorityHint: TaskPriority;
};

/**
 * Idempotent upsert of a `TaskCategory` by slug. Newly created categories
 * default to HIGH priorityHint (per ADR table in section 1.3) and are not
 * pre-bound to a TaskBoard — board resolution falls back to the default
 * board at task-creation time.
 */
async function ensureMissedCallCategory(
  slug: MissedCallCategorySlug
): Promise<EnsuredCategory> {
  const cat = await prisma.taskCategory.upsert({
    where: { slug },
    update: {},
    create: {
      slug,
      name: CATEGORY_NAMES[slug],
      priorityHint: "HIGH",
    },
    select: {
      id: true,
      defaultBoardId: true,
      defaultResponsibleUserId: true,
      priorityHint: true,
    },
  });
  return cat;
}

/** Result of phone-based enrichment lookup. */
type PhoneEnrichment = {
  normalized: string | null;
  linkedUserId: string | null;
  linkedTenantId: string | null;
};

/**
 * Match the caller's phone against `User.phone`, `User.phoneNormalized`
 * and `Tenant.phone`. Best-effort — returns nulls if no match.
 *
 * Falls back to a digits-only string if E.164 normalization rejects the
 * input (e.g. landline numbers Tenant might use).
 */
async function lookupPhoneOwner(rawPhone: string | null): Promise<PhoneEnrichment> {
  if (!rawPhone) {
    return { normalized: null, linkedUserId: null, linkedTenantId: null };
  }
  const normalized = normalizePhone(rawPhone);
  const digitsOnly = rawPhone.replace(/\D/g, "");

  let linkedUserId: string | null = null;
  if (normalized) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: normalized },
          { phoneNormalized: normalized },
        ],
      },
      select: { id: true },
    });
    linkedUserId = user?.id ?? null;
  } else if (digitsOnly.length > 0) {
    const user = await prisma.user.findFirst({
      where: { phone: { contains: digitsOnly } },
      select: { id: true },
    });
    linkedUserId = user?.id ?? null;
  }

  // Tenant.phone is free-form — search by both the raw value and digits-only.
  let linkedTenantId: string | null = null;
  if (digitsOnly.length >= 7) {
    const tenant = await prisma.tenant.findFirst({
      where: {
        OR: [
          { phone: rawPhone },
          ...(normalized ? [{ phone: normalized }] : []),
          { phone: { contains: digitsOnly } },
        ],
        isDeleted: false,
      },
      select: { id: true },
    });
    linkedTenantId = tenant?.id ?? null;
  }

  return { normalized, linkedUserId, linkedTenantId };
}
