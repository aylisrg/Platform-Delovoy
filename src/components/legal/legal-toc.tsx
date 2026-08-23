"use client";

import { useEffect, useState } from "react";

export type TocEntry = { id: string; label: string; level: 1 | 2 };

/**
 * Оглавление документа.
 *
 * ≥ 1024px — липкий столбец слева с подсветкой текущего раздела при скролле;
 * ниже — кнопка «Содержание» в нижнем правом углу, открывающая шторку
 * (ТЗ §4.2). Это одно и то же дерево ссылок в двух подачах, поэтому и
 * компонент один.
 */
export function LegalToc({ entries }: { entries: TocEntry[] }) {
  const [activeId, setActiveId] = useState<string | null>(entries[0]?.id ?? null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (entries.length === 0) return;

    const nodes = entries
      .map((e) => document.getElementById(e.id))
      .filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;

    /**
     * Активен последний раздел, чей заголовок уже прошёл верх экрана.
     *
     * Считаем по позициям, а не по факту пересечения: внутри длинного раздела
     * (а разделы здесь на несколько экранов) ни один заголовок в окне не
     * виден, и подсветка «по пересечению» замерла бы на предыдущем — ровно то,
     * что видно при переходе по прямой ссылке на глубокий пункт.
     */
    const recompute = () => {
      const line = 96; // под фиксированной шапкой
      let current = nodes[0];
      for (const node of nodes) {
        if (node.getBoundingClientRect().top <= line) current = node;
        else break;
      }
      setActiveId(current.id);
    };

    // IntersectionObserver — дешёвый триггер пересчёта: срабатывает на входе и
    // выходе заголовков из окна, а не на каждом пикселе прокрутки.
    const observer = new IntersectionObserver(recompute, { threshold: [0, 1] });
    nodes.forEach((n) => observer.observe(n));
    window.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("hashchange", recompute);
    recompute();

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", recompute);
      window.removeEventListener("hashchange", recompute);
    };
  }, [entries]);

  const links = (onNavigate?: () => void) => (
    <ul className="space-y-0.5">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            onClick={onNavigate}
            aria-current={activeId === entry.id ? "true" : undefined}
            className={`block rounded-md py-1.5 text-sm leading-snug transition-colors ${
              entry.level === 2 ? "pl-6 pr-2" : "px-2"
            } ${
              activeId === entry.id
                ? "bg-black/[0.05] text-[var(--foreground)] font-medium"
                : "text-[#5a5a5f] hover:text-[var(--foreground)] hover:bg-black/[0.03]"
            }`}
          >
            {entry.label}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {/* Десктоп: липкий столбец */}
      <nav
        aria-label="Содержание документа"
        className="legal-toc hidden lg:block w-[260px] shrink-0"
      >
        <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
          <p className="px-2 pb-2 text-xs uppercase tracking-wide text-[#86868b]">Содержание</p>
          {links()}
        </div>
      </nav>

      {/* Мобильный: кнопка + шторка */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="legal-toc-trigger lg:hidden fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-4 py-3 text-sm font-medium text-white shadow-lg"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
        Содержание
      </button>

      {sheetOpen && (
        <div className="legal-toc-trigger lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <button
            type="button"
            aria-label="Закрыть содержание"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div
            role="dialog"
            aria-label="Содержание документа"
            className="relative max-h-[75vh] overflow-y-auto rounded-t-2xl bg-[var(--background)] p-4 pb-8"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium">Содержание</p>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded-full p-2 text-[#86868b] hover:bg-black/[0.05]"
                aria-label="Закрыть"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            {links(() => setSheetOpen(false))}
          </div>
        </div>
      )}
    </>
  );
}
