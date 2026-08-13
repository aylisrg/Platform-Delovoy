import { prisma } from "@/lib/db";

/**
 * Лента Mini App (ADR 2026-08-13-miniapp-role-rebuild §3.1).
 *
 * Два источника, потому что ни один по отдельности не даёт честную ленту:
 *  1. `OutgoingNotification` пользователя — персональные события и те рассылки,
 *     что реально до него доехали. Записи создаются только при наличии
 *     верифицированного канала (`dispatch()` → `pickChannel`), поэтому у
 *     обычного гостя Mini App их обычно нет вовсе.
 *  2. `BroadcastCampaign` сегмента `all_verified_users` — «новости парка для
 *     всех». Таргетированные сегменты (арендаторы, гости PS-парка/беседок)
 *     в ленту случайного гостя не попадают: их видно только тем, кому
 *     рассылка реально ушла, то есть через источник №1.
 *
 * Плюс два нюанса, которые ломают наивную реализацию:
 *  - `attemptFallback` создаёт вторую строку с тем же `dedupKey` — без
 *    схлопывания лента показала бы дубль;
 *  - кампания, доставленная лично, обязана прийти из источника №1 и не
 *    продублироваться карточкой из источника №2.
 */

/** Единственный сегмент, который трактуется как «новости парка для всех». */
export const PUBLIC_SEGMENT_KEY = "all_verified_users";

/** Кампании в этих статусах уже показаны аудитории. */
const PUBLIC_CAMPAIGN_STATUSES = ["running", "completed"];

/** Префиксы id элементов ленты: источник виден по id, склейки нет. */
const PERSONAL_PREFIX = "on:";
const CAMPAIGN_PREFIX = "bc:";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Сколько новостей максимум сканируем при подсчёте непрочитанного. */
const UNREAD_CAMPAIGN_SCAN_LIMIT = 100;

/** Максимум действий на карточке — защита от раздутого payload. */
const MAX_ACTIONS = 3;
const MAX_LABEL_LENGTH = 64;

export type FeedItemKind = "personal" | "news";

export interface FeedAction {
  label: string;
  url: string;
}

export interface FeedItem {
  /** "on:<outgoingId>" | "bc:<campaignId>" */
  id: string;
  kind: FeedItemKind;
  eventType: string;
  title: string;
  body: string;
  actions: FeedAction[];
  createdAt: string;
  readAt: string | null;
  moduleSlug: string | null;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface FeedQuery {
  cursor?: string;
  limit?: number;
}

export interface FeedReadInput {
  ids?: string[];
  upTo?: string;
}

export interface FeedReadResult {
  /** Сколько персональных строк реально перешло в «прочитано» */
  updated: number;
  feedSeenAt: string | null;
  unreadCount: number;
}

type PersonalRow = {
  id: string;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
  dedupKey: string;
};

type CampaignRow = {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
};

type MergedItem = Omit<FeedItem, "createdAt" | "readAt"> & {
  createdAt: Date;
  readAt: Date | null;
};

// ── Санитизация контента ────────────────────────────────────────────────────

/**
 * Пропускаем только `https:` и относительные пути с одного `/`.
 * Всё остальное (`javascript:`, `tg://`, `data:`, `//evil.com`) вырезается:
 * контент авторит SUPERADMIN, но открывается он в WebView — при компрометации
 * админ-аккаунта ссылка стала бы вектором (ADR §3.1).
 */
export function sanitizeActionUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url) return null;

  // Относительный путь внутри Mini App; "//host" — это protocol-relative
  // абсолютный URL, поэтому отсекается отдельно.
  if (url.startsWith("/")) return url.startsWith("//") ? null : url;

  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function readActions(raw: unknown): FeedAction[] {
  if (!Array.isArray(raw)) return [];
  const actions: FeedAction[] = [];

  for (const entry of raw) {
    if (actions.length >= MAX_ACTIONS) break;
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { label?: unknown; url?: unknown };
    const url = sanitizeActionUrl(candidate.url);
    if (!url) continue;
    const label =
      typeof candidate.label === "string" && candidate.label.trim()
        ? candidate.label.trim().slice(0, MAX_LABEL_LENGTH)
        : "Открыть";
    actions.push({ label, url });
  }

  return actions;
}

function readPayload(raw: unknown): {
  title: string;
  body: string;
  actions: FeedAction[];
} {
  if (!raw || typeof raw !== "object") {
    return { title: "Уведомление", body: "", actions: [] };
  }
  const payload = raw as { title?: unknown; body?: unknown; actions?: unknown };
  return {
    title: typeof payload.title === "string" ? payload.title : "Уведомление",
    body: typeof payload.body === "string" ? payload.body : "",
    actions: readActions(payload.actions),
  };
}

// ── Привязка к модулю (для иконки/группировки на клиенте) ────────────────────

/**
 * `entityType` у `dispatch()` неоднороден: `notifyAdmin` кладёт туда
 * `moduleSlug`, мессенджер — "chat", задачи — "Task". Поэтому: известный slug
 * берём как есть, иначе выводим из префикса типа события, иначе честный null.
 */
