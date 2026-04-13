"use client";

import { useState } from "react";

type Tab = "overview" | "tenants" | "offices" | "contracts";

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Обзор" },
  { id: "tenants", label: "Арендаторы" },
  { id: "offices", label: "Помещения" },
  { id: "contracts", label: "Договоры" },
];

export function RentalTabs({
  children,
}: {
  children: Record<Tab, React.ReactNode>;
}) {
  const [active, setActive] = useState<Tab>("overview");

  return (
    <div>
      <div className="flex gap-1 border-b border-zinc-200 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
              active === tab.id
                ? "text-blue-600"
                : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            {tab.label}
            {active === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t" />
            )}
          </button>
        ))}
      </div>
      {children[active]}
    </div>
  );
}
