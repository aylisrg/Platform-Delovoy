"use client";

import { useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { OfficeCombobox, type OfficeOption } from "@/components/ui/office-combobox";

type FeedbackType = "BUG" | "SUGGESTION";

export function FeedbackButton() {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("BUG");
  const [description, setDescription] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [office, setOffice] = useState<OfficeOption | null>(null);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Only show for authenticated users
  if (!session?.user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (description.length < 10) {
      setError("Описание минимум 10 символов");
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("type", type);
      formData.append("description", description);
      formData.append("pageUrl", window.location.pathname);
      formData.append("isUrgent", String(isUrgent));
      if (office) {
        formData.append("officeId", office.id);
      }
      if (screenshot) {
        formData.append("screenshot", screenshot);
      }

      const res = await fetch("/api/feedback", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error?.message || "Не удалось отправить");
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        resetForm();
        setIsOpen(false);
        setSuccess(false);
      }, 2000);
    } catch {
      setError("Ошибка сети. Попробуйте позже.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setType("BUG");
    setDescription("");
    setIsUrgent(false);
    setOffice(null);
    setScreenshot(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError("Файл слишком большой (максимум 5 МБ)");
      e.target.value = "";
      return;
    }

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Допустимые форматы: PNG, JPG, WEBP");
      e.target.value = "";
      return;
    }

    setError(null);
    setScreenshot(file);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => {
          setIsOpen(true);
          setSuccess(false);
          setError(null);
        }}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg transition-transform hover:scale-110 hover:bg-zinc-800 active:scale-95"
        title="Обратная связь"
        aria-label="Обратная связь"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {/* Modal overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-6 sm:items-center sm:justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => {
              if (!isSubmitting) {
                setIsOpen(false);
              }
            }}
          />

          {/* Modal */}
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            {/* Close button */}
            <button
              onClick={() => setIsOpen(false)}
              disabled={isSubmitting}
              className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-600"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>

            <h2 className="mb-4 text-lg font-semibold text-zinc-900">Обратная связь</h2>

            {success ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-zinc-700">Обращение отправлено. Спасибо!</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Type selector */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setType("BUG")}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      type === "BUG"
                        ? "border-red-300 bg-red-50 text-red-700"
                        : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
                    }`}
                  >
                    Ошибка
                  </button>
                  <button
                    type="button"
                    onClick={() => setType("SUGGESTION")}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      type === "SUGGESTION"
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
                    }`}
                  >
                    Предложение
                  </button>
                </div>

                {/* Description */}
                <div>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Опишите проблему или предложение..."
                    rows={4}
                    maxLength={2000}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    disabled={isSubmitting}
                  />
                  <p className="mt-1 text-right text-xs text-zinc-400">
                    {description.length}/2000
                  </p>
                </div>

                {/* Office */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">
                    Ваш офис (необязательно)
                  </label>
                  <OfficeCombobox
                    value={office}
                    onChange={setOffice}
                    disabled={isSubmitting}
                  />
                </div>

                {/* Screenshot */}
                <div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    {screenshot ? screenshot.name : "Прикрепить скриншот"}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleFileChange}
                      className="hidden"
                      disabled={isSubmitting}
                    />
                  </label>
                  {screenshot && (
                    <button
                      type="button"
                      onClick={() => {
                        setScreenshot(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="mt-1 text-xs text-red-500 hover:text-red-700"
                    >
                      Удалить файл
                    </button>
                  )}
                </div>

                {/* Urgent toggle */}
                <button
                  type="button"
                  onClick={() => setIsUrgent(!isUrgent)}
                  className={`w-full rounded-lg border-2 px-4 py-2.5 text-sm font-semibold transition-all ${
                    isUrgent
                      ? "border-red-500 bg-red-500 text-white shadow-lg shadow-red-500/25"
                      : "border-red-200 text-red-500 hover:border-red-400 hover:bg-red-50"
                  }`}
                >
                  {isUrgent ? "СРОЧНО!" : "Отметить как СРОЧНО!"}
                </button>
                {isUrgent && (
                  <p className="text-xs text-red-500">
                    Владелец парка получит уведомление в Telegram немедленно
                  </p>
                )}

                {/* Error */}
                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isSubmitting || description.length < 10}
                  className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting ? "Отправляем..." : "Отправить"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