const KNOWN_MODULE_SLUGS = new Set([
  "gazebos",
  "ps-park",
  "cafe",
  "rental",
  "nedelovoy",
  "parking",
  "inventory",
  "tasks",
  "messenger",
  "monitoring",
  "payments",
  "clients",
  "analytics",
  "feedback",
  "subscriptions",
]);

const EVENT_PREFIX_MODULE: ReadonlyArray<readonly [string, string]> = [
  ["order.", "cafe"],
  ["contract.", "rental"],
  ["inquiry.", "rental"],
  ["payment.", "payments"],
  ["messenger.", "messenger"],
  ["task.", "tasks"],
  ["system.", "monitoring"],
];

function resolveModuleSlug(
  eventType: string,
  entityType: string | null
): string | null {
  if (entityType && KNOWN_MODULE_SLUGS.has(entityType)) return entityType;
  const match = EVENT_PREFIX_MODULE.find(([prefix]) =>
    eventType.startsWith(prefix)
  );
  return match ? match[1] : null;
}

// ── Чтение ленты ────────────────────────────────────────────────────────────

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  const value = Math.trunc(limit as number);
  if (value < 1) return DEFAULT_LIMIT;
  return Math.min(value, MAX_LIMIT);
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Схлопывание fallback-цепочки: строки сортированы desc, берём самую свежую. */
function collapseByDedupKey(rows: PersonalRow[]): PersonalRow[] {
  const seen = new Set<string>();
  const collapsed: PersonalRow[] = [];
  for (const row of rows) {
    if (row.dedupKey) {
      if (seen.has(row.dedupKey)) continue;
      seen.add(row.dedupKey);
    }
    collapsed.push(row);
  }
  return collapsed;
}

function toPersonalItem(row: PersonalRow): MergedItem {
  const { title, body, actions } = readPayload(row.payload);
  const isCampaign = row.entityType === "BroadcastCampaign";
  return {
    id: `${PERSONAL_PREFIX}${row.id}`,
    kind: isCampaign ? "news" : "personal",
    eventType: row.eventType,
    title,
    body,
    actions,
    createdAt: row.createdAt,
    readAt: row.readAt,
    moduleSlug: resolveModuleSlug(row.eventType, row.entityType),
  };
}

function toCampaignItem(row: CampaignRow, feedSeenAt: Date | null): MergedItem {
  const { title, body, actions } = readPayload(row.payload);
  return {
    id: `${CAMPAIGN_PREFIX}${row.id}`,
    kind: "news",
    eventType: row.eventType || "BROADCAST",
    title,
    body,
    actions,
    createdAt: row.createdAt,
    // У новости нет персональной строки — «прочитано» определяет watermark.
    readAt: feedSeenAt && feedSeenAt >= row.createdAt ? feedSeenAt : null,
    moduleSlug: null,
  };
}

function serialize(item: MergedItem): FeedItem {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    readAt: item.readAt ? item.readAt.toISOString() : null,
  };
}

/** id кампаний из списка, которые реально доставлены пользователю лично. */
async function findDeliveredCampaignIds(
  userId: string,
  campaignIds: string[]
): Promise<Set<string>> {
  if (campaignIds.length === 0) return new Set();
  const delivered = await prisma.outgoingNotification.findMany({
    where: {
      userId,
      entityType: "BroadcastCampaign",
      entityId: { in: campaignIds },
    },
    select: { entityId: true },
  });
  return new Set(
    delivered
      .map((row) => row.entityId)
      .filter((id): id is string => Boolean(id))
  );
}

/**
 * Непрочитанное = персональные строки без `readAt` + новости свежее watermark'а,
 * которых нет персонально (иначе одна кампания считалась бы дважды).
 */
