"use client";

import { useEffect, useState, useCallback } from "react";

type EventStatus = "active" | "unconfigured" | "disabled";

interface EventRoute {
  type: string;
  label: string;
  targets: { client: boolean; admin: boolean };
  category: string | null;
  status: EventStatus;
}

interface Source {
  moduleSlug: string;
  moduleName: string;
  isActive: boolean;
  events: EventRoute[];
}

interface RecipientInfo {
  type: "group" | "personal" | "users";
  label: string;
  chatId?: string | null;
  chatTitle?: string | null;
  connectedCount?: number;
  channelPriority?: string[];
  status: EventStatus;
}

interface RoutingMapData {
  summary: {
    total: number;
    active: number;
    unconfigured: number;
    disabled: number;
  };
  sources: Source[];
  recipients: {
    adminGroup: RecipientInfo;
    owner: RecipientInfo;
    clients: RecipientInfo;
  };
  bot: {
    username: string;
    tokenConfigured: boolean;
  };
}

const STATUS_COLOR: Record<EventStatus, string> = {
  active: "#22c55e",
  unconfigured: "#eab308",
  disabled: "#9ca3af",
};

const STATUS_LABEL: Record<EventStatus, string> = {
  active: "Работает",
  unconfigured: "Не настроен",
  disabled: "Выключено",
};

function StatusDot({ status }: { status: EventStatus }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full flex-shrink-0"
      style={{ background: STATUS_COLOR[status] }}
    />
  );
}

