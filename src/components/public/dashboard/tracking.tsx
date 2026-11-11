"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Event =
  | "dashboard_view"
  | "dashboard_section_view"
  | "booking_details_open"
  | "booking_action_started"
  | "contact_link_started"
  | "feedback_open";
type Fields = {
  section?: "overview" | "bookings" | "orders" | "feedback" | "profile";
  action?: "cancel" | "reschedule" | "pay";
  channel?: "email" | "phone" | "telegram";
};
export function trackDashboard(event: Event, fields: Fields = {}) {
  void fetch("/api/profile/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, ...fields }),
    keepalive: true,
  }).catch(() => {});
}

export function DashboardTracking({
  section,
  detail = false,
}: {
  section: NonNullable<Fields["section"]>;
  detail?: boolean;
}) {
  const last = useRef("");
  useEffect(() => {
    const key = `${section}:${detail}`;
    if (last.current === key) return;
    last.current = key;
    trackDashboard(
      detail
        ? "booking_details_open"
        : section === "overview"
          ? "dashboard_view"
          : "dashboard_section_view",
      { section },
    );
  }, [section, detail]);
  return null;
}

export function TrackedDetails({
  title,
  children,
  feedback = false,
}: {
  title: ReactNode;
  children: ReactNode;
  feedback?: boolean;
}) {
  return (
    <details
      className="group rounded-2xl border border-zinc-200 bg-white"
      onToggle={(event) => {
        if (event.currentTarget.open && feedback)
          trackDashboard("feedback_open", { section: "feedback" });
      }}
    >
      <summary className="cursor-pointer rounded-2xl p-5 focus-visible:outline-2 focus-visible:outline-blue-600">
        {title}
        <span className="mt-3 block text-sm font-medium text-blue-700 group-open:hidden">
          Посмотреть подробности ↓
        </span>
        <span className="mt-3 hidden text-sm font-medium text-blue-700 group-open:block">
          Свернуть ↑
        </span>
      </summary>
      <div className="border-t border-zinc-100 p-5">{children}</div>
    </details>
  );
}
