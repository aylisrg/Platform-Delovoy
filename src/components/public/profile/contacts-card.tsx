"use client";

import { useState, useEffect, useCallback, useRef, useId } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { ProfileData, DetachableChannel } from "@/modules/profile/types";
import { trackDashboard } from "@/components/public/dashboard/tracking";

const inputClass =
  "block w-full min-w-0 rounded-xl border border-zinc-300 bg-white px-3 py-3 text-sm focus-visible:outline-2 focus-visible:outline-blue-600";
const buttonClass =
  "min-h-11 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const secondaryClass =
  "min-h-11 rounded-xl border border-zinc-300 px-4 py-2 text-sm text-zinc-700 disabled:opacity-50";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success)
    throw new Error(
      result?.error?.message ??
        "Не удалось выполнить запрос. Попробуйте ещё раз.",
    );
  return result.data as T;
}
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const message = (error: unknown) =>
  error instanceof TypeError
    ? "Нет связи с сервером. Попробуйте ещё раз."
    : error instanceof Error
      ? error.message
      : "Нет связи с сервером. Попробуйте ещё раз.";

export function ContactsCard({
  initialEmailToken,
}: { initialEmailToken?: string } = {}) {
  const router = useRouter();
  const { update } = useSession();
  const prefix = useId();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [flow, setFlow] = useState<"email" | "phone" | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sent, setSent] = useState(false);
  const [emailToken, setEmailToken] = useState(initialEmailToken ?? "");
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [detach, setDetach] = useState<DetachableChannel | null>(null);
  const initialized = useRef(false);

  const refresh = useCallback(
    () =>
      request<ProfileData>("/api/profile").then((result) => {
        setProfile(result);
        setLoadError("");
        return result;
      }),
    [],
  );

  const confirmEmail = useCallback(
    async (token: string) => {
      setBusy(true);
      setError("");
      setSuccess("");
      try {
        if (!/^[a-f0-9]{64}$/.test(token))
          throw new Error(
            "Ссылка подтверждения некорректна. Запросите новое письмо.",
          );
        await request("/api/profile/contacts/email/confirm", json({ token }));
        setEmailToken("");
        setFlow(null);
        setSent(false);
        setSuccess("Email подтверждён и привязан к аккаунту");
        await refresh();
        await update();
        router.refresh();
      } catch (err) {
        setError(message(err));
      } finally {
        setBusy(false);
      }
    },
    [refresh, update, router],
  );

  const load = useCallback(
    () =>
      refresh()
        .catch((err) => setLoadError(message(err)))
        .finally(() => setLoading(false)),
    [refresh],
  );

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const url = new URL(window.location.href);
    const token = initialEmailToken;
    if (token) {
      url.searchParams.delete("attachEmail");
      url.searchParams.set("section", "profile");
      window.history.replaceState({}, "", url.toString());
      void load().then(() => confirmEmail(token));
    } else {
      void load();
    }
  }, [initialEmailToken, load, confirmEmail]);

  useEffect(() => {
    if (!telegramLink) return;
    const onFocus = () => {
      void refresh().catch((err) => setError(message(err)));
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [telegramLink, refresh]);

  async function perform(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await task();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const closeDetach = useCallback(() => {
    setDetach(null);
    setError("");
  }, []);
  function startFlow(value: "email" | "phone") {
    setFlow(value);
    setSent(false);
    setError("");
    setSuccess("");
    trackDashboard("contact_link_started", { channel: value });
  }

  if (loading)
    return (
      <p role="status" className="py-4 text-sm text-zinc-600">
        Загружаем контакты…
      </p>
    );
  if (loadError || !profile)
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-700">
          {loadError || "Не удалось загрузить контакты"}
        </p>
        <button
          className={secondaryClass}
          onClick={() => {
            setLoading(true);
            setLoadError("");
            void load();
          }}
        >
          Повторить загрузку контактов
        </button>
      </div>
    );

  return (
    <div className="min-w-0 space-y-6" aria-busy={busy}>
      {error && !detach && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {success}
        </p>
      )}
      {emailToken && (
        <div className="space-y-3 rounded-xl bg-blue-50 p-4">
          <p className="text-sm text-zinc-700">
            Подтверждаем email по ссылке из письма. Если ссылка истекла,
            запросите новое письмо.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              className={buttonClass}
              onClick={() => confirmEmail(emailToken)}
            >
              {busy ? "Подтверждаем…" : "Повторить подтверждение"}
            </button>
            <button
              disabled={busy}
              className={secondaryClass}
              onClick={() => {
                setEmailToken("");
                startFlow("email");
              }}
            >
              Запросить новое письмо
            </button>
          </div>
        </div>
      )}
      <section>
        <h3 className="mb-3 text-sm font-semibold">Как к вам обращаться</h3>
        {editingName ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                await request("/api/profile", {
                  ...json({ name: name.trim() }),
                  method: "PATCH",
                });
                await refresh();
                await update();
                router.refresh();
                setEditingName(false);
                setSuccess("Имя сохранено");
              });
            }}
          >
            <label
              htmlFor={`${prefix}-name`}
              className="block text-sm text-zinc-700"
            >
              Ваше имя
            </label>
            <input
              id={`${prefix}-name`}
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={2}
              maxLength={100}
              required
              autoComplete="name"
              disabled={busy}
            />
            <div className="flex flex-wrap gap-2">
              <button
                disabled={busy || name.trim().length < 2}
                className={buttonClass}
              >
                Сохранить имя
              </button>
              <button
                type="button"
                disabled={busy}
                className={secondaryClass}
                onClick={() => setEditingName(false)}
              >
                Отмена
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 break-words text-sm">
              {profile.name ?? "Имя не указано"}
            </p>
            <button
              className="min-h-11 px-2 text-sm font-medium text-blue-700"
              onClick={() => {
                setName(profile.name ?? "");
                setEditingName(true);
                setSuccess("");
                setError("");
              }}
            >
              Изменить имя
            </button>
          </div>
        )}
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Связь и вход в аккаунт</h3>
        <p className="text-sm leading-relaxed text-zinc-600">
          Email и Telegram используются для входа и уведомлений. Телефон нужен
          сотрудникам для связи по бронированию.
        </p>
        {(
          [
            ["email", "Email", profile.contacts.email],
            [
              "telegram",
              "Telegram",
              profile.contacts.telegram ? "Аккаунт привязан" : null,
            ],
            ["phone", "Телефон", profile.contacts.phone],
          ] as const
        ).map(([channel, label, value]) => (
          <div
            key={channel}
            className="flex flex-col gap-2 rounded-xl border border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{label}</p>
              <p className="mt-1 break-all text-sm text-zinc-600">
                {value ?? "Не добавлен"}
              </p>
            </div>
            {value ? (
              <button
                disabled={busy}
                className="min-h-11 self-start px-2 text-sm text-red-700 disabled:opacity-50 sm:self-auto"
                onClick={() => {
                  setError("");
                  setDetach(channel);
                }}
              >
                Отвязать {label}
              </button>
            ) : (
              <button
                disabled={busy}
                className="min-h-11 self-start px-2 text-sm font-medium text-blue-700 disabled:opacity-50 sm:self-auto"
                onClick={() =>
                  channel === "telegram"
                    ? void perform(async () => {
                        trackDashboard("contact_link_started", {
                          channel: "telegram",
                        });
                        const result = await request<{ link: string }>(
                          "/api/profile/telegram/generate-link",
                          { method: "POST" },
                        );
                        setTelegramLink(result.link);
                      })
                    : startFlow(channel)
                }
              >
                Добавить {label}
              </button>
            )}
          </div>
        ))}
        {profile.contacts.yandex && (
          <div className="rounded-xl border border-zinc-200 p-4">
            <p className="text-sm font-medium">Старая привязка Яндекса</p>
            <p className="mt-2 text-sm text-zinc-600">
              Вход через Яндекс больше не поддерживается. Для входа используйте
              email или Telegram.
            </p>
            <button
              disabled={busy}
              className="mt-2 min-h-11 text-sm text-red-700"
              onClick={() => setDetach("yandex")}
            >
              Удалить старую привязку
            </button>
          </div>
        )}
      </section>
      {telegramLink && !profile.contacts.telegram && (
        <div className="space-y-3 rounded-xl bg-blue-50 p-4">
          <p className="text-sm text-zinc-700">
            Откройте бота и подтвердите привязку. Ссылка действует 15 минут.
          </p>
          <a
            href={telegramLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-xl bg-blue-700 px-4 text-sm font-medium text-white"
          >
            Открыть Telegram
          </a>
          <button
            disabled={busy}
            className={`${secondaryClass} w-full`}
            onClick={() =>
              void perform(async () => {
                const result = await refresh();
                setSuccess(
                  result.contacts.telegram
                    ? "Telegram привязан"
                    : "Привязка пока не завершена. Подтвердите её в боте.",
                );
              })
            }
          >
            Проверить привязку
          </button>
        </div>
      )}
      {flow && (
        <form
          className="space-y-3 rounded-xl bg-zinc-50 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              if (flow === "email") {
                await request(
                  "/api/profile/contacts/email/request",
                  json({ email }),
                );
                setSent(true);
                setSuccess(
                  "Письмо отправлено. Нажмите в нём «Подтвердить email».",
                );
              } else {
                await request(
                  "/api/profile/contacts/phone/request",
                  json({ phone }),
                );
                await refresh();
                setFlow(null);
                setSuccess("Контактный телефон сохранён");
              }
            });
          }}
        >
          <label
            htmlFor={`${prefix}-${flow}`}
            className="block text-sm font-medium"
          >
            {flow === "email" ? "Адрес email" : "Контактный телефон"}
          </label>
          <input
            id={`${prefix}-${flow}`}
            type={flow === "email" ? "email" : "tel"}
            autoComplete={flow === "email" ? "email" : "tel"}
            value={flow === "email" ? email : phone}
            onChange={(event) =>
              flow === "email"
                ? setEmail(event.target.value)
                : setPhone(event.target.value)
            }
            required
            maxLength={flow === "email" ? 254 : 16}
            disabled={busy}
            className={inputClass}
            placeholder={flow === "email" ? "name@example.ru" : "+79001234567"}
          />
          {flow === "email" && (
            <p className="text-sm leading-relaxed text-zinc-600">
              Отправим ссылку для подтверждения. Она действует 10 минут. Если
              письмо не пришло, проверьте «Спам» или отправьте повторно.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className={buttonClass}>
              {busy
                ? "Подождите…"
                : flow === "phone"
                  ? "Сохранить телефон"
                  : sent
                    ? "Отправить письмо повторно"
                    : "Отправить письмо"}
            </button>
            <button
              type="button"
              disabled={busy}
              className={secondaryClass}
              onClick={() => {
                setFlow(null);
                setError("");
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
      {detach && (
        <DetachDialog
          busy={busy}
          error={error}
          onClose={closeDetach}
          onConfirm={() =>
            void perform(async () => {
              await request(`/api/profile/contacts/${detach}/detach`, {
                method: "DELETE",
              });
              await refresh();
              await update();
              router.refresh();
              setDetach(null);
              setSuccess("Контакт отвязан");
            })
          }
        />
      )}
    </div>
  );
}

function DetachDialog({
  busy,
  error,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const title = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-white p-6 shadow-xl backdrop:bg-black/50"
    >
      <h3 id={title} className="text-lg font-semibold">
        Отвязать контакт?
      </h3>
      <p className="mt-3 text-sm leading-relaxed text-zinc-600">
        Вы больше не сможете использовать этот контакт для входа и уведомлений.
        Сначала убедитесь, что у вас есть другой действующий способ входа.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          ref={cancel}
          disabled={busy}
          className={secondaryClass}
          onClick={onClose}
        >
          Оставить контакт
        </button>
        <button
          disabled={busy}
          className="min-h-11 rounded-xl bg-red-700 px-4 text-sm font-medium text-white disabled:opacity-50"
          onClick={onConfirm}
        >
          {busy ? "Отвязываем…" : "Отвязать контакт"}
        </button>
      </div>
    </dialog>
  );
}
