"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTelegram } from "@/components/webapp/TelegramProvider";
import {
  Badge,
  Card,
  EmptyState,
  Icon,
  ListItem,
  SectionHeader,
  Skeleton,
} from "@/components/webapp/ui";
import { buildNavigation } from "@/lib/webapp/navigation";
import type { WebAppIconName } from "@/lib/webapp/icon-names";

/**
 * Главный экран Mini App (US-2, ADR §3.1).
 *
 * Лента вместо витрины-плаката: сверху — быстрые ссылки на разделы (AC-2.5),
 * дальше — что произошло по моим броням/заказам и новости парка. Состав ссылок
 * берётся из `buildNavigation`, поэтому карточки на несуществующий раздел
 * появиться не могут (AC-2.6).
 */

interface FeedAction {
  label: string;
  url: string;
}

interface FeedItem {
  id: string;
  kind: "personal" | "news";
  eventType: string;
  title: string;
  body: string;
  actions: FeedAction[];
  createdAt: string;
  readAt: string | null;
  moduleSlug: string | null;
}

interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
  unreadCount: number;
}

interface FeedReadResult {
  updated: number;
  feedSeenAt: string | null;
  unreadCount: number;
}

/** Быстрые ссылки — только те, что реально есть в навигации (AC-2.6). */
const QUICK_LINK_HREFS = ["/webapp/cafe", "/webapp/gazebos", "/webapp/ps-park"];

const PAGE_SIZE = 20;

