"use client";

/**
 * PWA install banner.
 *
 *  - Android/Chromium: используем `beforeinstallprompt` event, показываем
 *    кнопку «Установить» → `deferredPrompt.prompt()`.
 *  - iOS Safari: события нет, показываем инструкцию через 3s после mount
 *    (только если не в standalone-режиме).
 *  - Dismiss → `localStorage['pwa-banner-dismissed'] = '1'`, больше не показываем.
 */

import type * as React from "react";
import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "pwa-banner-dismissed";
const IOS_DELAY_MS = 3000;

type NavigatorWithStandalone = Navigator & { standalone?: boolean };
type WindowWithMSStream = Window & { MSStream?: unknown };

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  const nav = window.navigator as NavigatorWithStandalone;
  return nav.standalone === true;
}

function detectIOS(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const w = window as WindowWithMSStream;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !w.MSStream;
}

export function PWAInstallBanner(): React.JSX.Element | null {
  const [showBanner, setShowBanner] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isDismissed()) return;
    if (isStandalone()) return;

    const ios = detectIOS();
    setIsIOS(ios);

    if (ios) {
      const t = setTimeout(() => setShowBanner(true), IOS_DELAY_MS);
      return () => clearTimeout(t);
    }

    const onBeforeInstall = (e: Event): void => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, []);

  const dismiss = useCallback((): void => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setShowBanner(false);
  }, []);

  const handleInstall = useCallback(async (): Promise<void> => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setShowBanner(false);
      }
    } catch {
      // ignore
    } finally {
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  if (!showBanner) return null;

  return (
    <div className="fixed inset-x-3 bottom-[88px] z-40 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="text-sm font-semibold text-zinc-900">
            Установить приложение
          </div>
          {isIOS ? (
            <p className="mt-1 text-xs text-zinc-600">
              Нажмите кнопку «Поделиться» в Safari, затем выберите «На экран
              Домой» — приложение появится рядом с другими.
            </p>
          ) : (
            <p className="mt-1 text-xs text-zinc-600">
              Добавьте Деловой Парк на главный экран — быстрый доступ к чатам и
              бронированиям.
            </p>
          )}
          {!isIOS && deferredPrompt ? (
            <button
              type="button"
              onClick={handleInstall}
              className="mt-3 rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800"
            >
              Установить
            </button>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Скрыть"
          onClick={dismiss}
          className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
