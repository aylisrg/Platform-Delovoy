"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsersList } from "./users-list";
import { ClientsPageContent } from "@/components/admin/clients/clients-page-content";

type Tab = "all" | "team" | "clients";

const TABS: { id: Tab; label: string; description: string }[] = [
  { id: "all", label: "Все", description: "Все пользователи системы" },
  { id: "team", label: "Команда", description: "Суперадмины и менеджеры" },
  { id: "clients", label: "Клиенты", description: "Клиенты с бронированиями и заказами" },
];

export function UnifiedUsersPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get("tab") as Tab) || "all";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === "all") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", tab);
    }
    router.replace(url.pathname + url.search, { scroll: false });
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="border-b border-zinc-200">
        <nav className="flex gap-6" aria-label="Tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`relative pb-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-blue-600"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === "all" && <UsersList filterRole={undefined} />}
      {activeTab === "team" && <UsersList filterRole="team" />}
      {activeTab === "clients" && <ClientsPageContent />}
    </div>
  );
}
