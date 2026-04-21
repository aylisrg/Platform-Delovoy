"use client";

import { useState } from "react";
import type { BackupListItem } from "@/modules/backups/types";

type RestoreScope = "full" | "table" | "record";

type Props = {
  items: BackupListItem[];
  total: number;
};

/**
 * Клиентский компонент списка бекапов + модалка запуска restore.
 * По умолчанию в UI доступны только `scope=record` и `scope=table` с dryRun=true.
 * Full restore — сознательно только через CLI runbook (docs/runbooks/restore-backup.md).
 */
export function BackupsList({ items, total }: Props) {
  const [restoreTarget, setRestoreTarget] = useState<BackupListItem | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>Всего: {total}</span>
      </div>

      <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr className="text-left text-xs text-zinc-500">
              <th className="px-3 py-2 font-medium">Дата</th>
              <th className="px-3 py-2 font-medium">Тип</th>
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2 font-medium">Размер</th>
              <th className="px-3 py-2 font-medium">Длительность</th>
              <th className="px-3 py-2 font-medium">Путь</th>
              <th className="px-3 py-2 font-medium">Кто</th>
              <th className="px-3 py-2 font-medium text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-sm text-zinc-400"
                >
                  Бекапов ещё нет — дождитесь cron в 02:00 MSK или запустите вручную.
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-zinc-50 align-top hover:bg-zinc-50/50"
                >
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-zinc-600">
                    {new Date(row.createdAt).toLocaleString("ru-RU")}
                  </td>
                  <td className="px-3 py-2 text-zinc-700">
                    <span className="font-mono text-xs">{row.type}</span>
                    {row.migrationTag && (
                      <span className="ml-2 text-[10px] text-zinc-400">
                        {row.migrationTag}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2 text-zinc-700">
                    {row.sizeMb !== null ? `${row.sizeMb} МБ` : "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">
                    {row.durationMs !== null
                      ? `${Math.round(row.durationMs / 1000)}с`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 max-w-[320px] truncate font-mono text-[11px] text-zinc-500">
                    {row.storagePath ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {row.performedByName ?? "system"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.status === "SUCCESS" && row.type !== "RESTORE" ? (
                      <button
                        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                        onClick={() => setRestoreTarget(row)}
                      >
                        Восстановить
                      </button>
                    ) : (
                      <span className="text-[11px] text-zinc-300">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {restoreTarget && (
        <RestoreModal
          backup={restoreTarget}
          onClose={() => setRestoreTarget(null)}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: BackupListItem["status"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    IN_PROGRESS: {
      label: "Выполняется",
      cls: "bg-blue-50 text-blue-700 border-blue-200",
    },
    SUCCESS: {
      label: "Успех",
      cls: "bg-green-50 text-green-700 border-green-200",
    },
    FAILED: {
      label: "Упал",
      cls: "bg-red-50 text-red-700 border-red-200",
    },
    PARTIAL: {
      label: "Частично",
      cls: "bg-yellow-50 text-yellow-700 border-yellow-200",
    },
  };
  const e = map[status] ?? map.IN_PROGRESS;
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${e.cls}`}
    >
      {e.label}
    </span>
  );
}

type RestoreModalProps = {
  backup: BackupListItem;
  onClose: () => void;
};

function RestoreModal({ backup, onClose }: RestoreModalProps) {
  const [scope, setScope] = useState<RestoreScope>("record");
  const [table, setTable] = useState<string>("");
  const [primaryKeyJson, setPrimaryKeyJson] = useState<string>('{"id":""}');
  const [truncateBefore, setTruncateBefore] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      // 1. Получаем confirmToken
      const tokenRes = await fetch("/api/admin/backups/restore", {
        method: "GET",
      });
      if (!tokenRes.ok) {
        throw new Error(`Не удалось получить токен (${tokenRes.status})`);
      }
      const tokenData = await tokenRes.json();
      const confirmToken = tokenData?.data?.confirmToken as string;
      if (!confirmToken) throw new Error("Сервер не вернул confirmToken");

      // 2. Собираем body
      let target: unknown = undefined;
      if (scope === "table") {
        if (!table.trim()) throw new Error("Укажите имя таблицы");
        target = { scope: "table", table: table.trim(), truncateBefore };
      } else if (scope === "record") {
        if (!table.trim()) throw new Error("Укажите имя таблицы");
        let pk: Record<string, unknown>;
        try {
          pk = JSON.parse(primaryKeyJson);
        } catch {
          throw new Error("primaryKey должен быть JSON-объектом");
        }
        target = {
          scope: "record",
          table: table.trim(),
          primaryKey: pk,
        };
      }

      const postRes = await fetch("/api/admin/backups/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backupId: backup.id,
          scope,
          target,
          dryRun,
          confirmToken,
        }),
      });
      const body = await postRes.json();
      if (!postRes.ok || !body.success) {
        throw new Error(
          body?.error?.message ?? `Сервер вернул ${postRes.status}`
        );
      }
      setResult(JSON.stringify(body.data, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-200 px-5 py-3">
          <h3 className="font-semibold text-zinc-900">
            Восстановление из бекапа
          </h3>
          <p className="text-xs text-zinc-500">
            {backup.type} от {new Date(backup.createdAt).toLocaleString("ru-RU")}
            {backup.sizeMb !== null ? ` · ${backup.sizeMb} МБ` : ""}
          </p>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">
              Scope
            </label>
            <div className="flex gap-2">
              {(["record", "table"] as RestoreScope[]).map((s) => (
                <label
                  key={s}
                  className={`flex items-center gap-1 rounded border px-2 py-1 text-xs cursor-pointer ${
                    scope === s
                      ? "bg-blue-50 border-blue-300 text-blue-700"
                      : "border-zinc-300 text-zinc-600"
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    checked={scope === s}
                    onChange={() => setScope(s)}
                  />
                  {s === "record" ? "Одна запись" : "Таблица"}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-zinc-400">
              Full restore — только через CLI, см.{" "}
              <code>docs/runbooks/restore-backup.md</code>
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">
              Таблица
            </label>
            <input
              type="text"
              value={table}
              onChange={(e) => setTable(e.target.value)}
              placeholder="Booking, Order, MenuItem, …"
              className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
            />
          </div>

          {scope === "record" && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">
                Primary key (JSON)
              </label>
              <textarea
                rows={3}
                value={primaryKeyJson}
                onChange={(e) => setPrimaryKeyJson(e.target.value)}
                className="w-full rounded border border-zinc-300 px-2 py-1 font-mono text-xs"
              />
            </div>
          )}

          {scope === "table" && (
            <label className="flex items-center gap-2 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={truncateBefore}
                onChange={(e) => setTruncateBefore(e.target.checked)}
              />
              TRUNCATE перед восстановлением (опасно — учитывайте FK)
            </label>
          )}

          <label className="flex items-center gap-2 text-xs text-zinc-700 border-t border-zinc-100 pt-3">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            Dry-run (ничего не меняет — только отчёт){" "}
            <span className="text-zinc-400">рекомендуется первый раз</span>
          </label>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 whitespace-pre-wrap">
              {error}
            </div>
          )}
          {result && (
            <pre className="max-h-40 overflow-auto rounded border border-green-200 bg-green-50 px-3 py-2 text-[11px] text-green-800">
              {result}
            </pre>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3">
          <button
            className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
            onClick={onClose}
          >
            Закрыть
          </button>
          <button
            disabled={busy}
            className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            onClick={run}
          >
            {busy
              ? "Выполняется…"
              : dryRun
              ? "Проверить (dry-run)"
              : "Восстановить"}
          </button>
        </div>
      </div>
    </div>
  );
}
