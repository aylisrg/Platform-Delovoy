import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import type { NotificationPayload } from "./types";

export const DEDUP_WINDOW_MINUTES = 5;

/**
 * События-состояния: `entityId` означает «состояние сущности», а не «поток
 * сообщений о ней». Для них две по-разному сформулированные отправки об одном
 * и том же состоянии внутри окна — это дубль, и текст в ключ не входит.
 *
 * Аллоулист, а не сплошное правило: `messenger.message.received` шлётся с
 * entityId = chatId, а `task.*` — с entityId = taskId; схлопывание по сущности
 * склеило бы два разных сообщения в чате и два разных комментария к задаче.
 * См. ADR docs/architecture/2026-08-13-miniapp-role-rebuild-adr.md §7.
 */
const ENTITY_SCOPED_PREFIXES = [
  "booking.",
  "order.",
  "payment.",
  "contract.",
  "inquiry.",
  "system.",
];
const ENTITY_SCOPED_EXACT = ["BROADCAST"];

function isEntityScoped(eventType: string): boolean {
  return (
    ENTITY_SCOPED_EXACT.includes(eventType) ||
    ENTITY_SCOPED_PREFIXES.some((prefix) => eventType.startsWith(prefix))
  );
}

export function computeDedupKey(input: {
  userId: string;
  eventType: string;
  entityId?: string;
  payload: NotificationPayload;
}): string {
  const entityScoped = Boolean(input.entityId) && isEntityScoped(input.eventType);

  if (entityScoped) {
    const raw = [input.userId, input.eventType, input.entityId].join("|");
    return createHash("sha256").update(raw).digest("hex");
  }

  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ t: input.payload.title, b: input.payload.body }))
    .digest("hex");
  const raw = [
    input.userId,
    input.eventType,
    input.entityId ?? "",
    payloadHash,
  ].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * True if a non-skipped OutgoingNotification with this dedupKey exists in
 * the last DEDUP_WINDOW_MINUTES minutes.
 */
export async function isDuplicate(dedupKey: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MINUTES * 60_000);
  const existing = await prisma.outgoingNotification.findFirst({
    where: {
      dedupKey,
      createdAt: { gt: cutoff },
      status: { in: ["SENT", "PENDING", "DEFERRED"] },
    },
    select: { id: true },
  });
  return existing !== null;
}
