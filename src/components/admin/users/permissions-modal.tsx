"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/badge";

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
      prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [...prev, slug]
    );
  }

  function selectAll() {
    setGrantedSections(allSections.map((s) => s.slug));
  }

  function deselectAll() {
    setGrantedSections([]);
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

  const isSuperadmin = userRole === "SUPERADMIN";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">
              Права доступа
            </h2>
            <p className="text-sm text-zinc-500">
              {userName || "Без имени"} — {userRole === "SUPERADMIN" ? "Суперадмин" : userRole === "MANAGER" ? "Менеджер" : "Пользователь"}
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
        <div className="px-6 py-4">
          {isSuperadmin ? (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-sm text-blue-700">
              Суперадмин всегда имеет полный доступ ко всем разделам.
              Управление правами доступно только для менеджеров.
            </div>
          ) : userRole !== "MANAGER" ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">
              Управление правами доступно только для пользователей с ролью «Менеджер».
              Сначала измените роль пользователя на «Менеджер».
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
                  {grantedSections.length} из {allSections.length}
                </span>
              </div>

              {/* Checkboxes */}
              <div className="space-y-1">
                {allSections.map((section) => {
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
          {userRole === "MANAGER" && !loading && (
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
