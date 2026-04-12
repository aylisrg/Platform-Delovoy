"use client";

import type { BookingBill } from "@/modules/ps-park/types";

type SessionBillModalProps = {
  bill: BookingBill;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirming: boolean;
};

export function SessionBillModal({
  bill,
  isOpen,
  onClose,
  onConfirm,
  confirming,
}: SessionBillModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-zinc-900">
            Завершение сессии
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="space-y-1 mb-4">
          <p className="text-sm font-medium text-zinc-900">{bill.resourceName}</p>
          <p className="text-sm text-zinc-600">
            Клиент: {bill.clientName}
          </p>
          <p className="text-sm text-zinc-500">
            {bill.date}, {bill.startTime} – {bill.endTime}
          </p>
        </div>

        <div className="border-t border-zinc-200 pt-3 space-y-2">
          {/* Hours cost */}
          <div className="flex justify-between text-sm">
            <span className="text-zinc-600">
              Аренда: {bill.hoursBooked} ч. x {bill.pricePerHour} ₽
            </span>
            <span className="font-medium text-zinc-900">
              {bill.hoursCost} ₽
            </span>
          </div>

          {/* Items */}
          {bill.items.length > 0 && (
            <>
              <div className="border-t border-zinc-100 pt-2">
                {bill.items.map((item) => (
                  <div
                    key={item.skuId}
                    className="flex justify-between text-sm py-0.5"
                  >
                    <span className="text-zinc-600">
                      {item.skuName} x{item.quantity}
                    </span>
                    <span className="text-zinc-700">{item.subtotal} ₽</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-sm border-t border-zinc-100 pt-2">
                <span className="text-zinc-500">Товары:</span>
                <span className="text-zinc-700">{bill.itemsTotal} ₽</span>
              </div>
            </>
          )}

          {/* Total */}
          <div className="flex justify-between text-base border-t-2 border-zinc-300 pt-3 mt-2">
            <span className="font-semibold text-zinc-900">ИТОГО:</span>
            <span className="font-bold text-zinc-900">
              {bill.totalBill.toLocaleString("ru-RU")} ₽
            </span>
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {confirming ? "Завершение..." : "Завершить"}
          </button>
        </div>
      </div>
    </div>
  );
}
