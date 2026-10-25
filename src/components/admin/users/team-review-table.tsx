"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TeamFlag, TeamOverviewRow } from "@/modules/users/team";
import { BotStatusBadge } from "./bot-status-badge";
import { ExcludeDialog } from "./exclude-dialog";
import { MergeRequestsPanel } from "./merge-requests-panel";
import { MergeWizard } from "./merge-wizard";
import { PermissionsModal } from "./permissions-modal";
import { ResetPasswordModal } from "./users-list";

/**
 * Таб «Команда» как экран ревью (US-B2, ADR 2026-10-25 §7): права, каналы,
 * статус бота и подписки всей команды с одного экрана, флаги проблем и
 * фильтры. Всё про уведомления считает тот же резолвер, что рассылка.
 */

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: "Суперадмин",
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
};

const ROLE_TONE: Record<string, string> = {
  SUPERADMIN: "bg-red-50 text-red-700",
  ADMIN: "bg-rose-50 text-rose-700",
  MANAGER: "bg-amber-50 text-amber-700",
};

export const FLAG_LABELS: Record<TeamFlag, string> = {
  NO_WORKING_CHANNEL: "Нет рабочего канала",
  BOT_NOT_STARTED: "Бот не запущен",
  BOT_BLOCKED: "Бот заблокирован",
  STALE_LOGIN: "Давно не заходил",
  NO_SECTIONS: "Нет разделов",
};

type Filters = {
  role: "" | "SUPERADMIN" | "ADMIN" | "MANAGER";
  problems: boolean;
  bot: "" | "not_started" | "blocked";
  noTelegram: boolean;
  sort: "name" | "lastLogin";
};

const EMPTY_FILTERS: Filters = { role: "", problems: false, bot: "", noTelegram: false, sort: "name" };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
}

function Check({ ok, title }: { ok: boolean; title: string }) {
  return (
    <span title={title} className={ok ? "text-emerald-600" : "text-zinc-300"} aria-label={`${title}: ${ok ? "есть" : "нет"}`}>
      {ok ? "✓" : "—"}
    </span>
  );
}

