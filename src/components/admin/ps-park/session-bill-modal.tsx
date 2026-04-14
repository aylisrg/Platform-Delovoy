"use client";

import { useState } from "react";
import type { BookingBill } from "@/modules/ps-park/types";

export type PaymentMethod = "CASH" | "CARD";

type SessionBillModalProps = {
  bill: BookingBill;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (paymentMethod: PaymentMethod) => void;
  confirming: boolean;
};

export function SessionBillModal({
  bill,
  isOpen,
  onClose,
  onConfirm,
  confirming,
}: SessionBillModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");

  if (!isOpen) return null;

  const hasItems = bill.items.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-base font-semibold text-zinc-900">
            Итоговый чек
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Session info */}
        <div className="px-6 pb-4">
          <div className="rounded-lg bg-zinc-50 border border-zinc-100 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-900">{bill.resourceName}</span>
              <span className="text-xs text-zinc-500">{bill.date}</span>
            </div>
            <p className="text-sm text-zinc-600">{bill.clientName}</p>
            <p className="text-xs text-zinc-500">
              Время: {bill.startTime} — {bill.endTime}
            </p>
          </div>
        </div>

        {/* Detailed breakdown */}
        <div className="px-6 pb-4">
          <div className="border border-zinc-200 rounded-xl overflow-hidden">
            {/* Section: Rental */}
            <div className="bg-zinc-50 px-4 py-2">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Аренда</span>
            </div>
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-start justify-between text-sm">
                <div>
                  <p className="text-zinc-900">{bill.resourceName}</p>
                  <p className="text-xs text-zinc-500">
                    {bill.hoursBooked} ч. x {bill.pricePerHour.toLocaleString("ru-RU")} ₽/ч
                  </p>
                </div>
                <span className="font-medium text-zinc-900 tabular-nums whitespace-nowrap">
                  {bill.hoursCost.toLocaleString("ru-RU")} ₽
                </span>
              </div>
            </div>

            {/* Section: Items */}
            {hasItems && (
              <>
                <div className="bg-zinc-50 px-4 py-2 border-t border-zinc-200">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Товары и услуги ({bill.items.length})
                  </span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {bill.items.map((item, idx) => (
                    <div key={item.skuId + idx} className="flex items-start justify-between text-sm">
                      <div>
                        <p className="text-zinc-900">{item.skuName}</p>
                        <p className="text-xs text-zinc-500">
                          {item.quantity} x {item.price.toLocaleString("ru-RU")} ₽
                        </p>
                      </div>
                      <span className="font-medium text-zinc-900 tabular-nums whitespace-nowrap">
                        {item.subtotal.toLocaleString("ru-RU")} ₽
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Subtotals */}
            <div className="border-t border-zinc-200 px-4 py-3 space-y-1.5 bg-zinc-50/50">
              <div className="flex justify-between text-sm text-zinc-600">
                <span>Аренда</span>
                <span className="tabular-nums">{bill.hoursCost.toLocaleString("ru-RU")} ₽</span>
              </div>
              {hasItems && (
                <div className="flex justify-between text-sm text-zinc-600">
                  <span>Товары</span>
                  <span className="tabular-nums">{bill.itemsTotal.toLocaleString("ru-RU")} ₽</span>
                </div>
              )}
            </div>

            {/* Grand total */}
            <div className="border-t-2 border-zinc-300 px-4 py-3 bg-white">
              <div className="flex justify-between items-center">
                <span className="text-base font-bold text-zinc-900">ИТОГО</span>
                <span className="text-xl font-bold text-zinc-900 tabular-nums">
                  {bill.totalBill.toLocaleString("ru-RU")} ₽
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Payment method */}
        <div className="px-6 pb-4">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
            Способ оплаты
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPaymentMethod("CASH")}
              className={`flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all ${
                paymentMethod === "CASH"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
              }`}
            >
              <span className="text-lg">💵</span>
              Наличные
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod("CARD")}
              className={`flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all ${
                paymentMethod === "CARD"
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
              }`}
            >
              <span className="text-lg">💳</span>
              Безналичные
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-6 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => onConfirm(paymentMethod)}
            disabled={confirming}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {confirming ? "Завершение..." : "Завершить сессию"}
          </button>
        </div>
      </div>
    </div>
  );
}
