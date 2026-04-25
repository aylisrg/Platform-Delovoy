"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "admin-theme";
const LOCAL_CHANGE_EVENT = "admin-theme:change";

type ThemeCtx = {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeCtx | null>(null);

export function useAdminTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useAdminTheme must be used inside AdminThemeProvider");
  return ctx;
}

// External theme store: localStorage + prefers-color-scheme.
// Cross-tab updates arrive via "storage" event; same-tab via custom event.
function subscribeTheme(callback: () => void): () => void {
  const handler = (e: Event) => {
    if (e instanceof StorageEvent && e.key !== null && e.key !== STORAGE_KEY) return;
    callback();
  };
  window.addEventListener("storage", handler);
  window.addEventListener(LOCAL_CHANGE_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(LOCAL_CHANGE_EVENT, handler);
  };
}

function getThemeSnapshot(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  } catch {
    // ignore
  }
  return "light";
}

function getThemeServerSnapshot(): Theme {
  return "light";
}

function persistTheme(t: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, t);
    window.dispatchEvent(new Event(LOCAL_CHANGE_EVENT));
  } catch {
    // ignore
  }
}

export function AdminThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );
  // FOUC guard: render hidden during the first client paint so SSR's
  // deterministic "light" doesn't flash before hydration syncs the real value.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    persistTheme(t);
  }, []);

  const toggle = useCallback(() => {
    persistTheme(theme === "dark" ? "light" : "dark");
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      <div
        className={`${theme === "dark" ? "admin-dark" : ""} flex h-[100dvh] lg:h-screen`}
        style={{ visibility: mounted ? "visible" : "hidden" }}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