export function TeamReviewTable({ reloadKey = 0 }: { reloadKey?: number }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<TeamOverviewRow[]>([]);
  const [pendingMergeRequests, setPendingMergeRequests] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingRelease, setTogglingRelease] = useState<string | null>(null);
  const [permissionsUser, setPermissionsUser] = useState<TeamOverviewRow | null>(null);
  const [passwordUser, setPasswordUser] = useState<TeamOverviewRow | null>(null);
  const [excludeUser, setExcludeUser] = useState<TeamOverviewRow | null>(null);
  const [merge, setMerge] = useState<{ userAId?: string; userBId?: string; mergeRequestId?: string } | null>(null);
  const [mergeKey, setMergeKey] = useState(0);
  // Only the latest request may update the table — fast filter changes race.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    const params = new URLSearchParams();
    if (filters.role) params.set("role", filters.role);
    if (filters.problems) params.set("problems", "true");
    if (filters.bot) params.set("bot", filters.bot);
    if (filters.noTelegram) params.set("noTelegram", "true");
    params.set("sort", filters.sort);
    try {
      const res = await fetch(`/api/users/team?${params.toString()}`);
      const body = await res.json();
      if (seq !== requestSeq.current) return;
      if (body.success) {
        setRows(body.data.rows);
        setPendingMergeRequests(body.data.pendingMergeRequests);
        setError(null);
      } else {
        setError(body.error?.message ?? "Не удалось загрузить команду");
      }
    } catch {
      if (seq === requestSeq.current) setError("Ошибка сети");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  async function toggleReleases(row: TeamOverviewRow) {
    setTogglingRelease(row.id);
    try {
      const res = await fetch(`/api/users/${row.id}/notifications`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: "system.release", enabled: !row.releases, source: "team" }),
      });
      const body = await res.json();
      if (body.success) await load();
      else setError(body.error?.message ?? "Не удалось изменить подписку");
    } catch {
      setError("Ошибка сети");
    } finally {
      setTogglingRelease(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm">
        <select
          aria-label="Роль"
          className="rounded-lg border border-zinc-200 px-2 py-1.5"
          value={filters.role}
          onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value as Filters["role"] }))}
        >
          <option value="">Все роли</option>
          <option value="SUPERADMIN">Суперадмины</option>
          <option value="ADMIN">Администраторы</option>
          <option value="MANAGER">Менеджеры</option>
        </select>
        <select
          aria-label="Статус бота"
          className="rounded-lg border border-zinc-200 px-2 py-1.5"
          value={filters.bot}
          onChange={(e) => setFilters((f) => ({ ...f, bot: e.target.value as Filters["bot"] }))}
        >
          <option value="">Бот: любой</option>
          <option value="not_started">Бот не запущен</option>
          <option value="blocked">Бот заблокирован</option>
        </select>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={filters.problems}
            onChange={(e) => setFilters((f) => ({ ...f, problems: e.target.checked }))}
          />
          Есть проблемы
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={filters.noTelegram}
            onChange={(e) => setFilters((f) => ({ ...f, noTelegram: e.target.checked }))}
          />
          Без Telegram
        </label>
        <button
          type="button"
          className="ml-auto rounded-lg border border-zinc-200 px-3 py-1.5 text-zinc-700 hover:bg-zinc-50"
          onClick={() => setMerge({})}
        >
          Объединить аккаунты
        </button>
        <select
          aria-label="Сортировка"
          className="rounded-lg border border-zinc-200 px-2 py-1.5"
          value={filters.sort}
          onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as Filters["sort"] }))}
        >
          <option value="name">По роли и имени</option>
          <option value="lastLogin">По последнему входу</option>
        </select>
      </div>

      {pendingMergeRequests > 0 && <MergeRequestsPanel key={mergeKey} onMerge={(pair) => setMerge(pair)} />}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        {loading ? (
          <div className="p-6 text-sm text-zinc-400">Загрузка...</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-zinc-400">Никого не найдено</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3">Сотрудник</th>
                <th className="px-2 py-3 text-center">Email</th>
                <th className="px-2 py-3 text-center">Telegram</th>
                <th className="px-2 py-3">Бот</th>
                <th className="px-2 py-3">Разделы</th>
                <th className="px-2 py-3">Модули</th>
                <th className="px-2 py-3">Подписки</th>
                <th className="px-2 py-3">Релизы</th>
                <th className="px-2 py-3">Последний вход</th>
                <th className="px-4 py-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${row.id}`} className="font-medium text-zinc-900 hover:text-blue-600">
                      {row.name || row.email || "Без имени"}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${ROLE_TONE[row.role]}`}>{ROLE_LABEL[row.role]}</span>
                      {row.flags.map((flag) => (
                        <span key={flag} className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                          {FLAG_LABELS[flag]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-center">
                    <Check ok={Boolean(row.email)} title={row.emailVerified ? "Email подтверждён" : "Email"} />
                  </td>
                  <td className="px-2 py-3 text-center">
                    <Check ok={row.hasTelegram} title="Telegram" />
                  </td>
                  <td className="px-2 py-3">
                    <BotStatusBadge status={row.botStatus} />
                  </td>
                  <td className="px-2 py-3">
                    <details>
                      <summary className="cursor-pointer text-zinc-700">{row.sections.length}</summary>
                      <ul className="mt-1 space-y-0.5 text-xs text-zinc-500">
                        {row.sections.map((s) => (
                          <li key={s.slug}>
                            {s.label}
                            {s.source === "role" ? " · по роли" : s.source === "strict_grant" ? " · особый доступ" : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  <td className="px-2 py-3 text-xs text-zinc-600">
                    {row.modules.length ? row.modules.map((m) => m.name).join(", ") : "—"}
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap text-zinc-700">
                    {row.subscriptions.active} из {row.subscriptions.available}
                  </td>
                  <td className="px-2 py-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.releases}
                      aria-label={`Релизы: ${row.name ?? row.id}`}
                      disabled={togglingRelease === row.id}
                      onClick={() => void toggleReleases(row)}
                      className={`h-5 w-9 rounded-full transition-colors ${row.releases ? "bg-emerald-500" : "bg-zinc-300"} disabled:opacity-50`}
                    >
                      <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${row.releases ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap text-zinc-600">{formatDate(row.lastLoginAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2 whitespace-nowrap">
                      <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setPermissionsUser(row)}>
                        Права
                      </button>
                      {row.email && (
                        <button type="button" className="text-xs text-zinc-600 hover:underline" onClick={() => setPasswordUser(row)}>
                          Пароль
                        </button>
                      )}
                      <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setExcludeUser(row)}>
                        Исключить из команды
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {permissionsUser && (
        <PermissionsModal
          userId={permissionsUser.id}
          userName={permissionsUser.name}
          userRole={permissionsUser.role}
          onClose={() => setPermissionsUser(null)}
          onSaved={() => {
            setPermissionsUser(null);
            void load();
          }}
        />
      )}
      {passwordUser && (
        <ResetPasswordModal
          userId={passwordUser.id}
          userName={passwordUser.name}
          userEmail={passwordUser.email}
          onClose={() => setPasswordUser(null)}
        />
      )}
      <MergeWizard
        open={merge !== null}
        initialUserId={merge?.userAId}
        initialSecondaryId={merge?.userBId}
        mergeRequestId={merge?.mergeRequestId}
        onClose={() => setMerge(null)}
        onMerged={() => {
          setMerge(null);
          setMergeKey((k) => k + 1);
          void load();
        }}
      />
      {excludeUser && (
        <ExcludeDialog
          userId={excludeUser.id}
          userName={excludeUser.name}
          onClose={() => setExcludeUser(null)}
          onExcluded={() => {
            setExcludeUser(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
