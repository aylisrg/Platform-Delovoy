/**
 * AvitoChannel — outbound notifications via Avito Messenger API.
 *
 * Semantics (ADR §4):
 *  - Address format: `${chatId}:${itemId}` (itemId may be empty).
 *  - This channel sends messages from the parc account to a buyer in an
 *    EXISTING Avito chat. Avito does NOT support starting a chat from the
 *    seller side, so this is reactive only.
 *  - The "user" in the dispatcher's perspective is the manager — but Avito
 *    address is per-buyer-chat, not per-manager. As a result, this channel is
 *    NOT enrolled in user-level subscriptions. It is invoked directly from
 *    `routeInboundMessage()` (auto-reply) and from `/api/tasks/.../avito/reply`
 *    (manager reply).
 *
 * Registration: see `bootstrapChannels()` in ./index.ts.
 */

import type { NotificationChannelKind } from "@prisma/client";
import { sendMessage } from "@/lib/avito/messenger";
import { isAvitoCredentialsConfigured } from "@/lib/avito/client";
import type {
  DeliveryResult,
  INotificationChannel,
  NotificationPayload,
} from "../types";

export class AvitoChannel implements INotificationChannel {
  readonly kind: NotificationChannelKind = "AVITO";

  isAvailable(): boolean {
    return isAvitoCredentialsConfigured();
  }

  /**
   * @param address `${chatId}:${itemId}` — itemId is optional but the
   *                separator must be present (use `${chatId}:` for unknown).
   */
  async send(
    address: string,
    payload: NotificationPayload
  ): Promise<DeliveryResult> {
    const sep = address.indexOf(":");
    const chatId = sep >= 0 ? address.slice(0, sep) : address;
    const itemId = sep >= 0 ? address.slice(sep + 1) : "";
    if (!chatId) {
      return { ok: false, reason: "chatId missing", retryable: false };
    }

    const text = formatPayload(payload);

    return sendMessage({
      chatId,
      itemId: itemId || undefined,
      text,
    });
  }
}

function formatPayload(p: NotificationPayload): string {
  const parts: string[] = [];
  if (p.title) parts.push(p.title);
  if (p.body) parts.push(p.body);
  if (p.actions?.length) {
    for (const a of p.actions) {
      if (a.url) parts.push(`${a.label}: ${a.url}`);
    }
  }
  return parts.filter(Boolean).join("\n\n");
}
