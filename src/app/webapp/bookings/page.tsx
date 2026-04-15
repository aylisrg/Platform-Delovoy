"use client";

import { useEffect, useState, useCallback } from "react";
import { useTelegram } from "@/components/webapp/TelegramProvider";
import { BookingCard } from "@/components/webapp/BookingCard";

interface Booking {
  id: string;
  moduleSlug: string;
  resourceName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
}

export default function BookingsPage() {
  const { ready, user, apiFetch, showBackButton, onBackButtonClick, haptic } =
    useTelegram();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    showBackButton(true);
    onBackButtonClick(() => window.history.back());
    return () => showBackButton(false);
  }, [showBackButton, onBackButtonClick]);

  const loadBookings = useCallback(async () => {
    if (!ready || !user) return;
    try {
      const data = await apiFetch<Booking[]>("/api/webapp/bookings");
      setBookings(data);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, [ready, user, apiFetch]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  const handleCancel = async (id: string) => {
    // Confirm via Telegram popup
    const webapp = window?.Telegram?.WebApp;
    if (webapp) {
      webapp.showConfirm("Отменить бронирование?", async (confirmed) => {
        if (!confirmed) return;
        try {
          await apiFetch("/api/webapp/bookings", {
            method: "DELETE",
            body: JSON.stringify({ bookingId: id }),
          });
          haptic.notification("success");
          loadBookings();
        } catch {
          haptic.notification("error");
        }
      });
    }
  };

  const activeBookings = bookings.filter(
    (b) => b.status === "PENDING" || b.status === "CONFIRMED" || b.status === "CHECKED_IN"
  );
  const pastBookings = bookings.filter(
    (b) => b.status === "COMPLETED" || b.status === "CANCELLED" || b.status === "NO_SHOW"
  );

  if (!ready || !user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[15px]" style={{ color: "var(--tg-hint)" }}>
          Авторизуйтесь для просмотра бронирований
        </p>
      </div>
    );
  }

  return (
    <div className="tg-page-enter">
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-[24px] font-bold">Мои бронирования</h1>
      </div>

      {loading ? (
        <div className="px-4 space-y-3 mt-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="tg-skeleton h-28 rounded-2xl" />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <span className="text-5xl">📋</span>
          <p className="mt-4 text-[17px] font-semibold">Пока нет бронирований</p>
          <p className="mt-1 text-[14px]" style={{ color: "var(--tg-hint)" }}>
            Забронируйте беседку или стол в Плей Парке
          </p>
        </div>
      ) : (
        <div className="px-4 mt-2 space-y-4 pb-4">
          {/* Active */}
          {activeBookings.length > 0 && (
            <div>
              <p className="tg-section-header">Активные</p>
              <div className="space-y-3 mt-2">
                {activeBookings.map((b) => (
                  <BookingCard
                    key={b.id}
                    {...b}
                    onCancel={handleCancel}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Past */}
          {pastBookings.length > 0 && (
            <div>
              <p className="tg-section-header">История</p>
              <div className="space-y-3 mt-2">
                {pastBookings.map((b) => (
                  <BookingCard key={b.id} {...b} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
