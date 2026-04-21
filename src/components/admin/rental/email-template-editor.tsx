"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Template = {
  key: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  isActive: boolean;
  isSystem: boolean;
};

type PreviewResult = {
  subject: string;
  html: string;
  text: string | null;
  missingVars: string[];
};

export function EmailTemplateEditor({
  initial,
  allowedVariables,
}: {
  initial: Template;
  allowedVariables: string[];
}) {
  const [state, setState] = useState<Template>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  function update<K extends keyof Template>(key: K, value: Template[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/rental/email-templates/${encodeURIComponent(state.key)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: state.name,
            subject: state.subject,
            bodyHtml: state.bodyHtml,
            bodyText: state.bodyText || null,
            isActive: state.isActive,
          }),
        }
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? "Ошибка сохранения");
      setMessage("Шаблон сохранён");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    setLoadingPreview(true);
    setError(null);
    try {
      // preview uses the stored version of the template — to preview unsaved edits,
      // save first. For live preview we ask the server with sample vars.
      const res = await fetch(
        `/api/rental/email-templates/${encodeURIComponent(state.key)}/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? "Ошибка предпросмотра");
      setPreview(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сделать preview");
    } finally {
      setLoadingPreview(false);
    }
  }

  function insertVariable(varName: string) {
    const placeholder = `{{${varName}}}`;
    update("bodyHtml", state.bodyHtml + placeholder);
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <label className="block col-span-2">
          <span className="text-sm font-medium text-zinc-700 mb-1 block">Название</span>
          <input
            type="text"
            value={state.name}
            onChange={(e) => update("name", e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            required
          />
        </label>

        <label className="block col-span-2">
          <span className="text-sm font-medium text-zinc-700 mb-1 block">Тема письма</span>
          <input
            type="text"
            value={state.subject}
            onChange={(e) => update("subject", e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            required
          />
        </label>
      </div>

      <div className="grid grid-cols-[1fr_260px] gap-4">
        <label className="block">
          <span className="text-sm font-medium text-zinc-700 mb-1 block">HTML-тело</span>
          <textarea
            value={state.bodyHtml}
            onChange={(e) => update("bodyHtml", e.target.value)}
            rows={18}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-xs font-mono"
            required
          />
        </label>

        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-xs font-semibold text-zinc-700 mb-2">Переменные</p>
          <p className="text-xs text-zinc-500 mb-3">
            Клик — вставить в конец HTML-тела.
          </p>
          <div className="flex flex-col gap-1">
            {allowedVariables.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                className="text-left text-xs font-mono rounded px-2 py-1 hover:bg-white"
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700 mb-1 block">
          Plain-text версия (опционально)
        </span>
        <textarea
          value={state.bodyText}
          onChange={(e) => update("bodyText", e.target.value)}
          rows={5}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-xs font-mono"
        />
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={state.isActive}
          onChange={(e) => update("isActive", e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-sm text-zinc-700">Активен (используется в рассылках)</span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-600">{message}</p>}

      <div className="flex items-center justify-between gap-3 pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={handlePreview}
          disabled={loadingPreview}
        >
          {loadingPreview ? "…" : "Предпросмотр (сохранённой версии)"}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
      </div>

      {preview && (
        <div className="rounded-lg border border-zinc-200 overflow-hidden">
          <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-2 text-sm">
            <p>
              <span className="text-zinc-500">От:</span> {`buh@delovoy-park.ru`}
            </p>
            <p>
              <span className="text-zinc-500">Тема:</span> <b>{preview.subject}</b>
            </p>
            {preview.missingVars.length > 0 && (
              <p className="mt-1 text-xs text-amber-600">
                Отсутствующие переменные: {preview.missingVars.join(", ")}
              </p>
            )}
          </div>
          <iframe
            srcDoc={preview.html}
            title="Email preview"
            className="w-full h-96 bg-white"
            sandbox=""
          />
        </div>
      )}
    </form>
  );
}
