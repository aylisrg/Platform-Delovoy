import type { NotificationChannelKind } from "@prisma/client";
import type { INotificationChannel } from "./types";

class ChannelRegistryImpl {
  private channels = new Map<NotificationChannelKind, INotificationChannel>();

  register(channel: INotificationChannel): void {
    this.channels.set(channel.kind, channel);
  }

  get(kind: NotificationChannelKind): INotificationChannel | undefined {
    return this.channels.get(kind);
  }

  available(): NotificationChannelKind[] {
    return [...this.channels.values()]
      .filter((c) => c.isAvailable())
      .map((c) => c.kind);
  }

  all(): NotificationChannelKind[] {
    return [...this.channels.keys()];
  }

  /** Test-only — clear all registrations */
  reset(): void {
    this.channels.clear();
  }
}

export const ChannelRegistry = new ChannelRegistryImpl();
