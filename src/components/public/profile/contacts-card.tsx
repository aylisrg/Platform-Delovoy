"use client";

import { useState, useEffect, useCallback } from "react";
import { signIn } from "next-auth/react";

interface YandexInfo {
  email: string;
  name: string | null;
}

interface Contacts {
  telegram: string | null;
  yandex: YandexInfo | null;
  email: string | null;
  phone: string | null;
}

interface ProfileResponse {
  id: string;
  name: string | null;
  contacts: Contacts;
}

type AttachFlow = "email" | "phone" | null;

export function ContactsCard() {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Name editing
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");

  // Attach flows
  const [activeFlow, setActiveFlow] = useState<AttachFlow>(null);

  // Email flow state
  const [emailInput, setEmailInput] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [emailToken, setEmailToken] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  // Phone flow state
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneSent, setPhoneSent] = useState(false);
  const [phoneMasked, setPhoneMasked] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);

  // Detach state
  const [detachConfirm, setDetachConfirm] = useState<string | null>(null);
  const [detachLoading, setDetachLoading] = useState(false);
  const [detachError, setDetachError] = useState("");

  // Telegram link state
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [telegramLinkLoading, setTelegramLinkLoading] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      const data = await res.json();
      if (data.success) {
        setProfile(data.data);
        setNameValue(data.data.name ?? "");
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Check for email confirmation token in URL (redirected from email link)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const attachToken = params.get("attachEmail");
    if (attachToken) {
      setActiveFlow("email");
      setEmailSent(true);
      setEmailToken(attachToken);
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete("attachEmail");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // ── Name editing ────────────────────────────────────────────────────────────

  async function handleSaveName() {
    if (nameValue.trim().length < 2) {
      setNameError("Имя должно содержать минимум 2 символа");
      return;
    }
    setNameSaving(true);
    setNameError("");
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameValue.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setProfile((p) => p ? { ...p, name: data.data.name } : p);
        setEditingName(false);
      } else {
        setNameError(data.error?.message ?? "Ошибка сохранения");
      }
    } catch {
      setNameError("Ошибка соединения");
    } finally {
      setNameSaving(false);
    }
  }

  // ── Detach channel ──────────────────────────────────────────────────────────

  async function handleDetach(channel: string) {
    setDetachLoading(true);
    setDetachError("");
    try {
      const res = await fetch(`/api/profile/contacts/${channel}/detach`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        await fetchProfile();
        setDetachConfirm(null);
      } else {
        setDetachError(data.error?.message ?? "Ошибка отвязки");
      }
    } catch {
      setDetachError("Ошибка соединения");
    } finally {
      setDetachLoading(false);
    }
  }

  // ── Telegram link ───────────────────────────────────────────────────────────

  async function handleTelegramLink() {
    setTelegramLinkLoading(true);
    try {
      const res = await fetch("/api/profile/telegram/generate-link", {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setTelegramLink(data.data.link);
      }
    } catch {
      // silently fail
    } finally {
      setTelegramLinkLoading(false);
    }
  }

  // ── Email attach ────────────────────────────────────────────────────────────

  async function handleEmailRequest() {
    setEmailLoading(true);
    setEmailError("");
    try {
      const res = await fetch("/api/profile/contacts/email/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailInput }),
      });
      const data = await res.json();
      if (data.success) {
        setEmailSent(true);
      } else {
        setEmailError(data.error?.message ?? "Ошибка отправки");
      }
    } catch {
      setEmailError("Ошибка соединения");
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleEmailConfirm() {
    setEmailLoading(true);
    setEmailError("");
    try {
      const res = await fetch("/api/profile/contacts/email/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: emailToken }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchProfile();
        setActiveFlow(null);
        setEmailSent(false);
        setEmailInput("");
        setEmailToken("");
      } else {
        setEmailError(data.error?.message ?? "Неверный или истёкший код");
      }
    } catch {
      setEmailError("Ошибка соединения");
    } finally {
      setEmailLoading(false);
    }
  }

  // ── Phone attach ────────────────────────────────────────────────────────────

  async function handlePhoneRequest() {
    setPhoneLoading(true);
    setPhoneError("");
    try {
      const res = await fetch("/api/profile/contacts/phone/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneInput }),
      });
      const data = await res.json();
      if (data.success) {
        setPhoneSent(true);
        setPhoneMasked(data.data.phone);
      } else {
        setPhoneError(data.error?.message ?? "Ошибка отправки");
      }
    } catch {
      setPhoneError("Ошибка соединения");
    } finally {
      setPhoneLoading(false);
    }
  }

  async function handlePhoneConfirm() {
    setPhoneLoading(true);
    setPhoneError("");
    try {
      const res = await fetch("/api/profile/contacts/phone/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneInput, code: phoneCode }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchProfile();
        setActiveFlow(null);
        setPhoneSent(false);
        setPhoneInput("");
        setPhoneCode("");
      } else {
        setPhoneError(data.error?.message ?? "Неверный код");
      }
    } catch {
      setPhoneError("Ошибка соединения");
    } finally {
      setPhoneLoading(false);
    }
  }

  function cancelFlow() {
    setActiveFlow(null);
    setEmailSent(false);
    setEmailInput("");
    setEmailToken("");
    setEmailError("");
    setPhoneSent(false);
    setPhoneInput("");
    setPhoneCode("");
    setPhoneError("");
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-zinc-100" />
        ))}
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="space-y-6">
      {/* Name */}
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">Имя</p>
        {editingName ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              className="flex-1 max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Ваше имя"
              maxLength={100}
              onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
            />
            <button
              onClick={handleSaveName}
              disabled={nameSaving}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              {nameSaving ? "..." : "Сохранить"}
            </button>
            <button
              onClick={() => { setEditingName(false); setNameValue(profile.name ?? ""); setNameError(""); }}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Отмена
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-900">{profile.name ?? "Не указано"}</span>
            <button
              onClick={() => { setEditingName(true); setNameValue(profile.name ?? ""); }}
              className="text-xs text-blue-600 hover:underline"
            >
              Изменить
            </button>
          </div>
        )}
        {nameError && <p className="mt-1 text-xs text-red-500">{nameError}</p>}
      </div>

      {/* Contact rows */}
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">Контакты</p>
        <div className="space-y-3">
          {/* Telegram */}
          <ContactRowWithDetach
            label="Telegram"
            value={profile.contacts.telegram}
            icon="💬"
            channel="telegram"
            isAttached={!!profile.contacts.telegram}
            onDetach={() => setDetachConfirm("telegram")}
            onAttach={handleTelegramLink}
            attachLabel="Привязать Telegram"
            attachLoading={telegramLinkLoading}
          />

          {/* Telegram link flow */}
          {telegramLink && !profile.contacts.telegram && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-4 space-y-2">
              <p className="text-sm text-zinc-700">
                Откройте ссылку в Telegram для привязки аккаунта:
              </p>
              <a
                href={telegramLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm text-blue-600 hover:underline break-all"
              >
                {telegramLink}
              </a>
              <p className="text-xs text-zinc-500">Ссылка действительна 15 минут</p>
              <button
                onClick={() => setTelegramLink(null)}
                className="text-xs text-zinc-500 hover:underline"
              >
                Закрыть
              </button>
            </div>
          )}

          {/* Yandex */}
          <ContactRowWithDetach
            label="Яндекс"
            value={profile.contacts.yandex?.email ?? null}
            icon="Y"
            iconBg="bg-red-500 text-white"
            channel="yandex"
            isAttached={!!profile.contacts.yandex}
            onDetach={() => setDetachConfirm("yandex")}
            onAttach={() => signIn("yandex", { callbackUrl: "/dashboard" })}
            attachLabel="Привязать Яндекс"
          />

          {/* Email */}
          <div className="flex items-center justify-between rounded-lg border border-zinc-100 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-lg">✉️</span>
              <div>
                <p className="text-sm font-medium text-zinc-700">Email</p>
                {profile.contacts.email ? (
                  <p className="text-xs text-zinc-500">{profile.contacts.email}</p>
                ) : (
                  <p className="text-xs text-zinc-400">Не привязан</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {profile.contacts.email && (
                <button
                  onClick={() => setDetachConfirm("email")}
                  className="text-xs text-red-500 hover:underline"
                >
                  Отвязать
                </button>
              )}
              {!profile.contacts.email && activeFlow !== "email" && (
                <button
                  onClick={() => setActiveFlow("email")}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Добавить
                </button>
              )}
            </div>
          </div>

          {/* Email flow */}
          {activeFlow === "email" && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-4 space-y-3">
              {!emailSent ? (
                <>
                  <p className="text-sm text-zinc-700">
                    Введите email — мы пришлём ссылку для подтверждения.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="your@email.com"
                      className="flex-1 max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      onKeyDown={(e) => e.key === "Enter" && handleEmailRequest()}
                    />
                    <button
                      onClick={handleEmailRequest}
                      disabled={emailLoading || !emailInput}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {emailLoading ? "..." : "Отправить"}
                    </button>
                    <button onClick={cancelFlow} className="text-xs text-zinc-500 hover:underline">Отмена</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-zinc-700">
                    Письмо отправлено. Откройте ссылку из письма — страница обновится автоматически.
                    <br />
                    Или введите токен вручную:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={emailToken}
                      onChange={(e) => setEmailToken(e.target.value)}
                      placeholder="Вставьте токен из ссылки"
                      className="flex-1 max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleEmailConfirm}
                      disabled={emailLoading || !emailToken}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {emailLoading ? "..." : "Подтвердить"}
                    </button>
                    <button onClick={cancelFlow} className="text-xs text-zinc-500 hover:underline">Отмена</button>
                  </div>
                </>
              )}
              {emailError && <p className="text-xs text-red-500">{emailError}</p>}
            </div>
          )}

          {/* Phone */}
          <div className="flex items-center justify-between rounded-lg border border-zinc-100 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-lg">📱</span>
              <div>
                <p className="text-sm font-medium text-zinc-700">Телефон (WhatsApp)</p>
                {profile.contacts.phone ? (
                  <p className="text-xs text-zinc-500">{profile.contacts.phone}</p>
                ) : (
                  <p className="text-xs text-zinc-400">Не привязан</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {profile.contacts.phone && (
                <button
                  onClick={() => setDetachConfirm("phone")}
                  className="text-xs text-red-500 hover:underline"
                >
                  Отвязать
                </button>
              )}
              {!profile.contacts.phone && activeFlow !== "phone" && (
                <button
                  onClick={() => setActiveFlow("phone")}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Добавить
                </button>
              )}
            </div>
          </div>

          {/* Phone flow */}
          {activeFlow === "phone" && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-4 space-y-3">
              {!phoneSent ? (
                <>
                  <p className="text-sm text-zinc-700">
                    Введите номер телефона — пришлём код в WhatsApp.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="tel"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      placeholder="+79001234567"
                      className="flex-1 max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      onKeyDown={(e) => e.key === "Enter" && handlePhoneRequest()}
                    />
                    <button
                      onClick={handlePhoneRequest}
                      disabled={phoneLoading || !phoneInput}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {phoneLoading ? "..." : "Получить код"}
                    </button>
                    <button onClick={cancelFlow} className="text-xs text-zinc-500 hover:underline">Отмена</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-zinc-700">
                    Код отправлен в WhatsApp на номер{" "}
                    <span className="font-medium">{phoneMasked}</span>.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={phoneCode}
                      onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="Код из WhatsApp"
                      maxLength={6}
                      className="w-36 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-center font-mono tracking-widest focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      onKeyDown={(e) => e.key === "Enter" && handlePhoneConfirm()}
                    />
                    <button
                      onClick={handlePhoneConfirm}
                      disabled={phoneLoading || phoneCode.length !== 6}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {phoneLoading ? "..." : "Подтвердить"}
                    </button>
                    <button onClick={cancelFlow} className="text-xs text-zinc-500 hover:underline">Отмена</button>
                  </div>
                </>
              )}
              {phoneError && <p className="text-xs text-red-500">{phoneError}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Detach confirmation modal */}
      {detachConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-zinc-900">Отвязать канал?</h3>
            <p className="mt-2 text-sm text-zinc-600">
              Вы уверены? Вы не сможете войти через этот канал после отвязки.
            </p>
            {detachError && (
              <p className="mt-2 text-sm text-red-500">{detachError}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => handleDetach(detachConfirm)}
                disabled={detachLoading}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {detachLoading ? "Отвязка..." : "Отвязать"}
              </button>
              <button
                onClick={() => { setDetachConfirm(null); setDetachError(""); }}
                className="flex-1 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ContactRowWithDetach({
  label,
  value,
  icon,
  iconBg,
  isAttached,
  onDetach,
  onAttach,
  attachLabel,
  attachLoading,
}: {
  label: string;
  value: string | null;
  icon: string;
  iconBg?: string;
  channel: string;
  isAttached: boolean;
  onDetach: () => void;
  onAttach: () => void;
  attachLabel: string;
  attachLoading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-100 px-4 py-3">
      <div className="flex items-center gap-3">
        {iconBg ? (
          <span className={`flex h-7 w-7 items-center justify-center rounded text-xs font-bold ${iconBg}`}>
            {icon}
          </span>
        ) : (
          <span className="text-lg">{icon}</span>
        )}
        <div>
          <p className="text-sm font-medium text-zinc-700">{label}</p>
          {value ? (
            <p className="text-xs text-zinc-500">{value}</p>
          ) : (
            <p className="text-xs text-zinc-400">Не привязан</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isAttached && (
          <button
            onClick={onDetach}
            className="text-xs text-red-500 hover:underline"
          >
            Отвязать
          </button>
        )}
        {!isAttached && (
          <button
            onClick={onAttach}
            disabled={attachLoading}
            className="text-xs text-blue-600 hover:underline disabled:opacity-50"
          >
            {attachLoading ? "..." : attachLabel}
          </button>
        )}
      </div>
    </div>
  );
}