const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** «только что» / «5 мин назад» / «3 ч назад» / «вчера» / «14 авг». */
function formatRelativeTime(iso: string, nowMs: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date(nowMs);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (days <= 0) {
    const minutes = Math.floor(Math.max(0, nowMs - date.getTime()) / 60_000);
    if (minutes < 1) return "только что";
    if (minutes < 60) return `${minutes} мин назад`;
    return `${Math.floor(minutes / 60)} ч назад`;
  }
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн назад`;
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

/** Новость и персональное событие различаются иконкой, а не эмодзи (AC-7.3). */
function iconForItem(item: FeedItem): WebAppIconName {
  if (item.kind === "news") return "news";
  if (item.eventType.startsWith("booking.")) return "calendar";
  if (item.eventType.startsWith("order.")) return "coffee";
  if (item.eventType.startsWith("payment.")) return "card";
  if (item.eventType.startsWith("messenger.")) return "bell";
  return "bell";
}

function openExternal(url: string): void {
  const webapp = typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
  if (webapp && typeof webapp.openLink === "function") {
    webapp.openLink(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function FeedSkeleton() {
  return (
    <div className="px-4 space-y-2">
      {[0, 1, 2].map((index) => (
        <Card key={index} className="p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-3/4 mt-2.5" />
          <Skeleton className="h-3 w-16 mt-3" />
        </Card>
      ))}
    </div>
  );
}

// Адрес и точка — из карточки организации на Яндекс Картах
// (https://yandex.ru/maps/org/145969813767/), как на публичных страницах
// сайта (src/app/page.tsx schema.org, ps-park). Не выдумывать руками.
const PARK_MAP_URL = "https://yandex.ru/maps/org/145969813767/";

function AboutPark() {
  return (
    <Card className="p-0">
      <button
        type="button"
        className="w-full p-4 text-left"
        onClick={() => openExternal(PARK_MAP_URL)}
      >
        <div className="flex gap-3 items-start">
          <span
            className="shrink-0 mt-0.5"
            style={{ color: "var(--tg-accent)" }}
          >
            <Icon name="map-pin" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Бизнес-парк «Деловой»</p>
            <p
              className="mt-1 text-[14px] leading-relaxed"
              style={{ color: "var(--tg-hint)" }}
            >
              Промышленная ул., 1, пгт Селятино, Московская область.
              <br />
              30 км от Москвы по Киевскому шоссе. Бесплатная парковка.
            </p>
            <p
              className="mt-1.5 text-[13px] font-medium"
              style={{ color: "var(--tg-link)" }}
            >
              Открыть на карте
            </p>
          </div>
          <span className="shrink-0 mt-1" style={{ color: "var(--tg-hint)" }}>
            <Icon name="chevron-right" size={18} />
          </span>
        </div>
      </button>
    </Card>
  );
}

function FeedCard({
  item,
  nowMs,
  onOpen,
}: {
  item: FeedItem;
  nowMs: number;
  onOpen: (item: FeedItem) => void;
}) {
  const unread = item.readAt === null;
  const action = item.actions[0];

  return (
    <Card>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="w-full text-left flex gap-3 px-4 py-3"
      >
        <span
          className="shrink-0 mt-0.5"
          style={{ color: unread ? "var(--tg-accent)" : "var(--tg-hint)" }}
        >
          <Icon name={iconForItem(item)} size={20} />
        </span>

        <span className="flex-1 min-w-0">
          <span className="flex items-start gap-2">
            <span className="flex-1 min-w-0 text-[15px] font-semibold leading-snug">
              {item.title}
            </span>
            {unread && (
              <span
                aria-label="Не прочитано"
                className="shrink-0 mt-1.5 w-2 h-2 rounded-full"
                style={{ background: "var(--tg-accent)" }}
              />
            )}
          </span>

          {item.body && (
            <span
              className="block mt-1 text-[14px] leading-relaxed"
              style={{ color: "var(--tg-subtitle)" }}
            >
              {item.body}
            </span>
          )}

          <span className="flex items-center gap-2 mt-2">
            <span className="text-[12px]" style={{ color: "var(--tg-hint)" }}>
              {formatRelativeTime(item.createdAt, nowMs)}
            </span>
            {item.kind === "news" && <Badge tone="neutral">Новости парка</Badge>}
            {action && (
              <span
                className="text-[12px] font-medium ml-auto"
                style={{ color: "var(--tg-link)" }}
              >
                {action.label}
              </span>
            )}
          </span>
        </span>
      </button>
    </Card>
  );
}

export default function WebAppHome() {
  const { ready, user, capabilities, apiFetch, haptic } = useTelegram();
  const router = useRouter();

  const [items, setItems] = useState<FeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  // Одна отсечка времени на рендер: относительные подписи не разъезжаются
  // между карточками. На сервере лента пуста, поэтому Date.now() не участвует
  // в SSR-разметке и рассинхрона гидрации не даёт.
  const nowMs = Date.now();

  const quickLinks = useMemo(() => {
    const { tabs } = buildNavigation(capabilities);
    return QUICK_LINK_HREFS.flatMap((href) => {
      const tab = tabs.find((candidate) => candidate.href === href);
      return tab ? [tab] : [];
    });
  }, [capabilities]);

  const loadFeed = useCallback(async () => {
    if (!ready) return;
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const page = await apiFetch<FeedPage>(`/api/webapp/feed?limit=${PAGE_SIZE}`);
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setUnreadCount(page.unreadCount);
      setFailed(false);
    } catch {
      setItems([]);
      setNextCursor(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [ready, user, apiFetch]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    haptic.impact("light");
    setLoadingMore(true);
    try {
      const page = await apiFetch<FeedPage>(
        `/api/webapp/feed?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`
      );
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
      setUnreadCount(page.unreadCount);
    } catch {
      setNextCursor(null);
    } finally {
      setLoadingMore(false);
    }
  };

  /** «Прочитать всё» — watermark по времени: и строки, и новости парка. */
  const markAllRead = async () => {
    haptic.impact("light");
    const upTo = new Date().toISOString();
    const snapshot = items;
    setItems((prev) => prev.map((item) => ({ ...item, readAt: item.readAt ?? upTo })));
    setUnreadCount(0);
    try {
      const result = await apiFetch<FeedReadResult>("/api/webapp/feed/read", {
        method: "POST",
        body: JSON.stringify({ upTo }),
      });
      setUnreadCount(result.unreadCount);
    } catch {
      // Откат оптимистичного состояния — иначе бейдж врёт до перезапуска.
      setItems(snapshot);
      haptic.notification("error");
      loadFeed();
    }
  };

  const openItem = (item: FeedItem) => {
    haptic.selection();

    if (item.readAt === null) {
      setItems((prev) =>
        prev.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, readAt: new Date().toISOString() }
            : candidate
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      apiFetch<FeedReadResult>("/api/webapp/feed/read", {
        method: "POST",
        body: JSON.stringify({ ids: [item.id] }),
      })
        .then((result) => setUnreadCount(result.unreadCount))
        .catch(() => {
          /* отметка о прочтении не критична — не мешаем переходу */
        });
    }

    const url = item.actions[0]?.url;
    if (!url) return;
    if (url.startsWith("/")) router.push(url);
    else openExternal(url);
  };

  const greeting = user?.name ? user.name.split(" ")[0] : "друг";

  return (
    <div className="tg-page-enter pb-4">
      <header className="px-4 pt-6 pb-1">
        {ready ? (
          <h1 className="text-[26px] font-bold leading-tight">
            Привет, {greeting}!
          </h1>
        ) : (
          <Skeleton className="h-7 w-40" />
        )}
        <p className="mt-1 text-[15px]" style={{ color: "var(--tg-hint)" }}>
          Бизнес-парк «Деловой» — Селятино
        </p>
      </header>

      {/* Быстрые ссылки на разделы — видное место, до ленты (AC-2.5) */}
      <nav className="px-4 mt-4" aria-label="Разделы">
        <div className="grid grid-cols-3 gap-2">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => haptic.impact("light")}
              className="block"
            >
              <Card className="h-full flex flex-col items-center gap-2 px-2 py-3">
                <span style={{ color: "var(--tg-accent)" }}>
                  <Icon name={link.icon} size={24} />
                </span>
                <span className="text-[13px] font-medium text-center leading-tight">
                  {link.label}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </nav>

      {/* Для сотрудника уведомления — главный инструмент: вход в Центр
          прямо на главной, а не только из Профиля. Гостю раздел не рендерится
          (AC-2.6); права всё равно перепроверяет сервер (loadWebAppStaff). */}
      {capabilities.canNotificationCenter && (
        <section className="mt-5" aria-label="Сотруднику">
          <SectionHeader>Сотруднику</SectionHeader>
          <div className="px-4">
            <Card className="p-0 overflow-hidden">
              <ListItem
                icon="bell"
                title="Центр уведомлений"
                subtitle="Какие события парка приходят лично вам"
                href="/webapp/notifications"
                chevron
                onClick={() => haptic.impact("light")}
              />
            </Card>
          </div>
        </section>
      )}

      <section className="mt-5">
        <div className="flex items-center justify-between">
          <SectionHeader>
            Лента{" "}
            {unreadCount > 0 && <Badge tone="accent">{unreadCount}</Badge>}
          </SectionHeader>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="px-4 py-2 text-[14px] font-medium"
              style={{ color: "var(--tg-link)" }}
            >
              Прочитать всё
            </button>
          )}
        </div>

        {loading || !ready ? (
          <FeedSkeleton />
        ) : items.length === 0 ? (
          <div className="px-4">
            <Card>
              <EmptyState
                icon={failed ? "alert" : "news"}
                title={failed ? "Лента недоступна" : "Пока новостей нет"}
                hint={
                  failed
                    ? "Не удалось загрузить уведомления. Потяните экран вниз или попробуйте позже."
                    : user
                      ? "Здесь появятся статусы броней и заказов, а также новости парка."
                      : "Откройте приложение из Telegram, чтобы видеть свои брони, заказы и новости парка."
                }
              />
            </Card>
          </div>
        ) : (
          <div className="px-4 space-y-2">
            {items.map((item) => (
              <FeedCard
                key={item.id}
                item={item}
                nowMs={nowMs}
                onOpen={openItem}
              />
            ))}

            {nextCursor && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full py-3 text-[15px] font-medium disabled:opacity-50"
                style={{ color: "var(--tg-link)" }}
              >
                {loadingMore ? "Загружаем…" : "Показать ещё"}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="mt-5">
        <SectionHeader>О парке</SectionHeader>
        <div className="px-4">
          <AboutPark />
        </div>
      </section>
    </div>
  );
}
