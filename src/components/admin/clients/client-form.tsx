"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// F4 ADR — minimal CRUD form for guest cards. Phone is required for create
// and locked on edit (smena phone — это операция merge).

type Mode = "create" | "edit";

type ClientInitial = {
  id?: string;
  phone?: string | null;
  name?: string | null;
  email?: string | null;
  birthday?: string | null;
  notes?: string | null;
};

type Props = {
  mode: Mode;
  initial?: ClientInitial;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
};

const RU_PHONE_RE = /^(\+7|8|7)?[\s\-()]*9[\s\-()0-9]{9,}$/;

function isValidPhone(v: string) {
  return RU_PHONE_RE.test(v.trim());
}

export function ClientForm({ mode, initial, onSuccess, onCancel }: Props) {
  const router = useRouter();
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [birthday, setBirthday] = useState(
    initial?.birthday ? initial.birthday.slice(0, 10) : ""
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  const isEdit = mode === "edit";

  function validate(): string | null {
    if (!isEdit && !isValidPhone(phone)) {
      return "Укажите корректный российский номер телефона";
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "Некорректный e-mail";
    }
    if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
      return "Дата рождения: формат YYYY-MM-DD";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDuplicateId(null);
    const err = validate();
    if (err) {
      setError(err);
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, string | null> = {
        name: name.trim() || null,
        email: email.trim() || null,
        birthday: birthday || null,
        notes: notes.trim() || null,
      };
      if (!isEdit) body.phone = phone.trim();

      const url = isEdit ? `/api/clients/${initial!.id}` : "/api/clients";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (!json.success) {
        if (json.error?.code === "CLIENT_PHONE_DUPLICATE") {
          setDuplicateId(json.error.metadata?.existingClientId ?? null);
          setError("Гость с таким телефоном уже существует");
        } else {
          setError(json.error?.message ?? "Не удалось сохранить");
        }
        return;
      }

      const id = json.data?.id ?? initial?.id;
      onSuccess?.(id);
      router.refresh();
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3"
    >
      <h3 className="text-sm font-semibold text-zinc-900">
        {isEdit ? "Редактировать карточку" : "Новый гость"}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-zinc-600 mb-1">
            Телефон {isEdit ? "(нельзя изменить)" : "*"}
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={isEdit}
            placeholder="+7 999 123-45-67"
            className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-zinc-600 mb-1">
            Имя
          </label>
          <input
            type="text"
            value={name ?? ""}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-zinc-600 mb-1">
            E-mail
          </label>
          <input
            type="email"
            value={email ?? ""}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-zinc-600 mb-1">
            Дата рождения
          </label>
          <input
            type="date"
            value={birthday ?? ""}
            onChange={(e) => setBirthday(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-zinc-600 mb-1">
            Заметки
          </label>
          <textarea
            value={notes ?? ""}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={2000}
            className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none resize-none"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
          {duplicateId && (
            <a
              href={`/admin/clients/${duplicateId}`}
              className="ml-2 underline font-medium"
            >
              Открыть карточку →
            </a>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Отмена
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {submitting ? "..." : isEdit ? "Сохранить" : "Создать"}
        </button>
      </div>
    </form>
  );
}
