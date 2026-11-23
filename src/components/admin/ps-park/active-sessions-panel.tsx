"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ActiveSession } from "@/modules/ps-park/types";
import { ActiveSessionCard } from "./active-session-card";
import { playSessionEndingAlert } from "@/lib/sound";

type ActiveSessionsPanelProps = {
  initialSessions: ActiveSession[];
};

export function ActiveSessionsPanel({
  initialSessions,
}: ActiveSessionsPanelProps) {
  const [sessions, setSessions] = useState(initialSessions);
  const alertedRef = useRef<Set<string>>(new Set());

  const checkSessionAlerts = useCallback((sessionList: ActiveSession[]) => {
    const now = Date.now();

    for (const session of sessionList) {
      const alertKey = `${session.bookingId}:${session.endTime}`;
      if (alertedRef.current.has(alertKey)) continue;

      const endMs = new Date(session.endTime).getTime();
      const remaining = Math.ceil((endMs - now) / 60_000);

      if (remaining > 0 && remaining <= session.alertMinutes) {
        alertedRef.current.add(alertKey);

        playSessionEndingAlert();
      }
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/ps-park/active-sessions");
      const data = await res.json();
      if (data.success) {
        setSessions(data.data);
        checkSessionAlerts(data.data);
      }
    } catch {
      // keep old data on failure
    }
  }, [checkSessionAlerts]);

  // Check alerts for initial sessions on mount
  useEffect(() => {
    checkSessionAlerts(initialSessions);
  }, [initialSessions, checkSessionAlerts]);

  useEffect(() => {
    const interval = setInterval(fetchSessions, 30_000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  if (sessions.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        <h2 className="text-sm font-semibold text-zinc-900">
          Сейчас играют
        </h2>
        <span className="text-xs text-zinc-400">
          {sessions.length} {sessions.length === 1 ? "сессия" : sessions.length < 5 ? "сессии" : "сессий"}
        </span>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {sessions.map((s) => (
          <ActiveSessionCard
            key={s.bookingId}
            session={s}
            onUpdate={fetchSessions}
          />
        ))}
      </div>
    </div>
  );
}
