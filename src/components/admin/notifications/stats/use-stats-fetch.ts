"use client";

import { useEffect, useState } from "react";

/**
 * GET a statistics endpoint (`{ success, data | error }`) and keep the last
 * successful answer on screen while the next one loads (an error clears it).
 * State is only set from the request callbacks; a newer URL cancels the older
 * response (no races when the period is clicked quickly).
 */
export function useStatsFetch<T>(url: string): { data: T | null; error: string | null; loading: boolean } {
  const [result, setResult] = useState<{ url: string; data: T | null; error: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => res.json())
      .then((json: { success: boolean; data?: T; error?: { message?: string } }) => {
        if (cancelled) return;
        if (json.success && json.data !== undefined) setResult({ url, data: json.data, error: null });
        else setResult({ url, data: null, error: json.error?.message ?? "Не удалось загрузить статистику" });
      })
      .catch(() => {
        // Never leave numbers of another period on screen next to an error.
        if (!cancelled) setResult({ url, data: null, error: "Сеть недоступна" });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data: result?.data ?? null, error: result?.url === url ? result.error : null, loading: result?.url !== url };
}
