"use client";

import { useEffect, useState } from "react";
import { useTelegram } from "@/components/webapp/TelegramProvider";
import { ResourceCard } from "@/components/webapp/ResourceCard";

interface GazeboResource {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  pricePerHour: string | null;
  isActive: boolean;
  metadata: Record<string, unknown> | null;
}

export default function GazebosListPage() {
  const { ready, apiFetch, showBackButton, onBackButtonClick } = useTelegram();
  const [resources, setResources] = useState<GazeboResource[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    showBackButton(true);
    onBackButtonClick(() => {
      window.history.back();
    });
    return () => showBackButton(false);
  }, [showBackButton, onBackButtonClick]);

  useEffect(() => {
    if (!ready) return;
    fetch("/api/gazebos")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setResources(data.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ready, apiFetch]);

  return (
    <div className="tg-page-enter">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-[24px] font-bold">Барбекю Парк</h1>
        <p className="text-[14px] mt-0.5" style={{ color: "var(--tg-hint)" }}>
          Беседки с мангалом на природе
        </p>
      </div>

      {/* Resources */}
      <div className="px-4 mt-2 space-y-3 pb-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="tg-skeleton h-48 rounded-2xl" />
          ))
        ) : resources.length === 0 ? (
          <div className="text-center py-12">
            <span className="text-4xl">🏕</span>
            <p className="mt-3 text-[15px]" style={{ color: "var(--tg-hint)" }}>
              Пока нет доступных беседок
            </p>
          </div>
        ) : (
          resources.map((r) => (
            <ResourceCard
              key={r.id}
              id={r.id}
              name={r.name}
              description={r.description}
              capacity={r.capacity}
              pricePerHour={r.pricePerHour}
              imageUrl={(r.metadata as Record<string, string> | null)?.imageUrl}
              href={`/webapp/gazebos/${r.id}`}
            />
          ))
        )}
      </div>
    </div>
  );
}
