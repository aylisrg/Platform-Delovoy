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

  // Mirror current themeParams into CSS custom properties on <html>.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (themeParams.bg_color) root.style.setProperty("--tg-bg", themeParams.bg_color);
    if (themeParams.text_color) root.style.setProperty("--tg-text", themeParams.text_color);
    if (themeParams.hint_color) root.style.setProperty("--tg-hint", themeParams.hint_color);
    if (themeParams.link_color) root.style.setProperty("--tg-link", themeParams.link_color);
    if (themeParams.button_color) root.style.setProperty("--tg-button", themeParams.button_color);
    if (themeParams.button_text_color)
      root.style.setProperty("--tg-button-text", themeParams.button_text_color);
    if (themeParams.secondary_bg_color)
      root.style.setProperty("--tg-secondary-bg", themeParams.secondary_bg_color);
  }, [themeParams]);

  // Bootstrap: tell Telegram we're ready, then authenticate against our backend.
  useEffect(() => {
    const webapp = getWebApp();
    if (!webapp) return;

    webapp.ready();
    webapp.expand();

    const initData = webapp.initData;
    if (!initData) {
      // Dev mode — no initData available
      setReady(true);
      return;
    }

    let cancelled = false;
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
          if (data.data.needsLinking) setNeedsLinking(true);
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
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
        throw new Error(data.error?.message || "API Error");
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
      {children}
    </TelegramContext.Provider>
  );
}
