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
  VkChannel,
} from "./stubs";

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
  ChannelRegistry.register(PushChannel);
  ChannelRegistry.register(VkChannel);
  bootstrapped = true;
}

export { ChannelRegistry };
