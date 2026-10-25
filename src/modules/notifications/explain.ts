import type {
  NotificationChannelKind,
  NotificationEventPreference,
  NotificationGlobalPreference,
  Role,
  UserNotificationChannel,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { ADMIN_SECTIONS } from "@/lib/permissions";
import {
  EVENT_MODULE_CONTEXTS,
  MANAGED_EVENT_TYPES,
  NOTIFICATION_CATALOG,
  type ManagedCategory,
} from "./catalog";
import {
  contextAccess,
  evaluateRoute,
  type AccessDecision,
  type DeliveryPath,
  type StaffSnapshot,
} from "./audience-rules";
import { loadStaffSnapshots, resolveGroupChat } from "./audience";
import { hasEventAccess } from "./subscriptions";
import { mergePreferences, pickChannel } from "./dispatch/preferences";
import { ChannelRegistry } from "./dispatch/channel-registry";
import { bootstrapChannels } from "./dispatch/channels";
import {
  computeBotStatus,
  getBotContacts,
  getBotTrackingSince,
  toBotStatusDto,
  type BotStatus,
  type BotStatusDto,
} from "@/modules/telegram-link/bot-contact";

/**
 * «Кто что получает» per staff member (US-C1/C4, Center) — computed with the
 * same `evaluateRoute` the delivery uses (AC-C1.6), plus delivery readiness:
 * channels in real send order and what blocks delivery.
 * ADR 2026-10-25-team-access-notifications §5.2.
 */

export type ExplainStatus = "RECEIVES" | "BLOCKED" | "NOT_RECEIVING" | "NO_ACCESS";

export type ExplainBlockerCode = "NO_CHANNEL" | "BOT_NOT_STARTED" | "BOT_BLOCKED" | "CHANNEL_DISABLED" | "DND" | "OPTED_OUT";

export type ExplainEvent = {
  eventType: string;
  label: string;
  description: string;
  status: ExplainStatus;
  toggle: { enabled: boolean; editable: boolean; source: "explicit" | "default" };
  paths: Array<{ kind: DeliveryPath; label: string; moduleSlug: string | null }>;
  contexts: Array<{ moduleSlug: string | null; receives: boolean; paths: DeliveryPath[] }>;
  deliveryChannels: Array<{ kind: string; label: string }>;
  blockers: Array<{ code: ExplainBlockerCode; label: string }>;
  notes: Array<{ code: "QUIET_HOURS"; label: string }>;
  lastChange: { byName: string | null; via: string | null; at: string } | null;
};

export type ExplainChannel = {
  kind: NotificationChannelKind;
  label: string;
  order: number;
  deliverable: boolean;
  note?: string;
};

export type ExplainCategory = {
  key: string;
  label: string;
  description: string;
  icon: string;
  delivery: "personal" | "in-app";
  access: AccessDecision;
  groupChat: Array<{ moduleSlug: string; moduleLabel: string; receives: boolean }>;
  events: ExplainEvent[];
};

export type StaffNotificationExplain = {
  userId: string;
  role: Role;
  botStatus: BotStatusDto;
  channels: ExplainChannel[];
  globalNotes: Array<{ code: "DND" | "QUIET_HOURS"; label: string }>;
  categories: ExplainCategory[];
};

export const CHANNEL_LABELS: Record<string, string> = {
  TELEGRAM: "Telegram",
  PUSH: "Web Push",
  EMAIL: "Email",
  VK: "VK",
  MAX: "MAX",
  WHATSAPP: "WhatsApp",
  IMESSAGE: "iMessage",
  SMS: "SMS",
  AVITO: "Авито",
  IN_APP: "Лента Mini App",
};

const SECTION_LABELS = new Map<string, string>(ADMIN_SECTIONS.map((s) => [s.slug, s.label]));

export function moduleLabel(slug: string): string {
  if (slug === "rental-inquiry") return "Заявки на аренду";
  return SECTION_LABELS.get(slug) ?? slug;
}

export function pathLabel(kind: DeliveryPath, moduleSlug: string | null): string {
  switch (kind) {
    case "personal":
      return "Личная подписка";
    case "module_list":
      return `Список получателей раздела «${moduleLabel(moduleSlug ?? "")}»`;
    case "role_avito":
      return "По роли (Авито: суперадмины и назначенные на модуль)";
    case "in_app_superadmin":
      return "Лента Mini App (сводка звонков, суперадмины)";
  }
}

function formatMsk(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(date);
}

type ExplainInputs = {
  snapshot: StaffSnapshot;
  telegramId: string | null;
  channels: UserNotificationChannel[];
  prefRows: Map<string, NotificationEventPreference>;
  global: NotificationGlobalPreference | null;
  botStatus: BotStatus;
  groupChat: Map<string, boolean>;
  actorNames: Map<string, string | null>;
  channelAvailable: (kind: NotificationChannelKind) => boolean;
  now: Date;
};

/** Channels in real send order: pickChannel's primary, then the fallback chain by priority. */
function orderedChannels(
  input: ExplainInputs,
  pref: ReturnType<typeof mergePreferences>,
): Array<UserNotificationChannel & { deliverable: boolean; note?: string }> {
  const verified = input.channels
    .filter((c) => c.isActive && c.verifiedAt && input.channelAvailable(c.kind))
    .sort((a, b) => a.priority - b.priority);
  const primary = pickChannel(input.channels, pref, input.channelAvailable);
  const order = primary ? [primary, ...verified.filter((c) => c.id !== primary.id)] : [];
  const botDown = input.botStatus.state === "BLOCKED" || input.botStatus.state === "NOT_STARTED";
  return order.map((c) => {
    if (c.kind === "TELEGRAM" && botDown) {
      return { ...c, deliverable: false, note: input.botStatus.state === "BLOCKED" ? "Бот заблокирован" : "Бот не запущен" };
    }
    return { ...c, deliverable: true };
  });
}

function explainEvent(
  input: ExplainInputs,
  category: ManagedCategory,
  event: ManagedCategory["events"][number],
): ExplainEvent {
  const { snapshot } = input;
  const contexts = (EVENT_MODULE_CONTEXTS[event.eventType] ?? [null]).map((moduleSlug) => {
    const decision = evaluateRoute(snapshot, event.eventType, moduleSlug);
    return { moduleSlug, decision };
  });

  const pathMap = new Map<string, { kind: DeliveryPath; label: string; moduleSlug: string | null }>();
  for (const { moduleSlug, decision } of contexts) {
    for (const kind of decision.paths) {
      const slug = kind === "module_list" ? moduleSlug : null;
      pathMap.set(`${kind}:${slug ?? ""}`, { kind, label: pathLabel(kind, slug), moduleSlug: slug });
    }
  }
  const paths = [...pathMap.values()];
  const optedOut = contexts.some((c) => c.decision.optedOut);
  const receives = contexts.some((c) => c.decision.receives);
  const anyAccess = hasEventAccess(snapshot, event.eventType);

  const row = input.prefRows.get(event.eventType) ?? null;
  const pref = mergePreferences(input.global, row);
  const blockers: ExplainEvent["blockers"] = [];
  const notes: ExplainEvent["notes"] = [];
  let deliveryChannels: ExplainEvent["deliveryChannels"] = [];

  if (category.delivery === "in-app") {
    deliveryChannels = [{ kind: "IN_APP", label: CHANNEL_LABELS.IN_APP }];
  } else if (receives) {
    const ordered = orderedChannels(input, pref);
    deliveryChannels = ordered.map((c) => ({ kind: c.kind, label: CHANNEL_LABELS[c.kind] ?? c.kind }));
    if (!ordered.some((c) => c.deliverable)) {
      const telegram = ordered.find((c) => c.kind === "TELEGRAM");
      if (telegram && input.botStatus.state === "BLOCKED") blockers.push({ code: "BOT_BLOCKED", label: "Бот заблокирован" });
      else if (telegram && input.botStatus.state === "NOT_STARTED") blockers.push({ code: "BOT_NOT_STARTED", label: "Бот не запущен" });
      else if (input.channels.some((c) => !c.isActive)) blockers.push({ code: "CHANNEL_DISABLED", label: "Канал отключён" });
      else blockers.push({ code: "NO_CHANNEL", label: "Нет канала доставки" });
    }
    if (pref.dndUntil && pref.dndUntil > input.now) {
      blockers.push({ code: "DND", label: `Не беспокоить до ${formatMsk(pref.dndUntil)}` });
    }
    if (pref.quietHoursFrom && pref.quietHoursTo) {
      // Quiet hours defer, they don't drop — a note, not a blocker (honest screen).
      notes.push({ code: "QUIET_HOURS", label: `Тихие часы ${pref.quietHoursFrom}–${pref.quietHoursTo}: доставка откладывается` });
    }
  }

  let status: ExplainStatus;
  if (receives) status = blockers.length > 0 ? "BLOCKED" : "RECEIVES";
  else if (optedOut && (paths.length > 0 || anyAccess)) status = "NOT_RECEIVING";
  else if (anyAccess) status = "NOT_RECEIVING";
  else status = "NO_ACCESS";

  if (optedOut && status === "NOT_RECEIVING") {
    const by = row?.updatedByUserId && row.updatedByUserId !== snapshot.id ? input.actorNames.get(row.updatedByUserId) : null;
    blockers.push({ code: "OPTED_OUT", label: by ? `Отключено: ${by}` : "Отключено сотрудником" });
  }

  return {
    eventType: event.eventType,
    label: event.label,
    description: event.description,
    status,
    toggle: { enabled: receives, editable: anyAccess || row !== null, source: row ? "explicit" : "default" },
    paths,
    contexts: contexts.map(({ moduleSlug, decision }) => ({ moduleSlug, receives: decision.receives, paths: decision.paths })),
    deliveryChannels,
    blockers,
    notes,
    lastChange: row
      ? {
          byName: row.updatedByUserId ? (input.actorNames.get(row.updatedByUserId) ?? null) : null,
          via: row.updatedVia,
          at: row.updatedAt.toISOString(),
        }
      : null,
  };
}

/** Pure assembly — exported for tests. */
export function buildExplain(input: ExplainInputs): StaffNotificationExplain {
  const categories = NOTIFICATION_CATALOG.map<ExplainCategory>((category) => {
    const events = category.events.map((event) => explainEvent(input, category, event));
    const contexts = [...new Set(category.events.flatMap((e) => EVENT_MODULE_CONTEXTS[e.eventType] ?? [null]))];
    const decisions = contexts.map((ctx) => contextAccess(input.snapshot, category, ctx));
    const access = decisions.find((d) => d.ok) ?? decisions[0] ?? contextAccess(input.snapshot, category, null);
    const groupChat = contexts
      .filter((ctx): ctx is string => ctx !== null && input.groupChat.has(ctx))
      .map((slug) => ({ moduleSlug: slug, moduleLabel: moduleLabel(slug), receives: input.groupChat.get(slug) === true }));
    return {
      key: category.key,
      label: category.label,
      description: category.description,
      icon: category.icon,
      delivery: category.delivery === "in-app" ? "in-app" : "personal",
      access,
      groupChat,
      events,
    };
  });

  const pref = mergePreferences(input.global, null);
  const channels = orderedChannels(input, pref).map((c, i) => ({
    kind: c.kind,
    label: CHANNEL_LABELS[c.kind] ?? c.kind,
    order: i + 1,
    deliverable: c.deliverable,
    ...(c.note ? { note: c.note } : {}),
  }));

  const globalNotes: StaffNotificationExplain["globalNotes"] = [];
  if (input.global?.dndUntil && input.global.dndUntil > input.now) {
    globalNotes.push({ code: "DND", label: `Не беспокоить до ${formatMsk(input.global.dndUntil)}` });
  }
  if (input.global?.quietHoursFrom && input.global.quietHoursTo) {
    globalNotes.push({ code: "QUIET_HOURS", label: `Тихие часы ${input.global.quietHoursFrom}–${input.global.quietHoursTo}` });
  }

  return {
    userId: input.snapshot.id,
    role: input.snapshot.role,
    botStatus: toBotStatusDto(input.botStatus),
    channels,
    globalNotes,
    categories,
  };
}

/** Group-chat flag per module context, shared by every explained user. */
async function loadGroupChatFlags(): Promise<Map<string, boolean>> {
  const slugs = [
    ...new Set(
      Object.values(EVENT_MODULE_CONTEXTS)
        .flat()
        .filter((s): s is string => s !== null),
    ),
  ];
  const decisions = await Promise.all(slugs.map((slug) => resolveGroupChat(slug, undefined)));
  return new Map(slugs.map((slug, i) => [slug, decisions[i].send]));
}

export async function explainStaffNotifications(
  userIds: string[],
  now: Date = new Date(),
): Promise<Map<string, StaffNotificationExplain>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  bootstrapChannels();

  const [snapshots, users, channels, prefRows, globals, groupChat, trackingSince] = await Promise.all([
    loadStaffSnapshots({ userIds: ids }),
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, telegramId: true } }),
    prisma.userNotificationChannel.findMany({ where: { userId: { in: ids } } }),
    prisma.notificationEventPreference.findMany({
      where: { userId: { in: ids }, eventType: { in: MANAGED_EVENT_TYPES as string[] } },
    }),
    prisma.notificationGlobalPreference.findMany({ where: { userId: { in: ids } } }),
    loadGroupChatFlags(),
    getBotTrackingSince(),
  ]);

  const telegramIds = users.map((u) => u.telegramId).filter((t): t is string => Boolean(t));
  const actorIds = [...new Set(prefRows.map((r) => r.updatedByUserId).filter((a): a is string => Boolean(a)))];
  const [contacts, actors] = await Promise.all([
    getBotContacts(telegramIds),
    actorIds.length
      ? prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
  ]);
  const actorNames = new Map(actors.map((a) => [a.id, a.name ?? a.email ?? null]));
  const telegramById = new Map(users.map((u) => [u.id, u.telegramId]));
  const channelAvailable = (kind: NotificationChannelKind) => Boolean(ChannelRegistry.get(kind)?.isAvailable());

  const result = new Map<string, StaffNotificationExplain>();
  for (const snapshot of snapshots) {
    const telegramId = telegramById.get(snapshot.id) ?? null;
    const botStatus = computeBotStatus(telegramId, telegramId ? contacts.get(telegramId) : null, trackingSince);
    result.set(
      snapshot.id,
      buildExplain({
        snapshot,
        telegramId,
        channels: channels.filter((c) => c.userId === snapshot.id),
        prefRows: new Map(prefRows.filter((r) => r.userId === snapshot.id).map((r) => [r.eventType, r])),
        global: globals.find((g) => g.userId === snapshot.id) ?? null,
        botStatus,
        groupChat,
        actorNames,
        channelAvailable,
        now,
      }),
    );
  }
  return result;
}
