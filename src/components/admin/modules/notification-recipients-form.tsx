"use client";

import { useState, useTransition } from "react";
import type { RecipientInfo } from "@/modules/notifications/recipients";

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: "Суперадмин",
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
};

export function NotificationRecipientsForm({
  slug,
  recipients,
}: {
  slug: string;
  recipients: RecipientInfo[];
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(
      recipients
        .filter((r) => r.isSelected && r.role !== "SUPERADMIN")
        .map((r) => r.userId)
    )
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
    setSaved(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/modules/${slug}/recipients`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...selected] }),
      });
      if (res.ok) {
        setSaved(true);
      } else {
        setError("Не удалось сохранить. Попробуйте ещё раз.");
      }
    });
  }

  const superadmins = recipients.filter((r) => r.role === "SUPERADMIN");
  const others = recipients.filter((r) => r.role !== "SUPERADMIN");

  return (
    <div className="space-y-6">
      {superadmins.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Суперадмины (всегда получают)
          </h3>
          <ul className="space-y-2">
            {superadmins.map((r) => (
              <li
                key={r.userId}
                className="flex items-center gap-3 px-4 py-3 rounded-lg bg-zinc-50 border border-zinc-200"
              >
                <input type="checkbox" checked readOnly disabled className="rounded" />
                <span className="flex-1 text-sm text-zinc-700">
                  {r.name ?? r.email ?? r.userId}
                </span>
                <span className="text-xs text-zinc-400">{ROLE_LABEL[r.role] ?? r.role}</span>
                {!r.hasTelegramChannel && (
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                    нет TG-канала
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Администраторы и менеджеры
          </h3>
          <ul className="space-y-2">
            {others.map((r) => (
              <li
                key={r.userId}
                className="flex items-center gap-3 px-4 py-3 rounded-lg border border-zinc-200 hover:bg-zinc-50 cursor-pointer"
                onClick={() => toggle(r.userId)}
              >
                <input
                  type="checkbox"
                  checked={selected.has(r.userId)}
                  onChange={() => toggle(r.userId)}
                  className="rounded"
                />
                <span className="flex-1 text-sm text-zinc-700">
                  {r.name ?? r.email ?? r.userId}
                </span>
                <span className="text-xs text-zinc-400">{ROLE_LABEL[r.role] ?? r.role}</span>
                {!r.hasTelegramChannel && (
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                    нет TG-канала
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center gap-4 pt-2">
        <button
          onClick={save}
          disabled={isPending}
          className="px-5 py-2 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {isPending ? "Сохранение..." : "Сохранить"}
        </button>
        {saved && (
          <span className="text-sm text-green-600">Сохранено</span>
        )}
        {error && (
          <span className="text-sm text-red-500">{error}</span>
        )}
      </div>
    </div>
  );
}
