"use client";

import { useState } from "react";
import { ADMIN_HINTS } from "@/lib/admin-hints";

type Props = {
  sectionSlug: string;
};

export function AdminHelper({ sectionSlug }: Props) {
  const [open, setOpen] = useState(false);

  const section = ADMIN_HINTS[sectionSlug];
  if (!section) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-20 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition-colors"
        title="Подсказки"
      >
        ?
      </button>

      {/* Panel */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setOpen(false)}
          />
          <div className="fixed bottom-20 right-20 z-50 w-80 max-h-96 overflow-y-auto rounded-xl bg-white border border-zinc-200 shadow-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-zinc-900 text-sm">
                {section.sectionTitle}
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-400 hover:text-zinc-600 text-lg leading-none"
              >
                ×
              </button>
            </div>
            {section.hints.map((hint, i) => (
              <div key={i} className="space-y-1">
                <p className="text-sm font-medium text-zinc-800">
                  {hint.title}
                </p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  {hint.text}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
