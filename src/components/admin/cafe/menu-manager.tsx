"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type MenuManagerItem = {
  id: string;
  category: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  isAvailable: boolean;
  sortOrder: number;
};

type Props = {
  initialItems: MenuManagerItem[];
  /** Кнопка удаления (с паролем) — только SUPERADMIN. */
  canDelete: boolean;
};

type EditorState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; item: MenuManagerItem };

type FormState = {
  category: string;
  name: string;
  description: string;
  price: string;
  sortOrder: string;
};

const emptyForm: FormState = {
  category: "",
  name: "",
  description: "",
  price: "",
  sortOrder: "0",
};

/**
 * Каталог меню кафе: добавление/редактирование позиций, фото, тумблер
 * доступности, удаление (SUPERADMIN, с паролем). Владелец дозаполняет
 * ассортимент сам — см. PRD 2026-07-22.
 */
export function MenuManager({ initialItems, canDelete }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<MenuManagerItem[]>(initialItems);
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<MenuManagerItem | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category))].sort(),
    [items]
  );

  function openCreate() {
    setForm(emptyForm);
    setPhoto(null);
    setError(null);
    setEditor({ mode: "create" });
  }

  function openEdit(item: MenuManagerItem) {
    setForm({
      category: item.category,
      name: item.name,
      description: item.description ?? "",
      price: String(item.price),
      sortOrder: String(item.sortOrder),
    });
    setPhoto(null);
    setError(null);
    setEditor({ mode: "edit", item });
  }

  function closeEditor() {
    setEditor({ mode: "closed" });
    setPhoto(null);
    setError(null);
  }

  async function uploadPhoto(itemId: string): Promise<string | null> {
    if (!photo) return null;
    const fd = new FormData();
    fd.append("file", photo);
    const res = await fetch(`/api/cafe/menu/${itemId}/image`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error?.message ?? "Не удалось загрузить фото");
    }
    return data.data.imageUrl as string;
  }

  async function save() {
    if (editor.mode === "closed") return;
    setSaving(true);
    setError(null);

    const payload = {
      category: form.category.trim(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      price: Number(form.price),
      sortOrder: Number(form.sortOrder) || 0,
    };

    try {
      if (!payload.category || !payload.name) {
        throw new Error("Категория и название обязательны");
      }
      if (!Number.isFinite(payload.price) || payload.price <= 0) {
        throw new Error("Цена должна быть положительным числом");
      }

      let saved: MenuManagerItem;
      if (editor.mode === "create") {
        const res = await fetch("/api/cafe/menu", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error?.message ?? "Ошибка создания");
        saved = { ...data.data, price: Number(data.data.price) };
      } else {
        const res = await fetch(`/api/cafe/menu/${editor.item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error?.message ?? "Ошибка сохранения");
        saved = { ...data.data, price: Number(data.data.price) };
      }

      const imageUrl = await uploadPhoto(saved.id);
      if (imageUrl) saved = { ...saved, imageUrl };

      setItems((prev) => {
        const exists = prev.some((i) => i.id === saved.id);
        const next = exists
          ? prev.map((i) => (i.id === saved.id ? { ...i, ...saved } : i))
          : [...prev, saved];
        return next.sort(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            a.sortOrder - b.sortOrder ||
            a.name.localeCompare(b.name)
        );
      });
      closeEditor();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAvailability(item: MenuManagerItem) {
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/cafe/menu/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAvailable: !item.isAvailable }),
      });
      const data = await res.json();
      if (data.success) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, isAvailable: !item.isAvailable } : i
          )
        );
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteFor || !deletePassword) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cafe/menu/${deleteFor.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? "Удаление отклонено");
      setItems((prev) => prev.filter((i) => i.id !== deleteFor.id));
      setDeleteFor(null);
      setDeletePassword("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  const editorOpen = editor.mode !== "closed";

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-zinc-900">Каталог меню</h2>
          <Button size="sm" onClick={openCreate}>
            + Добавить позицию
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Меню пусто. Добавьте первую позицию.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-zinc-500">
                  <th className="pb-3 font-medium">Фото</th>
                  <th className="pb-3 font-medium">Категория</th>
                  <th className="pb-3 font-medium">Название</th>
                  <th className="pb-3 font-medium">Цена</th>
                  <th className="pb-3 font-medium">Продажа</th>
                  <th className="pb-3 font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-zinc-50">
                    <td className="py-2 pr-3">
                      {item.imageUrl ? (
                        <div className="relative h-10 w-14 overflow-hidden rounded bg-zinc-100">
                          <Image
                            src={item.imageUrl}
                            alt={item.name}
                            fill
                            sizes="56px"
                            className="object-cover"
                            unoptimized
                          />
                        </div>
                      ) : (
                        <div className="flex h-10 w-14 items-center justify-center rounded bg-zinc-100 text-lg">
                          ☕
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-zinc-500">{item.category}</td>
                    <td className="py-2 pr-3 font-medium text-zinc-900">
                      {item.name}
                      {item.description && (
                        <p className="text-xs font-normal text-zinc-400">{item.description}</p>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-zinc-600">{item.price} ₽</td>
                    <td className="py-2 pr-3">
                      <button
                        onClick={() => toggleAvailability(item)}
                        disabled={busyId === item.id}
                        title={item.isAvailable ? "Скрыть с витрины" : "Вернуть на витрину"}
                        className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${
                          item.isAvailable ? "bg-green-500" : "bg-zinc-300"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                            item.isAvailable ? "left-[22px]" : "left-0.5"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openEdit(item)}>
                          Изменить
                        </Button>
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setError(null);
                              setDeletePassword("");
                              setDeleteFor(item);
                            }}
                          >
                            Удалить
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* Модалка создания/редактирования */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900">
              {editor.mode === "create" ? "Новая позиция" : "Редактирование"}
            </h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">
                  Категория
                </label>
                <input
                  type="text"
                  list="cafe-categories"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="Напитки / Выпечка / …"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <datalist id="cafe-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">
                  Название
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">
                  Описание (необязательно)
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">
                    Цена, ₽
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">
                    Порядок в категории
                  </label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">
                  Фото (PNG/JPG/WEBP, до 5 МБ)
                </label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:text-zinc-700 hover:file:bg-zinc-200"
                />
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={closeEditor} disabled={saving}>
                Отмена
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Сохранение…" : "Сохранить"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка удаления (SUPERADMIN, подтверждение паролем) */}
      {deleteFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900">Удалить позицию?</h3>
            <p className="mt-2 text-sm text-zinc-500">
              «{deleteFor.name}» будет скрыта из меню и каталога. Подтвердите паролем.
            </p>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Пароль"
              className="mt-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDeleteFor(null);
                  setError(null);
                }}
                disabled={saving}
              >
                Отмена
              </Button>
              <Button
                variant="danger"
                onClick={confirmDelete}
                disabled={saving || !deletePassword}
              >
                {saving ? "Удаление…" : "Удалить"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