function SourceNode({ source, highlighted }: { source: Source; highlighted: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const worstStatus: EventStatus = source.events.some((e) => e.status === "unconfigured")
    ? "unconfigured"
    : source.events.every((e) => e.status === "disabled")
    ? "disabled"
    : "active";

  return (
    <div
      className={`rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
        highlighted ? "border-blue-300 bg-blue-50" : "border-zinc-200 bg-white"
      }`}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusDot status={worstStatus} />
          <span className="font-semibold text-sm text-zinc-800">{source.moduleName}</span>
        </div>
        <span className="text-xs text-zinc-400">{source.events.length} событий</span>
      </div>
      {expanded && (
        <div className="mt-3 space-y-1.5">
          {source.events.map((ev) => (
            <div key={ev.type} className="flex items-center gap-2 text-xs text-zinc-600">
              <StatusDot status={ev.status} />
              <span>{ev.label}</span>
              <span className="text-zinc-300 ml-auto">
                {ev.targets.client ? "→ клиент" : ""}
                {ev.targets.client && ev.targets.admin ? " + " : ""}
                {ev.targets.admin ? "→ группа" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BotNode({ bot }: { bot: RoutingMapData["bot"] }) {
  return (
    <div className="rounded-2xl border-2 border-blue-300 bg-blue-50 px-6 py-5 text-center shadow-sm">
      <div className="text-3xl mb-2">🤖</div>
      <p className="font-bold text-sm text-blue-900">@{bot.username}</p>
      <p className="text-xs mt-1" style={{ color: bot.tokenConfigured ? "#22c55e" : "#ef4444" }}>
        {bot.tokenConfigured ? "Токен настроен" : "Токен не настроен"}
      </p>
    </div>
  );
}

function RecipientNode({
  info,
  onClick,
  expanded,
}: {
  info: RecipientInfo;
  onClick: () => void;
  expanded: boolean;
}) {
  const icons: Record<string, string> = { group: "👥", personal: "👤", users: "💬" };

  return (
    <div
      className={`rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
        expanded ? "border-zinc-400 bg-zinc-50" : "border-zinc-200 bg-white"
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span>{icons[info.type]}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-zinc-800">{info.label}</span>
            <StatusDot status={info.status} />
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            {info.status === "unconfigured"
              ? "Не настроен"
              : info.type === "users"
              ? `${info.connectedCount ?? 0} пользователей с Telegram`
              : info.chatTitle || info.chatId || "Настроен"}
          </p>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 text-xs text-zinc-500 space-y-1 border-t border-zinc-100 pt-3">
          {info.chatId && (
            <p>
              Chat ID: <span className="font-mono text-zinc-700">{info.chatId}</span>
            </p>
          )}
          {info.chatTitle && <p>Группа: <span className="text-zinc-700">{info.chatTitle}</span></p>}
          {info.channelPriority && (
            <p>Каналы: <span className="text-zinc-700">{info.channelPriority.join(" → ")}</span></p>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryBanner({ summary }: { summary: RoutingMapData["summary"] }) {
  const hasIssues = summary.unconfigured > 0;
  return (
    <div
      className={`rounded-xl border px-5 py-4 flex items-center gap-4 flex-wrap ${
        hasIssues
          ? "border-yellow-300 bg-yellow-50"
          : "border-green-200 bg-green-50"
      }`}
    >
      <span className="text-xl">{hasIssues ? "⚠️" : "✅"}</span>
      <div className="flex gap-6 flex-wrap text-sm">
        <span>
          <span className="font-semibold text-green-700">{summary.active}</span>
          <span className="text-zinc-500"> активных</span>
        </span>
        {summary.unconfigured > 0 && (
          <span>
            <span className="font-semibold text-yellow-600">{summary.unconfigured}</span>
            <span className="text-zinc-500"> не настроено</span>
          </span>
        )}
        {summary.disabled > 0 && (
          <span>
            <span className="font-semibold text-zinc-400">{summary.disabled}</span>
            <span className="text-zinc-500"> выключено</span>
          </span>
        )}
        <span className="text-zinc-400">из {summary.total} маршрутов</span>
      </div>
    </div>
  );
}

export function NotificationFlowMap() {
  const [data, setData] = useState<RoutingMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRecipient, setExpandedRecipient] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications/routing-map");
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-100" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-zinc-400">
        Не удалось загрузить карту уведомлений
      </div>
    );
  }

  // Group sources by which recipients they send to
  const adminSources = data.sources.filter((s) =>
    s.events.some((e) => e.targets.admin)
  );
  const clientSources = data.sources.filter((s) =>
    s.events.some((e) => e.targets.client)
  );

  return (
    <div className="space-y-6">
      <SummaryBanner summary={data.summary} />

      {/* Three-column flow diagram */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Карта маршрутизации</h2>
            <p className="text-sm text-zinc-500">Нажмите на модуль или получателя для деталей</p>
          </div>
          <button
            onClick={load}
            className="text-xs text-zinc-400 hover:text-zinc-600 border border-zinc-200 rounded-lg px-3 py-1.5"
          >
            Обновить
          </button>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start">
          {/* Left column: Sources */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
              Источники событий
            </p>
            {data.sources.map((source) => (
              <SourceNode
                key={source.moduleSlug}
                source={source}
                highlighted={false}
              />
            ))}
          </div>

          {/* Center column: Bot + arrows */}
          <div className="flex flex-col items-center pt-8">
            <BotNode bot={data.bot} />
            {/* Visual connector lines */}
            <div className="mt-3 flex flex-col items-center gap-1 text-zinc-300 text-lg">
              <span>↕</span>
              <span className="text-xs text-zinc-400">маршруты</span>
            </div>
          </div>

          {/* Right column: Recipients */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
              Получатели
            </p>
            <RecipientNode
              info={data.recipients.adminGroup}
              expanded={expandedRecipient === "adminGroup"}
              onClick={() =>
                setExpandedRecipient((v) => (v === "adminGroup" ? null : "adminGroup"))
              }
            />
            <RecipientNode
              info={data.recipients.owner}
              expanded={expandedRecipient === "owner"}
              onClick={() =>
                setExpandedRecipient((v) => (v === "owner" ? null : "owner"))
              }
            />
            <RecipientNode
              info={data.recipients.clients}
              expanded={expandedRecipient === "clients"}
              onClick={() =>
                setExpandedRecipient((v) => (v === "clients" ? null : "clients"))
              }
            />
          </div>
        </div>

        {/* Legend */}
        <div className="mt-6 border-t border-zinc-100 pt-4 flex items-center gap-6 text-xs text-zinc-500">
          {(Object.entries(STATUS_COLOR) as [EventStatus, string][]).map(([status, color]) => (
            <span key={status} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: color }}
              />
              {STATUS_LABEL[status]}
            </span>
          ))}
        </div>
      </div>

      {/* Flows breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h3 className="font-semibold text-sm text-zinc-700 mb-3">→ Группа / Владелец</h3>
          <div className="space-y-2">
            {adminSources.map((s) =>
              s.events
                .filter((e) => e.targets.admin)
                .map((ev) => (
                  <div key={`${s.moduleSlug}-${ev.type}`} className="flex items-center gap-2 text-sm">
                    <StatusDot status={ev.status} />
                    <span className="text-zinc-500 text-xs">{s.moduleName}</span>
                    <span className="text-zinc-400">›</span>
                    <span>{ev.label}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h3 className="font-semibold text-sm text-zinc-700 mb-3">→ Клиентам</h3>
          <div className="space-y-2">
            {clientSources.map((s) =>
              s.events
                .filter((e) => e.targets.client)
                .map((ev) => (
                  <div key={`${s.moduleSlug}-${ev.type}`} className="flex items-center gap-2 text-sm">
                    <StatusDot status={ev.status} />
                    <span className="text-zinc-500 text-xs">{s.moduleName}</span>
                    <span className="text-zinc-400">›</span>
                    <span>{ev.label}</span>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
