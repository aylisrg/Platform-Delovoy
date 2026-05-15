"use client";

import { useState, useEffect } from "react";

type AdminSection = {
  slug: string;
  label: string;
  icon: string;
};

interface PermissionsModalProps {
  userId: string;
  userName: string | null;
  userRole: string;
  onClose: () => void;
  onSaved: () => void;
}

export function PermissionsModal({
  userId,
  userName,
  userRole,
  onClose,
  onSaved,
}: PermissionsModalProps) {
  const [allSections, setAllSections] = useState<AdminSection[]>([]);
  const [strictSections, setStrictSections] = useState<string[]>([]);
  const [grantedSections, setGrantedSections] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/permissions/${userId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setAllSections(data.data.allSections);
          setStrictSections(data.data.strictSections ?? []);
          setGrantedSections(data.data.grantedSections);
        } else {
          setError(data.error?.message || "Ошибка загрузки");
        }
      })
      .catch(() => setError("Ошибка сети"))
      .finally(() => setLoading(false));
  }, [userId]);

  function toggleSection(slug: string) {
    setGrantedSections((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }

  function selectAll() {
    const available = isSuperadmin
      ? allSections.filter((s) => strictSections.includes(s.slug))
      : allSections;
    setGrantedSections(available.map((s) => s.slug));
  }

  function deselectAll() {
    const available = isSuperadmin
      ? allSections.filter((s) => strictSections.includes(s.slug))
      : allSections;
    setGrantedSections((prev) =>
      prev.filter((s) => !available.some((a) => a.slug === s))
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/permissions/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: grantedSections }),
      });
      const data = await res.json();
      if (data.success) {
        onSaved();
        onClose();
      } else {
        setError(data.error?.message || "Ошибка сохранения");
      }
    } catch {
      setError("Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  const isSuperadmin = userRole === "SUPERADMIN" || userRole === "ADMIN";
  const isManager = userRole === "MANAGER";
  const isUser = userRole === "USER";

  const strictSectionObjects = allSections.filter((s) => strictSections.includes(s.slug));
  const regularSections = allSections.filter((s) => !strictSections.includes(s.slug));

  const canEdit = isManager || isSuperadmin;
  const availableCount = isSuperadmin ? strictSectionObjects.length : allSections.length;
  const selectedCount = isSuperadmin
    ? grantedSections.filter((s) => strictSections.includes(s)).length
    : grantedSections.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Права доступа</h2>
            <p className="text-sm text-zinc-500">
              {userName || "Без имени"} —{" "}
              {userRole === "SUPERADMIN"
                ? "Суперадмин"
                : userRole === "ADMIN"
                  ? "Администратор"
                  : userRole === "MANAGER"
                    ? "Менеджер"
                    : "Пользователь"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          {isUser ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">
              Управление правами доступно только для менеджеров.
              Сначала измените роль пользователя.
            </div>
          ) : loading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-zinc-100" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <>
              {/* Quick actions */}
              <div className="mb-4 flex items-center gap-3">
                <button
                  onClick={selectAll}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  Выбрать все
                </button>
                <span className="text-zinc-300">|</span>
                <button
                  onClick={deselectAll}
                  className="text-xs font-medium text-zinc-500 hover:text-zinc-700"
                >
                  Снять все
                </button>
                <span className="ml-auto text-xs text-zinc-400">
                  {selectedCount} из {availableCount}
                </span>
              </div>

              {/* Strict sections group */}
              {strictSectionObjects.length > 0 && (
                <div className="mb-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                      Строгий доступ
                    </span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                      требует явного гранта
                    </span>
                  </div>
                  {isSuperadmin && (
                    <p className="mb-2 text-xs text-zinc-400">
                      Суперадмин получает доступ ко всем стандартным разделам автоматически.
                      Разделы ниже требуют ручного включения.
                    </p>
                  )}
                  <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/40 p-2">
                    {strictSectionObjects.map((section) => {
                      const isGranted = grantedSections.includes(section.slug);
                      return (
                        <label
                          key={section.slug}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                            isGranted
                              ? "bg-amber-100 border border-amber-300"
                              : "border border-transparent hover:bg-amber-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isGranted}
                            onChange={() => toggleSection(section.slug)}
                            className="h-4 w-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
                          />
                          <span className="text-lg">{section.icon}</span>
                          <div className="flex-1">
                            <span className="text-sm font-medium text-zinc-900">
                              {section.label}
                            </span>
                            <span className="ml-2 text-xs text-zinc-400">
                              /admin/{section.slug}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Regular sections — only for managers */}
              {isManager && regularSections.length > 0 && (
                <div>
                  {strictSectionObjects.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                        Стандартные разделы
                      </span>
                    </div>
                  )}
                  <div className="space-y-1">
                    {regularSections.map((section) => {
                      const isGranted = grantedSections.includes(section.slug);
                      return (
                        <label
                          key={section.slug}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                            isGranted
                              ? "bg-blue-50 border border-blue-200"
                              : "border border-transparent hover:bg-zinc-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isGranted}
                            onChange={() => toggleSection(section.slug)}
                            className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-lg">{section.icon}</span>
                          <div className="flex-1">
                            <span className="text-sm font-medium text-zinc-900">
                              {section.label}
                            </span>
                            <span className="ml-2 text-xs text-zinc-400">
                              /admin/{section.slug}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-zinc-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Отмена
          </button>
          {canEdit && !loading && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
