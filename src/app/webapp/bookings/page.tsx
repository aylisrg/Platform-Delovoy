"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ApiFetchError,
  useTelegram,
} from "@/components/webapp/TelegramProvider";
import { BookingCard } from "@/components/webapp/BookingCard";
import {
  Button,
  Card,
  EmptyState,
  Icon,
  SectionHeader,
  Skeleton,
} from "@/components/webapp/ui";

interface Booking {
  id: string;
  moduleSlug: string;
  resourceName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
}

/** Открытый диалог отмены: обычное подтверждение или подтверждение штрафа. */
interface CancelDialog {
  booking: Booking;
  /** null — сервер ещё не запрашивал штраф; число — сумма удержания (402) */
  penaltyAmount: number | null;
  /** true — штраф запрошен, но сумму сервер не прислал */
  penaltyUnknown: boolean;
}

const MONTHS_SHORT = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/**
 * Сумма штрафа из `error.metadata` ответа 402 PENALTY_CONFIRMATION_REQUIRED
 * (`{ penaltyAmount, basePrice }` — см. DELETE /api/webapp/bookings).
 */
function readPenaltyAmount(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const amount = (data as { penaltyAmount?: unknown }).penaltyAmount;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : null;
}

export default function BookingsPage() {
  const { ready, user, apiFetch, showBackButton, onBackButtonClick, haptic } =
    useTelegram();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  // "expired" (401 — сессия истекла) отличаем от "generic": пустой список
  // без объяснения выглядит как «броней нет» и обманывает (QA 2026-08-13, №1)
  const [loadError, setLoadError] = useState<"expired" | "generic" | null>(null);
  const [dialog, setDialog] = useState<CancelDialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Кнопка «назад» Telegram закрывает диалог, а не уводит с экрана.
  // Ref — чтобы не перерегистрировать обработчик на каждое открытие.
  const dialogOpenRef = useRef(false);
  useEffect(() => {
    dialogOpenRef.current = dialog !== null;
  }, [dialog]);

  useEffect(() => {
    showBackButton(true);
    onBackButtonClick(() => {
      if (dialogOpenRef.current) {
        setDialog(null);
        setDialogError(null);
        return;
      }
      window.history.back();
    });
    return () => showBackButton(false);
  }, [showBackButton, onBackButtonClick]);

  const loadBookings = useCallback(async () => {
    if (!ready || !user) return;
    try {
      const data = await apiFetch<Booking[]>("/api/webapp/bookings");
      setBookings(data);
      setLoadError(null);
    } catch (e) {
      setBookings([]);
      setLoadError(
        e instanceof ApiFetchError && e.status === 401 ? "expired" : "generic"
      );
    } finally {
      setLoading(false);
    }
  }, [ready, user, apiFetch]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  const closeDialog = () => {
    if (busy) return;
    haptic.impact("light");
    setDialog(null);
    setDialogError(null);
  };

  /** Шаг 1 — тап по «Отменить бронь» на карточке: свой диалог, не showConfirm. */
  const handleCancel = (id: string) => {
    const booking = bookings.find((b) => b.id === id);
    if (!booking) return;
    setDialogError(null);
    setDialog({ booking, penaltyAmount: null, penaltyUnknown: false });
  };

  /**
   * Шаг 2 — DELETE. Ответ 402 PENALTY_CONFIRMATION_REQUIRED не тупик (AC-4.3):
   * диалог остаётся открытым и превращается в подтверждение штрафа, повторный
   * запрос уходит с `confirmPenalty: true`.
   */
  const runCancel = async (booking: Booking, confirmPenalty: boolean) => {
    setBusy(true);
    setDialogError(null);
    haptic.impact("medium");
    try {
      await apiFetch("/api/webapp/bookings", {
        method: "DELETE",
        body: JSON.stringify(
          confirmPenalty
            ? { bookingId: booking.id, confirmPenalty: true }
            : { bookingId: booking.id }
        ),
      });
      haptic.notification("success");
      setDialog(null);
      await loadBookings();
    } catch (e) {
      if (
        e instanceof ApiFetchError &&
        e.code === "PENALTY_CONFIRMATION_REQUIRED"
      ) {
        const amount = readPenaltyAmount(e.data);
        haptic.notification("warning");
        setDialog({
          booking,
          penaltyAmount: amount,
          penaltyUnknown: amount === null,
        });
        return;
      }
      haptic.notification("error");
      // 401 — не показываем английскую серверную строку в русском UI
      setDialogError(
        e instanceof ApiFetchError && e.status === 401
          ? "Сессия истекла — закройте и снова откройте приложение из Telegram"
          : e instanceof Error
            ? e.message
            : "Не удалось отменить бронь"
      );
    } finally {
      setBusy(false);
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
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <EmptyState
          icon="user"
          title="Нужен вход"
          hint="Откройте Mini App через Telegram, чтобы увидеть свои брони"
        />
      </div>
    );
  }

  const penaltyMode =
    dialog !== null && (dialog.penaltyAmount !== null || dialog.penaltyUnknown);
  // Сумма приходит в metadata 402; если сервер её не прислал — говорим «штраф»,
  // но кнопку подтверждения всё равно показываем (иначе сценарий — тупик).
  const penaltyAmountText =
    dialog && dialog.penaltyAmount !== null
      ? `${dialog.penaltyAmount.toLocaleString("ru-RU")} ₽`
      : null;
  const penaltyMessage = penaltyAmountText
    ? `Отмена позже допустимого срока — удерживается ${penaltyAmountText}. Подтвердите, если всё равно хотите отменить.`
    : "Отмена позже допустимого срока — удерживается штраф. Подтвердите, если всё равно хотите отменить.";
  const penaltyConfirmLabel = penaltyAmountText
    ? `Отменить с штрафом ${penaltyAmountText}`
    : "Отменить со штрафом";

  return (
    <div className="tg-page-enter">
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-[24px] font-bold">Мои бронирования</h1>
      </div>

      {loading ? (
        <div className="px-4 space-y-3 mt-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : loadError === "expired" ? (
        <EmptyState
          icon="alert"
          title="Сессия истекла"
          hint="Закройте и снова откройте приложение из Telegram, чтобы увидеть свои брони"
        />
      ) : loadError === "generic" ? (
        <EmptyState
          icon="alert"
          title="Не удалось загрузить брони"
          hint="Проверьте соединение и попробуйте ещё раз"
          action={
            <button
              type="button"
              className="tg-button"
              onClick={() => {
                haptic.impact("light");
                setLoading(true);
                loadBookings();
              }}
            >
              Обновить
            </button>
          }
        />
      ) : bookings.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Пока нет бронирований"
          hint="Забронируйте беседку с мангалом или зал в Плей Парке"
          action={
            <Link
              href="/webapp/gazebos"
              className="tg-button"
              onClick={() => haptic.impact("light")}
            >
              Выбрать беседку
            </Link>
          }
        />
      ) : (
        <div className="px-4 mt-2 space-y-4 pb-4">
          {/* Active */}
          {activeBookings.length > 0 && (
            <div>
              <SectionHeader>Активные</SectionHeader>
              <div className="space-y-3 mt-2">
                {activeBookings.map((b) => (
                  <BookingCard key={b.id} {...b} onCancel={handleCancel} />
                ))}
              </div>
            </div>
          )}

          {/* Past */}
          {pastBookings.length > 0 && (
            <div>
              <SectionHeader>История</SectionHeader>
              <div className="space-y-3 mt-2">
                {pastBookings.map((b) => (
                  <BookingCard key={b.id} {...b} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Диалог отмены — свой, на Card: Telegram showConfirm не умеет показать
          сумму штрафа и молчит вне Telegram (AC-4.3) */}
      {dialog && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-dialog-title"
        >
          <button
            type="button"
            aria-label="Закрыть"
            className="absolute inset-0"
            style={{ background: "rgba(0, 0, 0, 0.45)" }}
            onClick={closeDialog}
          />

          <Card
            className="relative w-full max-w-md m-3 p-5 tg-page-enter"
            style={{
              paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
            }}
          >
            <div className="flex items-start gap-3">
              <span
                className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0"
                style={{
                  background: penaltyMode
                    ? "color-mix(in srgb, var(--tg-destructive) 14%, transparent)"
                    : "var(--tg-secondary-bg)",
                  color: penaltyMode
                    ? "var(--tg-destructive)"
                    : "var(--tg-accent)",
                }}
              >
                <Icon name={penaltyMode ? "alert" : "calendar"} size={22} />
              </span>

              <div className="flex-1 min-w-0">
                <p id="cancel-dialog-title" className="text-[17px] font-semibold">
                  {penaltyMode ? "Отмена со штрафом" : "Отменить бронирование?"}
                </p>
                <p
                  className="mt-1 text-[14px] leading-snug"
                  style={{ color: "var(--tg-subtitle)" }}
                >
                  {dialog.booking.resourceName} ·{" "}
                  {formatDateShort(dialog.booking.date)} ·{" "}
                  {dialog.booking.startTime} — {dialog.booking.endTime}
                </p>
              </div>
            </div>

            <p className="mt-3 text-[14px] leading-relaxed">
              {penaltyMode
                ? penaltyMessage
                : "Бронь будет отменена, слот освободится для других гостей."}
            </p>

            {dialogError && (
              <div
                className="mt-3 flex items-start gap-2 text-[14px] font-medium"
                style={{ color: "var(--tg-destructive)" }}
              >
                <span className="shrink-0 mt-0.5">
                  <Icon name="alert" size={16} />
                </span>
                <span>{dialogError}</span>
              </div>
            )}

            <div className="mt-5 space-y-3">
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => runCancel(dialog.booking, penaltyMode)}
              >
                {busy
                  ? "Отменяем..."
                  : penaltyMode
                    ? penaltyConfirmLabel
                    : "Отменить бронь"}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={closeDialog}>
                Оставить бронь
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
