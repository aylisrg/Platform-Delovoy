import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import type { NotificationPayload } from "./types";

export const DEDUP_WINDOW_MINUTES = 5;

export function computeDedupKey(input: {
  userId: string;
  eventType: string;
  entityId?: string;
  payload: NotificationPayload;
}): string {
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