async function countUnread(
  userId: string,
  feedSeenAt: Date | null
): Promise<number> {
  const [personalUnread, campaigns] = await Promise.all([
    prisma.outgoingNotification.count({ where: { userId, readAt: null } }),
    prisma.broadcastCampaign.findMany({
      where: {
        segmentKey: PUBLIC_SEGMENT_KEY,
        status: { in: PUBLIC_CAMPAIGN_STATUSES },
        ...(feedSeenAt ? { createdAt: { gt: feedSeenAt } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: UNREAD_CAMPAIGN_SCAN_LIMIT,
      select: { id: true },
    }),
  ]);

  if (campaigns.length === 0) return personalUnread;

  const deliveredIds = await findDeliveredCampaignIds(
    userId,
    campaigns.map((campaign) => campaign.id)
  );
  const unreadNews = campaigns.filter(
    (campaign) => !deliveredIds.has(campaign.id)
  ).length;

  return personalUnread + unreadNews;
}

async function getFeedSeenAt(userId: string): Promise<Date | null> {
  const pref = await prisma.notificationGlobalPreference.findUnique({
    where: { userId },
    select: { feedSeenAt: true },
  });
  return pref?.feedSeenAt ?? null;
}

/**
 * Страница ленты: keyset-пагинация по `createdAt` (строго `< cursor`).
 * Каждый источник запрашивается на `limit + 1`, результаты сливаются,
 * сортируются desc и обрезаются до `limit`.
 */
export async function getWebappFeed(
  userId: string,
  query: FeedQuery = {}
): Promise<FeedPage> {
  const limit = clampLimit(query.limit);
  const cursor = parseDate(query.cursor);
  const cursorFilter = cursor ? { createdAt: { lt: cursor } } : {};

  const [personalRows, campaignRows, feedSeenAt] = await Promise.all([
    prisma.outgoingNotification.findMany({
      where: { userId, ...cursorFilter },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      select: {
        id: true,
        eventType: true,
        entityType: true,
        entityId: true,
        payload: true,
        readAt: true,
        createdAt: true,
        dedupKey: true,
      },
    }),
    prisma.broadcastCampaign.findMany({
      where: {
        segmentKey: PUBLIC_SEGMENT_KEY,
        status: { in: PUBLIC_CAMPAIGN_STATUSES },
        ...cursorFilter,
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      select: { id: true, eventType: true, payload: true, createdAt: true },
    }),
    getFeedSeenAt(userId),
  ]);

  const personal = collapseByDedupKey(personalRows as PersonalRow[]);
  const campaigns = campaignRows as CampaignRow[];
  const deliveredIds = await findDeliveredCampaignIds(
    userId,
    campaigns.map((campaign) => campaign.id)
  );

  const merged = [
    ...personal.map(toPersonalItem),
    ...campaigns
      .filter((campaign) => !deliveredIds.has(campaign.id))
      .map((campaign) => toCampaignItem(campaign, feedSeenAt)),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const page = merged.slice(0, limit);
  const hasMore =
    merged.length > limit ||
    personalRows.length > limit ||
    campaignRows.length > limit;

  return {
    items: page.map(serialize),
    nextCursor:
      hasMore && page.length > 0
        ? page[page.length - 1].createdAt.toISOString()
        : null,
    unreadCount: await countUnread(userId, feedSeenAt),
  };
}

// ── Отметка о прочтении ─────────────────────────────────────────────────────

function splitFeedIds(ids: string[]): {
  personalIds: string[];
  campaignIds: string[];
} {
  const personalIds: string[] = [];
  const campaignIds: string[] = [];

  for (const id of ids) {
    if (id.startsWith(PERSONAL_PREFIX)) {
      const raw = id.slice(PERSONAL_PREFIX.length);
      if (raw) personalIds.push(raw);
    } else if (id.startsWith(CAMPAIGN_PREFIX)) {
      const raw = id.slice(CAMPAIGN_PREFIX.length);
      if (raw) campaignIds.push(raw);
    }
    // id без известного префикса игнорируем: угадать источник нельзя.
  }

  return { personalIds, campaignIds };
}

/** Watermark двигается только вперёд — «перечитать» ленту назад нельзя. */
async function advanceFeedSeenAt(
  userId: string,
  candidate: Date | null
): Promise<Date | null> {
  const current = await getFeedSeenAt(userId);
  if (!candidate) return current;
  if (current && current >= candidate) return current;

  await prisma.notificationGlobalPreference.upsert({
    where: { userId },
    create: { userId, feedSeenAt: candidate },
    update: { feedSeenAt: candidate },
  });

  return candidate;
}

/**
 * Отметить прочитанным: персональные строки получают `readAt`, новости —
 * watermark `feedSeenAt` (у них нет персональной строки, ADR §9).
 *
 * Все записи строго ограничены `where.userId`: чужой id в `ids` не может
 * задеть чужую строку — он просто ничего не найдёт.
 */
export async function markFeedRead(
  userId: string,
  input: FeedReadInput
): Promise<FeedReadResult> {
  const now = new Date();
  const upTo = parseDate(input.upTo);
  const { personalIds, campaignIds } = splitFeedIds(input.ids ?? []);

  let updated = 0;

  if (personalIds.length > 0) {
    const result = await prisma.outgoingNotification.updateMany({
      where: { userId, id: { in: personalIds }, readAt: null },
      data: { readAt: now },
    });
    updated += result.count;
  }

  if (upTo) {
    const result = await prisma.outgoingNotification.updateMany({
      where: { userId, readAt: null, createdAt: { lte: upTo } },
      data: { readAt: now },
    });
    updated += result.count;
  }

  // Кандидат на watermark: явный upTo и/или самая свежая из отмеченных новостей.
  let watermark = upTo;
  if (campaignIds.length > 0) {
    const campaigns = await prisma.broadcastCampaign.findMany({
      where: { id: { in: campaignIds } },
      select: { createdAt: true },
    });
    for (const campaign of campaigns) {
      if (!watermark || campaign.createdAt > watermark) {
        watermark = campaign.createdAt;
      }
    }
  }

  const feedSeenAt = await advanceFeedSeenAt(userId, watermark);

  return {
    updated,
    feedSeenAt: feedSeenAt ? feedSeenAt.toISOString() : null,
    unreadCount: await countUnread(userId, feedSeenAt),
  };
}
