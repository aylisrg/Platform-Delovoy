"use client";

import { useState, useEffect } from "react";

type OfficeSuggestion = {
  id: string;
  number: string;
  building: number | null;
  floor: number | null;
};

export function ReportForm({
  categories,
}: {
  categories: Array<{ slug: string; name: string }>;
}) {
  const [form, setForm] = useState({
    name: "",
    contactEmail: "",
    contactPhone: "",
    officeInput: "",
    officeId: "",
    categorySlug: "",
    description: "",
    photoUrl: "",
  });
  const [suggestions, setSuggestions] = useState<OfficeSuggestion[]>([]);
  const [exactOffice, setExactOffice] = useState<OfficeSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ publicId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState<OfficeSuggestion[] | null>(null);

  // Debounced office autosuggest
  useEffect(() => {
    if (!form.officeInput || form.officeId) {
      setSuggestions([]);
      setExactOffice(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/tasks/offices/search?q=${encodeURIComponent(form.officeInput)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success) return;
        setExactOffice(data.data.exact);
        setSuggestions(data.data.candidates ?? []);
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [form.officeInput, form.officeId]);

  function pickOffice(o: OfficeSuggestion) {
    setForm((f) => ({
      ...f,
      officeInput: o.number,
      officeId: o.id,
    }));
    setSuggestions([]);
    setExactOffice(o);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setAmbiguous(null);
    try {
      const res = await fetch("/api/tasks/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          contactEmail: form.contactEmail || undefined,
          contactPhone: form.contactPhone || undefined,
          officeInput: form.officeInput,
          officeId: form.officeId || undefined,
          categorySlug: form.categorySlug || undefined,
          description: form.description,
          photoUrl: form.photoUrl || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult({ publicId: data.data.publicId });
        return;
      }
      if (
        res.status === 409 &&
        data?.error?.code === "OFFICE_AMBIGUOUS"
      ) {
        setAmbiguous(data?.data?.candidates ?? []);
        setError("Найдено несколько офисов — выберите нужный");
        return;
      }
      setError(data?.error?.message ?? "Не удалось отправить форму");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6">
        <h2 className="text-lg font-semibold text-green-800">Заявка принята!</h2>
        <p className="mt-2 text-sm text-green-700">
          Номер тикета: <strong className="font-mono">{result.publicId}</strong>
        </p>
        <p className="mt-3 text-sm text-green-700">
          {form.contactEmail
            ? "Мы отправили подтверждение на ваш email."
            : "Мы свяжемся с вами по указанному телефону."}
        </p>
        <button
          onClick={() => {
            setResult(null);
            setForm({
              name: "",
              contactEmail: "",
              contactPhone: "",
              officeInput: "",
              officeId: "",
              categorySlug: "",
              description: "",
              photoUrl: "",
            });
          }}
          className="mt-4 rounded bg-white px-3 py-1.5 text-sm font-medium text-green-800 ring-1 ring-green-200"
        >
          Создать ещё одну
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Ваше имя *">
        <input
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Email">
          <input
            type="email"
            value={form.contactEmail}
            onChange={(e) =>
              setForm((f) => ({ ...f, contactEmail: e.target.value }))
            }
            className="w-full rounded border border-zinc-300 px-3 py-2"
            placeholder="you@company.ru"
          />
        </Field>
        <Field label="Телефон">
          <input
            type="tel"
            value={form.contactPhone}
            onChange={(e) =>
              setForm((f) => ({ ...f, contactPhone: e.target.value }))
            }
            className="w-full rounded border border-zinc-300 px-3 py-2"
            placeholder="+7 ..."
          />
        </Field>
      </div>
      <p className="text-xs text-zinc-500">Укажите email или телефон — хотя бы один.</p>

      <Field label="Номер офиса *">
        <input
          required
          value={form.officeInput}
          onChange={(e) =>
            setForm((f) => ({ ...f, officeInput: e.target.value, officeId: "" }))
          }
          className="w-full rounded border border-zinc-300 px-3 py-2"
          placeholder="Например: 301, оф.А-12, кабинет 512"
        />
        {exactOffice && form.officeId && (
          <p className="mt-1 text-xs text-green-700">
            Офис: {exactOffice.number}
            {exactOffice.building ? ` (корпус ${exactOffice.building})` : ""}
          </p>
        )}
        {suggestions.length > 0 && !exactOffice && !form.officeId && (
          <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-zinc-200 bg-white shadow-sm">
            {suggestions.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => pickOffice(o)}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-50"
                >
                  {o.number}
                  {o.building ? ` · корпус ${o.building}` : ""}
                  {o.floor ? ` · этаж ${o.floor}` : ""}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Field>

      {ambiguous && ambiguous.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-medium text-amber-800">
            Несколько офисов подходят под ваш ввод — выберите нужный:
          </p>
          <div className="flex flex-wrap gap-2">
            {ambiguous.map((o) => (
              <button
                type="button"
                key={o.id}
                onClick={() => {
                  pickOffice(o);
                  setAmbiguous(null);
                }}
                className="rounded border border-amber-300 bg-white px-3 py-1 text-sm"
              >
                {o.number}
                {o.building ? ` (корпус ${o.building})` : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      <Field label="Что сломалось / нужно исправить *">
        <textarea
          required
          rows={5}
          value={form.description}
          onChange={(e) =>
            setForm((f) => ({ ...f, description: e.target.value }))
          }
          className="w-full resize-y rounded border border-zinc-300 px-3 py-2"
          placeholder="Опишите проблему как можно подробнее…"
        />
      </Field>

      <Field label="Категория (не обязательно)">
        <select
          value={form.categorySlug}
          onChange={(e) =>
            setForm((f) => ({ ...f, categorySlug: e.target.value }))
          }
          className="w-full rounded border border-zinc-300 px-3 py-2"
        >
          <option value="">— определите автоматически —</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Ссылка на фото (не обязательно)">
        <input
          type="url"
          value={form.photoUrl}
          onChange={(e) => setForm((f) => ({ ...f, photoUrl: e.target.value }))}
          className="w-full rounded border border-zinc-300 px-3 py-2"
          placeholder="https://…"
        />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {busy ? "Отправляем…" : "Отправить заявку"}
      </button>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700">{label}</span>
      {children}
    </label>
  );
}
