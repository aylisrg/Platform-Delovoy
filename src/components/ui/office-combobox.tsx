"use client";

import { useEffect, useId, useRef, useState } from "react";

export type OfficeOption = {
  id: string;
  number: string;
  building: number;
  floor: number;
  status: "AVAILABLE" | "OCCUPIED" | "RESERVED";
};

interface OfficeComboboxProps {
  value: OfficeOption | null;
  onChange: (option: OfficeOption | null) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Override fetcher for tests. */
  fetcher?: (q: string, signal: AbortSignal) => Promise<OfficeOption[]>;
}

const DEBOUNCE_MS = 200;

const STATUS_LABEL: Record<OfficeOption["status"], string> = {
  AVAILABLE: "Свободен",
  OCCUPIED: "Занят",
  RESERVED: "Резерв",
};

function formatOption(o: OfficeOption): string {
  return `Корп. ${o.building}, эт. ${o.floor}, оф. ${o.number}`;
}

async function defaultFetcher(
  q: string,
  signal: AbortSignal
): Promise<OfficeOption[]> {
  const res = await fetch(
    `/api/rental/offices/search?q=${encodeURIComponent(q)}`,
    { signal }
  );
  if (!res.ok) return [];
  const json = await res.json();
  return json?.success ? (json.data as OfficeOption[]) : [];
}

export function OfficeCombobox({
  value,
  onChange,
  disabled,
  placeholder = "Начните вводить номер офиса",
  fetcher = defaultFetcher,
}: OfficeComboboxProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OfficeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listboxId = useId();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Debounced fetch
  useEffect(() => {
    if (value !== null) return; // do not search while a value is selected
    if (!query) {
      setResults([]);
      setLoading(false);
      return;
    }

    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const data = await fetcher(query, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setResults(data);
          setActiveIndex(0);
        }
      } catch {
        // AbortError or network — clear quietly
        if (!ctrl.signal.aborted) setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [query, fetcher, value]);

  function handleSelect(option: OfficeOption) {
    onChange(option);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function handleClear() {
    onChange(null);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (results[activeIndex]) {
        e.preventDefault();
        handleSelect(results[activeIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  // Selected state — show the picked office with a clear (×) button
  if (value) {
    return (
      <div ref={containerRef} className="relative">
        <div className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900">
          <span className="flex-1">{formatOption(value)}</span>
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            aria-label="Очистить выбор офиса"
            className="text-zinc-400 hover:text-zinc-700 transition-colors disabled:opacity-50"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listboxId}
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
      />
      {open && query && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-zinc-200 bg-white shadow-lg"
        >
          {loading && (
            <li className="px-3 py-2 text-sm text-zinc-500">Поиск...</li>
          )}
          {!loading && results.length === 0 && (
            <li className="px-3 py-2 text-sm text-zinc-500">
              Ничего не найдено
            </li>
          )}
          {!loading &&
            results.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => {
                  // mousedown so it fires before input blur
                  e.preventDefault();
                  handleSelect(o);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${
                  i === activeIndex
                    ? "bg-blue-50 text-blue-900"
                    : "text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                <span>{formatOption(o)}</span>
                <span className="ml-3 text-xs text-zinc-500">
                  {STATUS_LABEL[o.status]}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
