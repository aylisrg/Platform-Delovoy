"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { waitForWebApp } from "./telegram-bootstrap";
import {
  GUEST_CAPABILITIES,
  type WebAppCapabilities,
} from "@/lib/webapp/types";

interface WebAppUser {
  id: string;
  name: string | null;
  role: string;
  image: string | null;
  telegramId: string | null;
}

interface TelegramContextValue {
  ready: boolean;
  user: WebAppUser | null;
  token: string | null;
  /** Снимок прав для рендера навигации; staff-роуты перепроверяют из БД */
  capabilities: WebAppCapabilities;
  needsLinking: boolean;
  setNeedsLinking: (v: boolean) => void;
  setUser: (user: WebAppUser | null) => void;
  setToken: (token: string | null) => void;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  haptic: {
    impact: (style?: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notification: (type?: "error" | "success" | "warning") => void;
    selection: () => void;
  };
  showBackButton: (visible: boolean) => void;
  onBackButtonClick: (cb: () => void) => void;
  close: () => void;
  expand: () => void;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
}

/**
 * Типизированная ошибка apiFetch: сохраняет code/status/data ответа —
 * экраны различают, например, 402 PENALTY_CONFIRMATION_REQUIRED (AC-4.3),
 * а не получают безликое "API Error".
 */
export class ApiFetchError extends Error {
  readonly code: string;
  readonly status: number;
  readonly data: unknown;

  constructor(args: { code: string; message: string; status: number; data?: unknown }) {
    super(args.message);
    this.name = "ApiFetchError";
    this.code = args.code;
    this.status = args.status;
    this.data = args.data;
  }
}

const TelegramContext = createContext<TelegramContextValue | null>(null);

export function useTelegram() {
  const ctx = useContext(TelegramContext);
  if (!ctx) throw new Error("useTelegram must be used within TelegramProvider");
  return ctx;
}

// Safe access to Telegram WebApp — returns undefined outside Telegram
function getWebApp(): typeof window.Telegram.WebApp | undefined {
  if (typeof window === "undefined") return undefined;
  return window?.Telegram?.WebApp;
}

// Telegram theme is owned by Telegram itself (light/dark + accent colors). We
// expose it via useSyncExternalStore so React reads the SDK as a true external
// store — no setState-in-effect cascade when Telegram fires "themeChanged".
const SERVER_THEME_PARAMS: Record<string, string> = Object.freeze({});
let cachedColorScheme: "light" | "dark" = "light";
let cachedThemeParams: Record<string, string> = SERVER_THEME_PARAMS;

function paramsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

function refreshThemeCache(): boolean {
  const webapp = getWebApp();
  if (!webapp) return false;
  const nextScheme = webapp.colorScheme || "light";
  const nextParams = (webapp.themeParams as Record<string, string>) || SERVER_THEME_PARAMS;
  let changed = false;
  if (nextScheme !== cachedColorScheme) {
    cachedColorScheme = nextScheme;
    changed = true;
  }
  if (!paramsEqual(nextParams, cachedThemeParams)) {
    cachedThemeParams = { ...nextParams };
    changed = true;
  }
  return changed;
}

function subscribeTelegramTheme(callback: () => void): () => void {
  const webapp = getWebApp();
  if (!webapp?.onEvent) return () => {};
  const listener = () => {
    if (refreshThemeCache()) callback();
  };
  webapp.onEvent("themeChanged", listener);
  if (refreshThemeCache()) callback();
  return () => {
    webapp.offEvent?.("themeChanged", listener);
  };
}

const getColorSchemeSnapshot = (): "light" | "dark" => cachedColorScheme;
const getThemeParamsSnapshot = (): Record<string, string> => cachedThemeParams;
const getColorSchemeServerSnapshot = (): "light" | "dark" => "light";
const getThemeParamsServerSnapshot = (): Record<string, string> => SERVER_THEME_PARAMS;

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<WebAppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [capabilities, setCapabilities] =
    useState<WebAppCapabilities>(GUEST_CAPABILITIES);
  const [needsLinking, setNeedsLinking] = useState(false);
  const colorScheme = useSyncExternalStore(
    subscribeTelegramTheme,
    getColorSchemeSnapshot,
    getColorSchemeServerSnapshot,
  );
  const themeParams = useSyncExternalStore(
    subscribeTelegramTheme,
    getThemeParamsSnapshot,
    getThemeParamsServerSnapshot,
  );

  // Мост темы: полный набор themeParams → CSS-переменные (ADR §8.1).
  // Вне Telegram themeParams пуст — переменные снимаются, работают
  // light-дефолты из :root в webapp.css (AC-7.1).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const tp = themeParams;
    const hasTheme = Object.keys(tp).length > 0;
    const dark = colorScheme === "dark";

    const setVar = (name: string, value: string | undefined) => {
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    };

