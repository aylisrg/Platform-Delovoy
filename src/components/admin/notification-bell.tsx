"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type AdminEvent = {
  id: string;
  type: string;
  moduleSlug: string;
  entityId: string;
  title: string;
  body: string;
  timestamp: string;
};

const MODULE_LABELS: Record<string, string> = {
  gazebos: "Беседки",
  "ps-park": "PS Park",
  cafe: "Кафе",
  rental: "Аренда",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин. назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч. назад`;
  return `${Math.floor(hours / 24)} дн. назад`;
}

export function NotificationBell() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [permissionState, setPermissionState] = useState<NotificationPermission>("default");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastReadRef = useRef<string | null>(null);

  // Request browser notification permission
  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermissionState(result);
  }, []);

  // Show browser notification
  const showBrowserNotification = useCallback((event: AdminEvent) => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    const notification = new Notification(event.title, {
      body: event.body,
      icon: "/icon-192.png",
      tag: event.id,
      requireInteraction: false,
    });

    notification.onclick = () => {
      window.focus();
      setOpen(true);
      notification.close();
    };
  }, []);

  // SSE connection
  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setPermissionState(Notification.permission);
    }

    // Load last read timestamp from localStorage
    lastReadRef.current = localStorage.getItem("admin-notif-last-read");

    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      eventSource = new EventSource("/api/admin/events/stream");

      eventSource.onmessage = (msg) => {
        try {
          const event: AdminEvent = JSON.parse(msg.data);
          setEvents((prev) => [event, ...prev].slice(0, 100));
          setUnreadCount((prev) => prev + 1);
          showBrowserNotification(event);
        } catch {
          // Ignore parse errors (keepalive, etc.)
        }
      };

      eventSource.onerror = () => {
        eventSource?.close();
        // Reconnect after 5 seconds
        reconnectTimeout = setTimeout(connect, 5_000);
      };
    }

    connect();

    return () => {
      eventSource?.close();
      clearTimeout(reconnectTimeout);
    };
  }, [showBrowserNotification]);

  // Load recent notifications on mount
  useEffect(() => {
    fetch("/api/admin/notifications")
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          const mapped: AdminEvent[] = res.data.map((n: {
            id: string;
            eventType: string;
            moduleSlug: string;
            entityId: string | null;
            message: string;
            createdAt: string;
          }) => ({
            id: n.id,
            type: n.eventType,
            moduleSlug: n.moduleSlug,
            entityId: n.entityId || "",
            title: formatEventTitle(n.eventType, n.moduleSlug),
            body: n.message.replace(/<[^>]+>/g, "").substring(0, 120),
            timestamp: n.createdAt,
          }));
          setEvents(mapped);

          // Count unread based on localStorage timestamp
          const lastRead = localStorage.getItem("admin-notif-last-read");
          if (lastRead) {
            const unread = mapped.filter(
              (e: AdminEvent) => new Date(e.timestamp) > new Date(lastRead)
            ).length;
            setUnreadCount(unread);
          } else {
            setUnreadCount(mapped.length > 0 ? mapped.length : 0);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleBellClick() {
    if (!open) {
      // Mark all as read
      setUnreadCount(0);
      localStorage.setItem("admin-notif-last-read", new Date().toISOString());
    }
    setOpen(!open);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={handleBellClick}
        className="relative rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
        aria-label="Уведомления"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-96 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-zinc-900">Уведомления</h3>
            {permissionState !== "granted" && typeof Notification !== "undefined" && (
              <button
                onClick={requestPermission}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Включить push
              </button>
            )}
          </div>

          {/* Event list */}
          <div className="max-h-96 overflow-y-auto">
            {events.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-zinc-400">
                Нет уведомлений
              </div>
            ) : (
              events.map((event) => (
                <div
                  key={event.id}
                  className="border-b border-zinc-50 px-4 py-3 transition-colors hover:bg-zinc-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${getEventColor(event.type)}`} />
                        <span className="text-xs font-medium text-zinc-700">
                          {event.title}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        {event.body}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="whitespace-nowrap text-[10px] text-zinc-400">
                        {timeAgo(event.timestamp)}
                      </span>
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
                        {MODULE_LABELS[event.moduleSlug] || event.moduleSlug}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatEventTitle(eventType: string, moduleSlug: string): string {
  const moduleLabel = MODULE_LABELS[moduleSlug] || moduleSlug;
  const titles: Record<string, string> = {
    "booking.created": `Новое бронирование — ${moduleLabel}`,
    "booking.cancelled": `Отмена брони — ${moduleLabel}`,
    "order.placed": `Новый заказ — ${moduleLabel}`,
    "order.cancelled": `Заказ отменён — ${moduleLabel}`,
    "contract.expiring": "Истекает договор",
    "inquiry.created": "Новая заявка на аренду",
  };
  return titles[eventType] || eventType;
}

function getEventColor(type: string): string {
  if (type.includes("created") || type.includes("placed")) return "bg-green-500";
  if (type.includes("cancelled")) return "bg-red-500";
  if (type.includes("expiring")) return "bg-amber-500";
  return "bg-blue-500";
}
