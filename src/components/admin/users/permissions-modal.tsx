"use client";

import { useState, useEffect } from "react";
import type { SectionOption, UserPermissionsView } from "@/modules/users/types";
import { DialogShell, primaryButtonClass, secondaryButtonClass } from "./dialog-shell";

/**
 * «Права доступа» (PRD 2026-10-25 US-A4, ADR §6.2/§7).
 *
 * Three groups from `GET /api/admin/permissions/[userId]`:
 * - «Доступны по роли» — read-only, never sent on save (AC-A4.1/AC-A4.2);
 * - «Можно выдать» — grantable sections of the role (no «Звонки», AC-A4.3);
 * - «Особый доступ» — strict sections (НеДеловой), with the auto-grant note for
 *   superadmins.
 */

interface PermissionsModalProps {
  userId: string;
  userName: string | null;
  userRole: string;
  onClose: () => void;
  onSaved: () => void;
}

export const PERMISSIONS_TEXTS = {
  roleGroup: "Доступны по роли",
  grantableGroup: "Можно выдать",
  strictGroup: "Особый доступ",
  superadminStrictNote:
    "Доступ к НеДеловой для суперадминов выдаётся автоматически при обновлении платформы",
  notInTeam: "Права выдаются только сотрудникам команды. Сначала назначьте роль.",
} as const;

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: "Суперадмин",
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
  USER: "Пользователь",
};

type ApiEnvelope<T> = { success: true; data: T } | { success: false; error?: { message?: string } };

export function PermissionsModal({
  userId,
  userName,
  userRole,
  onClose,
  onSaved,
}: PermissionsModalProps) {
  const [view, setView] = useState<UserPermissionsView | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/permissions/${userId}`)
      .then((res) => res.json() as Promise<ApiEnvelope<UserPermissionsView>>)
      .then((body) => {
        if (cancelled) return;
        if (body.success) {
          setView(body.data);
          setSelected(body.data.granted);
        } else {
          setError(body.error?.message || "Ошибка загрузки");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Ошибка сети");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const role = view?.userRole ?? userRole;
  const grantable = view?.grantableSections ?? [];
  const strict = view?.strictSections ?? [];
  const roleSections = view?.roleSections ?? [];
  const managed = new Set([...grantable, ...strict].map((s) => s.slug));
  const canEdit = role !== "USER" && managed.size > 0;
  const selectedGrantable = selected.filter((s) => grantable.some((g) => g.slug === s)).length;

  function toggleSection(slug: string) {
    setSelected((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  }

  function selectAllGrantable() {
    setSelected((prev) => [...new Set([...prev, ...grantable.map((s) => s.slug)])]);
  }

  function deselectAllGrantable() {
    setSelected((prev) => prev.filter((s) => !grantable.some((g) => g.slug === s)));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/permissions/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Only the sections this modal manages — role sections are never sent.
        body: JSON.stringify({ sections: selected.filter((s) => managed.has(s)) }),
      });
      const body = (await res.json()) as ApiEnvelope<{ userId: string; granted: string[] }>;
      if (body.success) {
        onSaved();
        onClose();
      } else {
        setError(body.error?.message || "Ошибка сохранения");
      }
    } catch {
      setError("Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      title="Права доступа"
      subtitle={`${userName || "Без имени"} — ${ROLE_LABEL[role] ?? role}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Отмена
          </button>
          {canEdit && !loading && (
            <button type="button" onClick={handleSave} disabled={saving} className={primaryButtonClass}>
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
          )}
        </>
      }
    >
      {role === "USER" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          {PERMISSIONS_TEXTS.notInTeam}
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-zinc-100" />
          ))}
        </div>
      ) : error && !view ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <div className="space-y-5">
          {roleSections.length > 0 && (
            <section>
              <GroupTitle>{PERMISSIONS_TEXTS.roleGroup}</GroupTitle>
              <p className="mb-2 text-xs text-zinc-400">Входят в роль и не настраиваются.</p>
              <ul className="flex flex-wrap gap-1.5" data-testid="role-sections">
                {roleSections.map((section) => (
                  <li
                    key={section.slug}
                    className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700"
                  >
                    <span aria-hidden>{section.icon}</span>
                    {section.label}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {grantable.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-3">
                <GroupTitle>{PERMISSIONS_TEXTS.grantableGroup}</GroupTitle>
                <button
                  type="button"
                  onClick={selectAllGrantable}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  Выбрать все
                </button>
                <span className="text-zinc-300">|</span>
                <button
                  type="button"
                  onClick={deselectAllGrantable}
                  className="text-xs font-medium text-zinc-500 hover:text-zinc-700"
                >
                  Снять все
                </button>
                <span className="ml-auto text-xs text-zinc-400">
                  {selectedGrantable} из {grantable.length}
                </span>
              </div>
              <div className="space-y-1">
                {grantable.map((section) => (
                  <SectionCheckbox
                    key={section.slug}
                    section={section}
                    checked={selected.includes(section.slug)}
                    onToggle={() => toggleSection(section.slug)}
                    tone="blue"
                  />
                ))}
              </div>
            </section>
          )}

          {strict.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <GroupTitle>{PERMISSIONS_TEXTS.strictGroup}</GroupTitle>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                  требует явного гранта
                </span>
              </div>
              {view?.notes.superadminStrictAutoGrant && (
                <p className="mb-2 text-xs text-zinc-500">{PERMISSIONS_TEXTS.superadminStrictNote}</p>
              )}
              <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/40 p-2">
                {strict.map((section) => (
                  <SectionCheckbox
                    key={section.slug}
                    section={section}
                    checked={selected.includes(section.slug)}
                    onToggle={() => toggleSection(section.slug)}
                    tone="amber"
                  />
                ))}
              </div>
            </section>
          )}

          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      )}
    </DialogShell>
  );
}

function GroupTitle({ children }: { children: string }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{children}</h3>;
}

function SectionCheckbox({
  section,
  checked,
  onToggle,
  tone,
}: {
  section: SectionOption;
  checked: boolean;
  onToggle: () => void;
  tone: "blue" | "amber";
}) {
  const active =
    tone === "amber" ? "bg-amber-100 border border-amber-300" : "bg-blue-50 border border-blue-200";
  const idle = tone === "amber" ? "border border-transparent hover:bg-amber-50" : "border border-transparent hover:bg-zinc-50";
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
        checked ? active : idle
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
      />
      <span className="text-lg" aria-hidden>
        {section.icon}
      </span>
      <div className="flex-1">
        <span className="text-sm font-medium text-zinc-900">{section.label}</span>
        <span className="ml-2 text-xs text-zinc-400">/admin/{section.slug}</span>
      </div>
    </label>
  );
}
