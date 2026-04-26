import type { NotificationChannelKind } from "@prisma/client";
import type {
  DeliveryResult,
  INotificationChannel,
  NotificationPayload,
} from "../types";

/**
 * Generic "not yet configured" stub. Used for channels we know about but
 * have not implemented yet. Always reports unavailable; send() is a no-op
 * that records FAILED with `retryable=false`.
 *
 * Existence in the registry guarantees `Dispatcher` doesn't crash if a user
 * accidentally selects WhatsApp/MAX/iMessage/SMS as primary.
 */
class StubChannel implements INotificationChannel {
  constructor(public readonly kind: NotificationChannelKind) {}

  isAvailable(): boolean {
    return false;
  }

  async send(_address: string, _payload: NotificationPayload): Promise<DeliveryResult> {
    return {
      ok: false,
      reason: `channel ${this.kind} not yet configured`,
      retryable: false,
    };
  }
}

export const WhatsAppChannel = new StubChannel("WHATSAPP");
export const MaxChannel = new StubChannel("MAX");
export const IMessageChannel = new StubChannel("IMESSAGE");
export const SmsChannel = new StubChannel("SMS");
export const PushChannel = new StubChannel("PUSH");
export const VkChannel = new StubChannel("VK");