    setVar("--tg-bg", tp.bg_color);
    setVar("--tg-text", tp.text_color);
    setVar("--tg-hint", tp.hint_color);
    setVar("--tg-link", tp.link_color);
    setVar("--tg-button", tp.button_color);
    setVar("--tg-button-text", tp.button_text_color);
    setVar("--tg-secondary-bg", tp.secondary_bg_color);
    setVar("--tg-section-bg", tp.section_bg_color || tp.bg_color);
    setVar(
      "--tg-section-header-text",
      tp.section_header_text_color || tp.hint_color
    );
    setVar(
      "--tg-separator",
      tp.section_separator_color ||
        (hasTheme
          ? dark
            ? "rgba(255, 255, 255, 0.08)"
            : "rgba(0, 0, 0, 0.08)"
          : undefined)
    );
    setVar("--tg-subtitle", tp.subtitle_text_color || tp.hint_color);
    setVar("--tg-accent", tp.accent_text_color || tp.button_color);
    setVar("--tg-destructive", tp.destructive_text_color);
    setVar("--tg-header-bg", tp.header_bg_color || tp.bg_color);
    setVar("--tg-bottom-bar-bg", tp.bottom_bar_bg_color || tp.bg_color);
    root.dataset.tgScheme = colorScheme;

    // Синхронизация шапки/фона самого Telegram с темой (безопасная полировка).
    // Фон приложения — secondary_bg (нативные списки), шапка — в тон ему.
    const webapp = getWebApp();
    try {
      webapp?.setHeaderColor?.(tp.secondary_bg_color || "bg_color");
      if (tp.secondary_bg_color || tp.bg_color) {
        webapp?.setBackgroundColor?.(tp.secondary_bg_color || tp.bg_color);
      }
    } catch {
      // старые клиенты Telegram могут не поддерживать — молча пропускаем
    }
  }, [themeParams, colorScheme]);

  // Bootstrap: wait for the Telegram SDK (it can attach after hydration on iOS
  // Safari / Telegram WebView), tell Telegram we're ready, then authenticate
  // against our backend. If the SDK never attaches we still flip `ready` so the
  // UI degrades to guest mode instead of spinning forever.
  // Dev path / auth fetch are classic data-loading effects — the rule was
  // intentionally downgraded for exactly this pattern.
  useEffect(() => {
    let cancelled = false;

    const cancelWait = waitForWebApp(getWebApp, (webapp) => {
      if (cancelled) return;

      if (!webapp) {
        // SDK never attached — opened outside Telegram, or the script was
        // blocked/too slow. Render the app instead of an endless spinner.
        setReady(true);
        return;
      }

      webapp.ready();
      webapp.expand();

      const initData = webapp.initData;
      if (!initData) {
        // Dev mode — no initData available
        setReady(true);
        return;
      }

      fetch("/api/webapp/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          if (data.success) {
            setToken(data.data.token);
            setUser(data.data.user);
            if (data.data.capabilities) setCapabilities(data.data.capabilities);
            if (data.data.needsLinking) setNeedsLinking(true);
          }
          setReady(true);
        })
        .catch(() => {
          if (!cancelled) setReady(true);
        });
    });

    return () => {
      cancelled = true;
      cancelWait();
    };
  }, []);

  const haptic = {
    impact: (style: "light" | "medium" | "heavy" | "rigid" | "soft" = "medium") => {
      getWebApp()?.HapticFeedback?.impactOccurred(style);
    },
    notification: (type: "error" | "success" | "warning" = "success") => {
      getWebApp()?.HapticFeedback?.notificationOccurred(type);
    },
    selection: () => {
      getWebApp()?.HapticFeedback?.selectionChanged();
    },
  };

  const showBackButton = useCallback((visible: boolean) => {
    const webapp = getWebApp();
    if (!webapp?.BackButton) return;
    if (visible) webapp.BackButton.show();
    else webapp.BackButton.hide();
  }, []);

  const onBackButtonClick = useCallback((cb: () => void) => {
    getWebApp()?.BackButton?.onClick(cb);
  }, []);

  const close = useCallback(() => {
    getWebApp()?.close();
  }, []);

  const expand = useCallback(() => {
    getWebApp()?.expand();
  }, []);

  const apiFetch = useCallback(
    async <T = unknown>(url: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      headers.set("Content-Type", "application/json");

      const res = await fetch(url, { ...options, headers });
      const data = await res.json();

      if (!data.success) {
        throw new ApiFetchError({
          code: data.error?.code || "UNKNOWN",
          message: data.error?.message || "API Error",
          status: res.status,
          data: data.error?.metadata ?? data.error,
        });
      }

      return data.data as T;
    },
    [token]
  );

  return (
    <TelegramContext.Provider
      value={{
        ready,
        user,
        token,
        capabilities,
        needsLinking,
        setNeedsLinking,
        setUser,
        setToken,
        colorScheme,
        themeParams,
        haptic,
        showBackButton,
        onBackButtonClick,
        close,
        expand,
        apiFetch,
      }}
    >
      {/* Обёртка приложения: класс dark вешаем здесь, а не на <html>,
          чтобы не зацепить Tailwind dark:-варианты остального сайта */}
      <div
        className={
          colorScheme === "dark" ? "webapp-root dark" : "webapp-root"
        }
      >
        {children}
      </div>
    </TelegramContext.Provider>
  );
}
