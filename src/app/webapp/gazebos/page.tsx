"use client";

import { useCallback, useEffect, useState } from "react";
import { useTelegram } from "@/components/webapp/TelegramProvider";
import { ResourceCard } from "@/components/webapp/ResourceCard";
import { Button, EmptyState, Skeleton } from "@/components/webapp/ui";

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
  const { ready, showBackButton, onBackButtonClick } = useTelegram();
  const [resources, setResources] = useState<GazeboResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    showBackButton(true);
    onBackButtonClick(() => {
      window.history.back();
    });
    return () => showBackButton(false);
  }, [showBackButton, onBackButtonClick]);

  // Публичный список беседок — тот же запрос, что и раньше (логика не менялась).
  const load = useCallback(() => {
    fetch("/api/gazebos")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setResources(data.data);
          setFailed(false);
        } else {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  const retry = () => {
    setLoading(true);
    setFailed(false);
    load();
  };

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
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))
        ) : failed ? (
          <EmptyState
            icon="alert"
            title="Не удалось загрузить беседки"
            hint="Проверьте соединение и попробуйте ещё раз"
            action={<Button onClick={retry}>Обновить</Button>}
          />
        ) : resources.length === 0 ? (
          <EmptyState
            icon="tent"
            title="Пока нет доступных беседок"
            hint="Загляните позже — расписание парка обновляется"
          />
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
              icon="tent"
            />
          ))
        )}
      </div>
    </div>
  );
}
