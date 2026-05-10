"use client";

/**
 * Кнопка «Включить уведомления в браузере» для админки.
 *
 * Покрывает PRD US-5/US-6, ADR §UI компонент.
 *
 * Состояния:
 *   - unsupported          → info-бейдж «Браузер не поддерживает Web Push»
 *   - ios_not_pwa          → инструкция «Добавьте сайт на главный экран»
 *   - permission_default   → кнопка «Включить уведомления»
 *   - permission_denied    → инструкция «Разрешите в настройках браузера»
 *   - subscribed           → бейдж «Уведомления включены» + «Отключить»
 *   - error                → inline error message
 *
 * RBAC: компонент монтируется только на админских страницах. На всякий
 * случай дополнительно скрывает себя для USER через useSession() — на
 * случай если кто-то вставит компонент в неожиданном месте.
 */

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  defaultWebPushApi,
  detectSupport,
  performSubscribe,
  performUnsubscribe,
  type SupportState,
} from "./web-push-utils";

type UiState =
  | { kind: "loading" }
  | { kind: "unsupported"; reason: SupportState }
  | { kind: "default" }
  | { kind: "denied" }
  | { kind: "subscribing" }
  | { kind: "subscribed" }
  | { kind: "unsubscribing" }
  | { kind: "error"; message: string };

export function WebPushOptIn() {
  const { data: session, status } = useSession();
  const [state, setState] = useState<UiState>({ kind: "loading" });

  // Initial detection: support + permission + existing subscription.
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const support = detectSupport(
        typeof navigator !== "undefined" ? navigator : undefined,
        typeof window !== "undefined" ? window : undefined,
      );
      if (support !== "supported") {
        if (!cancelled) setState({ kind: "unsupported", reason: support });
        return;
      }
      const permission = Notification.permission;
      if (permission === "denied") {
        if (!cancelled) setState({ kind: "denied" });
        return;
      }
      // Проверим, нет ли уже активной подписки.
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const existing = reg ? await reg.pushManager.getSubscription() : null;
        if (existing && permission === "granted") {
          if (!cancelled) setState({ kind: "subscribed" });
          return;
        }
      } catch {
        // ignore — упадём в default.
      }
      if (!cancelled) setState({ kind: "default" });
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubscribe = useCallback(async () => {
    setState({ kind: "subscribing" });
    try {
      await performSubscribe({
        api: defaultWebPushApi,
        serviceWorker: navigator.serviceWorker,
        pushManagerSubscribe: (reg, options) => reg.pushManager.subscribe(options),
        requestPermission: () => Notification.requestPermission(),
        userAgent: navigator.userAgent,
      });
      setState({ kind: "subscribed" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка";
      // Специальные коды.
      if (message === "permission:denied") {
        setState({ kind: "denied" });
        return;
      }
      if (message.startsWith("vapid-key:503")) {
        setState({
          kind: "error",
          message: "Web Push временно недоступен на сервере",
        });
        return;
      }
      setState({
        kind: "error",
        message: `Не удалось подписаться: ${message}`,
      });
    }
  }, []);

  const handleUnsubscribe = useCallback(async () => {
    setState({ kind: "unsubscribing" });
    try {
      await performUnsubscribe({
        api: defaultWebPushApi,
        serviceWorker: navigator.serviceWorker,
      });
      setState({ kind: "default" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка";
      setState({
        kind: "error",
        message: `Не удалось отключить: ${message}`,
      });
    }
  }, []);

  // RBAC guard — USER не должен видеть компонент.
  if (status === "loading") return null;
  if (!session?.user) return null;
  if (session.user.role === "USER") return null;

  if (state.kind === "loading") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
        Проверка поддержки уведомлений…
      </div>
    );
  }

  if (state.kind === "unsupported") {
    if (state.reason === "ios_not_pwa") {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <div className="font-medium text-amber-900">
            Push-уведомления на iPhone
          </div>
          <p className="mt-1 text-amber-800">
            Чтобы получать уведомления на iPhone, установите сайт на главный
            экран: нажмите «Поделиться» → «На экран Домой». После открытия
            установленного приложения вернитесь сюда и включите уведомления.
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
        Этот браузер не поддерживает push-уведомления.
      </div>
    );
  }

  if (state.kind === "denied") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-medium">Уведомления заблокированы</div>
        <p className="mt-1">
          Вы запретили уведомления для этого сайта. Откройте настройки сайта в
          браузере и разрешите уведомления, затем перезагрузите страницу.
        </p>
      </div>
    );
  }

  if (state.kind === "subscribed") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500"
          />
          <span className="font-medium text-emerald-900">
            Push-уведомления включены
          </span>
        </div>
        <button
          type="button"
          onClick={handleUnsubscribe}
          className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
        >
          Отключить
        </button>
      </div>
    );
  }

  if (state.kind === "subscribing" || state.kind === "unsubscribing") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
        {state.kind === "subscribing" ? "Подписываем…" : "Отключаем…"}
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
        <div className="font-medium text-red-900">Ошибка подписки</div>
        <p className="mt-1 text-red-800">{state.message}</p>
        <button
          type="button"
          onClick={handleSubscribe}
          className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-900 hover:bg-red-100"
        >
          Попробовать ещё раз
        </button>
      </div>
    );
  }

  // state.kind === "default"
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
      <div>
        <div className="font-medium text-zinc-900">
          Push-уведомления в браузере
        </div>
        <p className="mt-1 text-zinc-600">
          Получайте напоминания о просроченных сессиях и важных событиях прямо
          в браузере, даже когда вкладка свёрнута.
        </p>
      </div>
      <button
        type="button"
        onClick={handleSubscribe}
        className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800"
      >
        Включить
      </button>
    </div>
  );
}
