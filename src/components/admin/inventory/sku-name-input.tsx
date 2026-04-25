"use client";

import { useEffect, useRef, useState } from "react";
import { searchSkus, type SkuInput, type SkuSearchCandidate, type MatchReason } from "@/lib/sku-search";

const REASON_LABELS: Record<MatchReason, string> = {
  exact:           "точное",
  substring:       "содержит",
  transliteration: "транслит.",
  fuzzy:           "похожее",
};

const REASON_COLORS: Record<MatchReason, string> = {
  exact:           "bg-green-100 text-green-700",
  substring:       "bg-blue-100 text-blue-700",
  transliteration: "bg-violet-100 text-violet-700",
  fuzzy:           "bg-zinc-100 text-zinc-500",
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Full list of active SKUs — fuzzy search runs client-side against this list */
  skus: SkuInput[];
  /** Called when user picks an existing SKU from suggestions */
  onSelectExisting: (sku: SkuInput) => void;
  placeholder?: string;
  className?: string;
  hasError?: boolean;
};

export function SkuNameInput({
  value,
  onChange,
  skus,
  onSelectExisting,
  placeholder = "Название *",
  className = "",
  hasError = false,
}: Props) {
  const [candidates, setCandidates] = useState<SkuSearchCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-run search whenever value or sku list changes (debounced)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const results = searchSkus(value, skus);
      setCandidates(results);
      setOpen(results.length > 0 && value.trim().length >= 2);
      setActiveIndex(-1);
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, skus]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, candidates.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(candidates[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function handleSelect(candidate: SkuSearchCandidate) {
    setOpen(false);
    onSelectExisting(candidate);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (candidates.length > 0 && value.trim().length >= 2) setOpen(true); }}
        placeholder={placeholder}
        className={`w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
          hasError ? "border-red-400 bg-red-50" : "border-zinc-300"
        } ${className}`}
        autoComplete="off"
      />

      {open && candidates.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          <div className="px-3 py-1.5 text-xs font-medium text-zinc-400 border-b border-zinc-100">
            Уже есть в базе — выберите или продолжите создание нового
          </div>
          <ul>
            {candidates.map((c, idx) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(c); }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    idx === activeIndex ? "bg-blue-50" : "hover:bg-zinc-50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-zinc-900">{c.name}</span>
                    <span className="ml-1.5 text-xs text-zinc-400">
                      {c.category} · {c.stockQuantity} {c.unit}
                    </span>
                  </div>
                  {c.matchReason !== "exact" && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${REASON_COLORS[c.matchReason]}`}
                    >
                      {REASON_LABELS[c.matchReason]}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="px-3 py-1.5 text-xs text-zinc-400 border-t border-zinc-100">
            ↑↓ навигация · Enter выбрать · Esc закрыть
          </div>
        </div>
      )}
    </div>
  );
}
