"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { MatrixCell, NotificationMatrix } from "@/modules/notifications/matrix";
import type { ExplainStatus } from "@/modules/notifications/explain";

/**
 * Матрица «сотрудники × события» (US-C4): за минуты видно события, которых
 * никто не получает, и людей, получающих лишнее. Клик по ячейке — тот же
 * тумблер, что на странице сотрудника (AC-C4.5).
 */

const CELL: Record<ExplainStatus, { symbol: string; tone: string; label: string }> = {
  RECEIVES: { symbol: "●", tone: "text-emerald-600", label: "Получает" },
  BLOCKED: { symbol: "◐", tone: "text-amber-600", label: "Подписан, но не дойдёт" },
  NOT_RECEIVING: { symbol: "○", tone: "text-zinc-400", label: "Не получает" },
  NO_ACCESS: { symbol: "·", tone: "text-zinc-300", label: "Нет доступа" },
};

const ROLE_LABEL: Record<string, string> = { SUPERADMIN: "Суперадмин", ADMIN: "Администратор", MANAGER: "Менеджер" };

export function MatrixTable() {
  const [data, setData] = useState<NotificationMatrix | null>(null);
  const [category, setCategory] = useState("");
  const [role, setRole] = useState("");
  const [problems, setProblems] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (role) params.set("role", role);
    if (problems) params.set("problems", "true");
    try {
      const res = await fetch(`/api/admin/notifications/matrix?${params.toString()}`);
      const body = await res.json();
      if (body.success) {
        setData(body.data);
        setError(null);
      } else setError(body.error?.message ?? "Не удалось загрузить матрицу");
    } catch {
      setError("Ошибка сети");
    }
  }, [category, role, problems]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(userId: string, eventType: string, cell: MatrixCell) {
    if (!cell.editable || saving) return;
    setSaving(`${userId}:${eventType}`);
    try {
      const res = await fetch(`/api/users/${userId}/notifications`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType, enabled: !cell.enabled, source: "matrix" }),
      });
      const body = await res.json();
      // Reload only on success: a successful load clears the error banner.
      if (body.success) await load();
      else setError(body.error?.message ?? "Не удалось сохранить");
    } catch {
      setError("Ошибка сети");
    } finally {
      setSaving(null);
    }
  }

  const categories = data ? [...new Map(data.events.map((e) => [e.categoryKey, e.categoryLabel])).entries()] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm">
        <select aria-label="Категория" className="rounded-lg border border-zinc-200 px-2 py-1.5" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Все категории</option>
          {categories.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Роль" className="rounded-lg border border-zinc-200 px-2 py-1.5" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Все роли</option>
          <option value="SUPERADMIN">Суперадмины</option>
          <option value="ADMIN">Администраторы</option>
          <option value="MANAGER">Менеджеры</option>
        </select>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={problems} onChange={(e) => setProblems(e.target.checked)} />
          Только проблемы
        </label>
        <span className="ml-auto text-xs text-zinc-500">
          {Object.values(CELL).map((c) => (
            <span key={c.label} className="ml-3 whitespace-nowrap">
              <span className={c.tone}>{c.symbol}</span> {c.label}
            </span>
          ))}
        </span>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {!data ? (
        <div className="text-sm text-zinc-400">Загрузка...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="sticky left-0 bg-zinc-50 px-4 py-3 text-left">Сотрудник</th>
                {data.events.map((e) => (
                  <th key={e.eventType} className="px-2 py-3 text-center font-normal" title={e.categoryLabel}>
                    <div className="w-24">{e.label}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {data.rows.map((row) => (
                <tr key={row.user.id}>
                  <td className="sticky left-0 bg-white px-4 py-2 whitespace-nowrap">
                    <Link href={`/admin/users/${row.user.id}`} className="text-zinc-900 hover:text-blue-600">
                      {row.user.name ?? "Без имени"}
                    </Link>
                    <span className="ml-2 text-xs text-zinc-400">{ROLE_LABEL[row.user.role] ?? row.user.role}</span>
                  </td>
                  {data.events.map((e) => {
                    const cell = row.cells[e.eventType];
                    if (!cell) return <td key={e.eventType} />;
                    const look = CELL[cell.status];
                    return (
                      <td key={e.eventType} className="px-2 py-2 text-center">
                        <button
                          type="button"
                          className={`text-lg leading-none ${look.tone} disabled:cursor-default`}
                          title={cell.reason ? `${look.label}: ${cell.reason}` : look.label}
                          aria-label={`${row.user.name ?? row.user.id} — ${e.label}: ${look.label}`}
                          disabled={!cell.editable || saving !== null}
                          onClick={() => void toggle(row.user.id, e.eventType, cell)}
                        >
                          {look.symbol}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-zinc-50 text-xs">
                <td className="sticky left-0 bg-zinc-50 px-4 py-2 font-medium text-zinc-600">Получателей лично</td>
                {data.events.map((e) => {
                  const total = data.totals[e.eventType];
                  const nobody = total && total.personalRecipients === 0;
                  return (
                    <td
                      key={e.eventType}
                      className={`px-2 py-2 text-center ${nobody ? "font-medium text-red-600" : "text-zinc-600"}`}
                      title={nobody ? (total.groupChatOnly ? "Лично не получает никто — только общий чат" : "Лично не получает никто") : undefined}
                    >
                      {total?.personalRecipients ?? 0}
                      {nobody && <div className="text-[10px] leading-tight">{total.groupChatOnly ? "только общий чат" : "никто"}</div>}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
