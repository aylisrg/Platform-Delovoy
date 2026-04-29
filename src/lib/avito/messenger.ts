/**
 * Avito Messenger API: send / list chats / list messages + inbound webhook parser.
 *
 * Endpoints (see ADR §2.6, §4):
 *  - POST  /messenger/v1/accounts/{user_id}/chats/{chat_id}/messages — send text
 *  - GET   /messenger/v3/accounts/{user_id}/chats?unread_only=true   — list chats
 *  - GET   /messenger/v3/accounts/{user_id}/chats/{chat_id}/messages — read messages
 *
 * The Avito user_id is loaded from `AvitoIntegration.avitoUserId` (synced via
 * `syncAccount()` in PR-1). If not set, send/poll operations return a
 * non-retryable failure result rather than throwing.
 */

import { prisma } from "@/lib/db";
import { avitoFetch, isAvitoCredentialsConfigured } from "./client";
import { AvitoMessengerWebhookSchema } from "./validation";
import { AvitoApiError } from "./types";
import type { DeliveryResult } from "@/modules/notifications/dispatch/types";

/** Lazy load avitoUserId from singleton AvitoIntegration row. */
async function getAvitoUserId(): Promise<string | null> {
  const integration = await prisma.avitoIntegration.findUnique({
    where: { id: "default" },
    select: { avitoUserId: true },
  });
  return integration?.avitoUserId ?? null;
}

export type SendMessageInput = {
  chatId: string;
  itemId?: string;
  text: string;
};

/**
 * Send a text message in an existing Avito chat. The chat must already exist
 * (Avito does not support starting a chat from the seller side — see ADR Q1).
 *
 * Returns a `DeliveryResult` so callers can hand it directly back to the
 * NotificationDispatcher (`AvitoChannel.send`).
 */
export async function sendMessage(input: SendMessageInput): Promise<DeliveryResult> {
  if (!isAvitoCredentialsConfigured()) {
    return { ok: false, reason: "AVITO_NOT_CONFIGURED", retryable: false };
  }
  const avitoUserId = await getAvitoUserId();
  if (!avitoUserId) {
    return { ok: false, reason: "AVITO_USER_ID_NOT_SET", retryable: false };
  }
  if (!input.chatId) {
    return { ok: false, reason: "chatId missing", retryable: false };
  }
  if (!input.text || !input.text.trim()) {
    return { ok: false, reason: "text empty", retryable: false };
  }

  try {
    const res = await avitoFetch<{ id?: string }>(
      `/messenger/v1/accounts/${encodeURIComponent(avitoUserId)}/chats/${encodeURIComponent(
        input.chatId
      )}/messages`,
      {
        method: "POST",
        body: { message: { text: input.text }, type: "text" },
        retries: 2,
      }
    );
    return { ok: true, externalId: res?.id };
  } catch (err) {
    if (err instanceof AvitoApiError) {
      return {
        ok: false,
        reason: err.message,
        retryable: err.retryable,
      };
    }
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "unknown error",
      retryable: true,
    };
  }
}

export type AvitoUnreadChat = {
  chatId: string;
  itemId: string | null;
  lastMessageAt: Date | null;
};

/**
 * List unread chats for the parc account. Used by the polling fallback (PR-2)
 * when webhook delivery is unreliable.
 */
export async function listChatsUnread(): Promise<AvitoUnreadChat[]> {
  if (!isAvitoCredentialsConfigured()) return [];
  const avitoUserId = await getAvitoUserId();
  if (!avitoUserId) return [];

  type ChatPayload = {
    id: string;
    context?: { value?: { id?: number | string } };
    last_message?: { created?: number };
  };

  try {
    const res = await avitoFetch<{ chats?: ChatPayload[] }>(
      `/messenger/v3/accounts/${encodeURIComponent(avitoUserId)}/chats`,
      { query: { unread_only: "true", limit: 100 } }
    );
    return (res?.chats ?? []).map((c) => ({
      chatId: c.id,
      itemId: c.context?.value?.id !== undefined ? String(c.context.value.id) : null,
      lastMessageAt: c.last_message?.created
        ? new Date(c.last_message.created * 1000)
        : null,
    }));
  } catch {
    return [];
  }
}

export type AvitoInboundMessage = {
  avitoMessageId: string;
  avitoChatId: string;
  avitoItemId: string | null;
  authorAvitoUserId: string | null;
  body: string;
  receivedAt: Date;
  rawPayload: unknown;
};

/**
 * Read messages of a specific chat created after the given timestamp.
 * Used by the polling fallback to fetch new messages between webhook gaps.
 */
export async function listMessages(
  chatId: string,
  sinceTs: Date | null
): Promise<AvitoInboundMessage[]> {
  if (!isAvitoCredentialsConfigured()) return [];
  const avitoUserId = await getAvitoUserId();
  if (!avitoUserId) return [];

  type MessagePayload = {
    id: string;
    chat_id?: string;
    created?: number;
    author_id?: number;
    type?: string;
    content?: { text?: string };
  };

  try {
    const res = await avitoFetch<{ messages?: MessagePayload[] }>(
      `/messenger/v3/accounts/${encodeURIComponent(avitoUserId)}/chats/${encodeURIComponent(
        chatId
      )}/messages`,
      { query: { limit: 50 } }
    );

    const sinceSec = sinceTs ? Math.floor(sinceTs.getTime() / 1000) : 0;
    const out: AvitoInboundMessage[] = [];
    for (const m of res?.messages ?? []) {
      const created = m.created ?? 0;
      if (created <= sinceSec) continue;
      const text = m.content?.text ?? "";
      if (!text) continue; // skip non-text (system/image) messages for now
      out.push({
        avitoMessageId: m.id,
        avitoChatId: m.chat_id ?? chatId,
        avitoItemId: null,
        authorAvitoUserId: m.author_id !== undefined ? String(m.author_id) : null,
        body: text,
        receivedAt: new Date(created * 1000),
        rawPayload: m,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Validate and normalize an incoming Messenger webhook payload from Avito.
 * Returns parsed message data on success or null on validation failure.
 *
 * Avito does NOT retry webhook delivery on 4xx/5xx — we always 200 OK and
 * either accept or silently drop, with WARNING logged in SystemEvent by the
 * caller.
 */
export function parseInboundWebhook(rawJson: unknown): AvitoInboundMessage | null {
  const parsed = AvitoMessengerWebhookSchema.safeParse(rawJson);
  if (!parsed.success) return null;
  const v = parsed.data.payload.value;
  const text = v.content?.text ?? "";
  if (!text) return null;
  return {
    avitoMessageId: v.id,
    avitoChatId: v.chat_id,
    avitoItemId: v.item_id !== undefined ? String(v.item_id) : null,
    authorAvitoUserId: String(v.author_id),
    body: text,
    receivedAt: new Date(v.created * 1000),
    rawPayload: rawJson,
  };
}
