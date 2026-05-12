import type { NotificationChannelKind } from "@prisma/client";
import type {
  DeliveryResult,
  INotificationChannel,
  NotificationPayload,
} from "../types";

/**
 * VK Community Messages channel.
 *
 * Sends messages via VK Community API (messages.send). The community token
 * must have `messages` permission. The user must have opened a dialog with
 * the community first — VK API returns error code 901 otherwise, which we
 * map to a non-retryable failure so the dispatcher can fall back to the
 * next configured channel (usually email).
 *
 * address = VK user_id (string of integer, e.g. "123456")
 * VK_COMMUNITY_TOKEN = community access token from vk.com/editapp
 */
export class VkChannel implements INotificationChannel {
  readonly kind: NotificationChannelKind = "VK";

  constructor(
    private readonly token: string | undefined = process.env.VK_COMMUNITY_TOKEN
  ) {}

  isAvailable(): boolean {
    return Boolean(this.token);
  }

  async send(address: string, payload: NotificationPayload): Promise<DeliveryResult> {
    if (!this.token) {
      return { ok: false, reason: "VK_COMMUNITY_TOKEN not set", retryable: false };
    }

    const message = formatPayload(payload);
    // VK requires random_id to be a unique integer per send (dedup guard).
    // We derive a 31-bit value from current time + address hash so it fits
    // within a signed 32-bit integer and is practically unique per call.
    const randomId = deriveRandomId(address);

    try {
      const res = await fetch("https://api.vk.com/method/messages.send", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          user_id: address,
          message,
          random_id: String(randomId),
          access_token: this.token,
          v: "5.199",
        }),
      });

      const json = (await res.json()) as VkApiResponse;

      if ("error" in json) {
        const code = json.error.error_code;
        // 901 = user hasn't opened the community dialog yet
        const retryable = code !== 901 && res.status >= 500;
        return {
          ok: false,
          reason: `VK error ${code}: ${json.error.error_msg}`,
          retryable,
        };
      }

      return { ok: true, externalId: String(json.response) };
    } catch (err) {
      return { ok: false, reason: (err as Error).message, retryable: true };
    }
  }
}

type VkApiResponse =
  | { response: number }
  | { error: { error_code: number; error_msg: string } };

function formatPayload(p: NotificationPayload): string {
  const parts: string[] = [`${p.title}\n\n${p.body}`];
  if (p.actions?.length) {
    for (const a of p.actions) {
      if (a.url) parts.push(`${a.label}: ${a.url}`);
    }
  }
  return parts.join("\n");
}

function deriveRandomId(address: string): number {
  // XOR timestamp low bits with a hash of the address.
  // Result is clamped to [1, 2^31 - 1] per VK API requirement.
  const ts = Date.now() & 0x7fffffff;
  let h = 0;
  for (let i = 0; i < address.length; i++) {
    h = (Math.imul(31, h) + address.charCodeAt(i)) | 0;
  }
  return ((ts ^ (h & 0x7fffffff)) || 1) & 0x7fffffff;
}
