"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export type SendEmailModalProps = {
  open: boolean;
  onClose: () => void;
  tenantId?: string;
  contractId?: string;
  tenantName: string;
  availableEmails: string[];
};

type TemplateOption = {
  key: string;
  name: string;
  isActive: boolean;
};

export function SendEmailModal({
  open,
  onClose,
  tenantId,
  contractId,
  tenantName,
  availableEmails,
}: SendEmailModalProps) {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templateKey, setTemplateKey] = useState<string>("");
  const [customSubject, setCustomSubject] = useState<string>("");
  const [customBodyHtml, setCustomBodyHtml] = useState<string>("");
  const [selectedEmails, setSelectedEmails] = useState<string[]>(availableEmails);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    fetch("/api/rental/email-templates")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          const active = (data.data as TemplateOption[]).filter((t) => t.isActive);
          setTemplates(active);
          if (active.length > 0 && !templateKey) setTemplateKey(active[0].key);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setSelectedEmails(availableEmails);
  }, [availableEmails]);

  function toggleEmail(email: string) {
    setSelectedEmails((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const useTemplate = templateKey && !customSubject && !customBodyHtml;
      const body = {
        tenantId,
        contractId,
        to: selectedEmails,
        ...(useTemplate
          ? { templateKey }
          : { customSubject, customBodyHtml }),
      };
      const res = await fetch("/api/rental/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? "Ошибка");
      const sent = data.data.sent.length;
      const failed = data.data.failed.length;
      setResult(`Отправлено: ${sent}${failed ? `, не удалось: ${failed}` : ""}`);
      if (failed === 0) {
        setTimeout(() => onClose(), 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl max-h-[90vh] overflow-auto">
        <form onSubmit={handleSubmit} className="p-6">
          <h2 className="text-lg font-semibold text-zinc-900 mb-1">
            Письмо арендатору
          </h2>
          <p className="text-sm text-zinc-500 mb-4">
            Получатель: <b>{tenantName}</b>. Отправитель — из настроек модуля
            (<span className="font-mono">buh@delovoy-park.ru</span>).
          </p>

          {availableEmails.length === 0 ? (
            <p className="text-sm text-red-600">
              У арендатора не указан ни один email — отправка невозможна.
            </p>
          ) : (
            <>
              <div className="mb-4">
                <p className="text-sm font-medium text-zinc-700 mb-2">Адреса</p>
                <div className="flex flex-wrap gap-2">
                  {availableEmails.map((email) => (
                    <label
                      key={email}
                      className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-1.5 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEmails.includes(email)}
                        onChange={() => toggleEmail(email)}
                      />
                      {email}
                    </label>
                  ))}
                </div>
              </div>

              <label className="block mb-4">
                <span className="text-sm font-medium text-zinc-700 mb-1 block">
                  Шаблон
                </span>
                <select
                  value={templateKey}
                  onChange={(e) => setTemplateKey(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                >
                  <option value="">— Без шаблона (свой текст) —</option>
                  {templates.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name} ({t.key})
                    </option>
                  ))}
                </select>
              </label>

              {!templateKey && (
                <>
                  <label className="block mb-3">
                    <span className="text-sm font-medium text-zinc-700 mb-1 block">
                      Тема
                    </span>
                    <input
                      type="text"
                      value={customSubject}
                      onChange={(e) => setCustomSubject(e.target.value)}
                      className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                      required={!templateKey}
                    />
                  </label>
                  <label className="block mb-4">
                    <span className="text-sm font-medium text-zinc-700 mb-1 block">
                      HTML-тело
                    </span>
                    <textarea
                      value={customBodyHtml}
                      onChange={(e) => setCustomBodyHtml(e.target.value)}
                      rows={10}
                      className="w-full rounded-md border border-zinc-300 px-3 py-2 text-xs font-mono"
                      required={!templateKey}
                    />
                  </label>
                </>
              )}

              {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
              {result && <p className="text-sm text-green-600 mb-3">{result}</p>}
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={sending}>
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={
                sending ||
                availableEmails.length === 0 ||
                selectedEmails.length === 0 ||
                (!templateKey && (!customSubject || !customBodyHtml))
              }
            >
              {sending ? "Отправка…" : "Отправить"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
