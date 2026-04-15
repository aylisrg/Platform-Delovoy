"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
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

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<WebAppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [colorScheme, setColorScheme] = useState<"light" | "dark">("light");
  const [themeParams, setThemeParams] = useState<Record<string, string>>({});

  useEffect(() => {
    const webapp = getWebApp();
    if (!webapp) return;

    // Tell Telegram the app is ready to be shown
    webapp.ready();
    webapp.expand();

    // Apply theme
    setColorScheme(webapp.colorScheme || "light");
    setThemeParams((webapp.themeParams as Record<string, string>) || {});

    // Apply Telegram theme colors to CSS
    const tp = webapp.themeParams;
    if (tp) {
      const root = document.documentElement;
      if (tp.bg_color) root.style.setProperty("--tg-bg", tp.bg_color);
      if (tp.text_color) root.style.setProperty("--tg-text", tp.text_color);
      if (tp.hint_color) root.style.setProperty("--tg-hint", tp.hint_color);
      if (tp.link_color) root.style.setProperty("--tg-link", tp.link_color);
      if (tp.button_color) root.style.setProperty("--tg-button", tp.button_color);
      if (tp.button_text_color) root.style.setProperty("--tg-button-text", tp.button_text_color);
      if (tp.secondary_bg_color) root.style.setProperty("--tg-secondary-bg", tp.secondary_bg_color);
    }

    // Authenticate with our backend
    const initData = webapp.initData;
    if (initData) {
      fetch("/api/webapp/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setToken(data.data.token);
            setUser(data.data.user);
          }
          setReady(true);
        })
        .catch(() => {
          setReady(true);
        });
    } else {
      // Dev mode — no initData available
      setReady(true);
    }

    // Listen for theme changes
    webapp.onEvent("themeChanged", () => {
      setColorScheme(webapp.colorScheme || "light");
      setThemeParams((webapp.themeParams as Record<string, string>) || {});
    });
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
