"use client";

import { useState } from "react";

/**
 * «Скопировать ссылку» на конкретный пункт.
 *
 * Кладёт в буфер полный URL с якорем: оператор поддержки должен уметь за две
 * секунды прислать клиенту ссылку прямо на п. 7.7 о переносе брони (ТЗ §4.2).
 */
export function CopyAnchorButton({ anchor, label }: { anchor: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}${window.location.pathname}#${anchor}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Буфер недоступен (нет https или отказано в разрешении) — тогда хотя бы
      // проставим якорь в адресной строке, ссылку можно скопировать оттуда.
      window.location.hash = anchor;
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="legal-copy inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[#86868b] hover:text-[var(--accent)] hover:bg-black/[0.04] transition-colors"
      title={`Скопировать ссылку на п. ${label}`}
      aria-label={`Скопировать ссылку на пункт ${label}`}
    >
      {copied ? (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span>скопировано</span>
        </>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )}
    </button>
  );
}
