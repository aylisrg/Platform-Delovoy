"use client";
import { useEffect, useState } from "react";

type Cat = { slug: string; name: string };
type OfficeOption = { id: string; label: string; number: string };
type AmbiguityCandidate = { id: string; label: string };

type Props = { categories: Cat[] };

export default function ReportForm({ categories }: Props) {
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [officeNumber, setOfficeNumber] = useState("");
  const [officeId, setOfficeId] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [suggestions, setSuggestions] = useState<OfficeOption[]>([]);
  const [ambiguity, setAmbiguity] = useState<AmbiguityCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ publicId: string; trackingUrl: string } | null>(null);

  useEffect(() => {
    if (!officeNumber || officeId) {
      setSuggestions([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/tasks/offices?q=${encodeURIComponent(officeNumber)}`
        );
        const json = await res.json();
        if (json?.success) setSuggestions(json.data ?? []);
      } catch {
        // ignore
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [officeNumber, officeId]);

  async function submit(e: React.FormEvent, ambiguityResolution?: "specific" | "unknown") {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/tasks/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          name: name || undefined,
          email: email || undefined,
          phone: phone || undefined,
          officeNumber: officeNumber || undefined,
          officeId: officeId || undefined,
          category: category || undefined,
          ambiguityResolution,
        }),
      });
      const json = await res.json();
      if (json?.success) {
        setSuccess(json.data);
        setAmbiguity(null);
      } else if (json?.error?.code === "OFFICE_AMBIGUOUS") {
        setAmbiguity(json.error.details?.candidates ?? []);
      } else {
        setError(json?.error?.message ?? "Не удалось отправить обращение");
      }
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-md border border-green-300 bg-green-50 p-4">
        <h2 className="text-lg font-semibold">Обращение принято</h2>
        <p className="mt-2 text-sm">
          Номер обращения: <code className="font-mono">{success.publicId}</code>
        </p>
        <p className="mt-1 text-sm">
          <a href={success.trackingUrl} className="text-blue-600 underline">
            Отслеживать статус
          </a>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => submit(e)} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">Описание проблемы *</span>
        <textarea
          required
          minLength={10}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Категория</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
        >
          <option value="">— выберите —</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Имя</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Телефон</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+79991234567"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Офис</span>
          <input
            value={officeNumber}
            onChange={(e) => {
              setOfficeNumber(e.target.value);
              setOfficeId(null);
            }}
            placeholder="напр. 301"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
          />
          {suggestions.length > 0 && !officeId && (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOfficeId(s.id);
                      setOfficeNumber(s.number);
                      setSuggestions([]);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>
      </div>

      {ambiguity && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 text-sm">Найдено несколько офисов. Уточните, пожалуйста:</p>
          <div className="flex flex-wrap gap-2">
            {ambiguity.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={(e) => {
                  setOfficeId(c.id);
                  setAmbiguity(null);
                  void submit(e, "specific");
                }}
                className="rounded-md border border-amber-400 bg-white px-3 py-1 text-sm hover:bg-amber-100"
              >
                {c.label}
              </button>
            ))}
            <button
              type="button"
              onClick={(e) => {
                setOfficeId(null);
                setAmbiguity(null);
                void submit(e, "unknown");
              }}
              className="rounded-md border border-gray-400 bg-white px-3 py-1 text-sm"
            >
              Не знаю точно
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || description.length < 10}
        className="rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {loading ? "Отправка..." : "Отправить"}
      </button>
      <p className="text-xs text-gray-500">
        Укажите email или телефон, чтобы мы могли связаться. Обязательно одно из полей.
      </p>
    </form>
  );
}
