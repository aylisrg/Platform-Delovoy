import { ChannelRegistry } from "../channel-registry";
import { TelegramChannel } from "./telegram";
import { EmailChannel } from "./email";
import { AvitoChannel } from "./avito";
import {
  WhatsAppChannel,
  MaxChannel,
  IMessageChannel,
  SmsChannel,
  PushChannel,
} from "./stubs";
import { VkChannel } from "./vk";
import { WebPushChannel } from "./web-push";
import { isWebPushEnabled } from "./web-push/vapid";

let bootstrapped = false;

/**
 * Register all known channels. Idempotent. Call from app entry / dispatcher.
 * Adding a new channel = new class + one line here. Zero changes to dispatcher
 * or to consuming modules (tasks, cafe, gazebos, …).
 */
export function bootstrapChannels(): void {
  if (bootstrapped) return;
  ChannelRegistry.register(new TelegramChannel());
  ChannelRegistry.register(new EmailChannel());
  ChannelRegistry.register(new AvitoChannel());
  ChannelRegistry.register(WhatsAppChannel);
  ChannelRegistry.register(MaxChannel);
  ChannelRegistry.register(IMessageChannel);
  ChannelRegistry.register(SmsChannel);
  // Web Push: реальный канал заменяет PUSH-stub только при WEB_PUSH_ENABLED=true
  // и валидном VAPID-конфиге. Иначе остаётся stub (isAvailable=false → no-op).
  // По умолчанию OFF — безопасный no-op деплой.
  if (isWebPushEnabled()) {
    ChannelRegistry.register(new WebPushChannel());
  } else {
    ChannelRegistry.register(PushChannel);
  }
  ChannelRegistry.register(new VkChannel());
  bootstrapped = true;
}

export { ChannelRegistry };
