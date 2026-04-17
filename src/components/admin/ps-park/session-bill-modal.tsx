"use client";

import { useState, useEffect } from "react";
import type { BookingBill } from "@/modules/ps-park/types";
import {
  DISCOUNT_REASONS,
  DISCOUNT_REASON_LABELS,
  type DiscountReason,
} from "@/modules/booking/discount";

export type PaymentSplit = {
  cashAmount: number;
  cardAmount: number;
  discountPercent?: number;
  discountReason?: string;
  discountNote?: string;
};

type SessionBillModalProps = {
  bill: BookingBill;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (split: PaymentSplit) => void;
  confirming: boolean;
  maxDiscountPercent?: number;
};

function formatMoney(n: number) {
  return n.toLocaleString("ru-RU") + " ₽";
}

function formatDuration(durationMin: number, billedHours: number) {
  const h = Math.floor(durationMin / 60);
  const m = durationMin % 60;
  const actual = h > 0 ? `${h}ч ${m > 0 ? m + "мин" : ""}`.trim() : `${m}мин`;
  const billed = billedHours % 1 === 0 ? `${billedHours}ч` : `${billedHours}ч`;
  return actual === billed ? actual : `${actual} → тариф ${billed}`;
}

export function SessionBillModal({
  bill,
  isOpen,
  onClose,
  onConfirm,
  confirming,
  maxDiscountPercent = 30,
}: SessionBillModalProps) {
  const originalTotal = bill.totalBill;

  // Discount state
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountReason, setDiscountReason] = useState<DiscountReason | "">("");
  const [discountNote, setDiscountNote] = useState("");

  const discountAmount = discountPercent > 0 ? Math.round(originalTotal * discountPercent / 100) : 0;
  const effectiveTotal = originalTotal - discountAmount;

  // Split payment state
  const [cashRaw, setCashRaw] = useState(String(effectiveTotal));
  const [cardRaw, setCardRaw] = useState("0");

  const cash = parseFloat(cashRaw) || 0;
  const card = parseFloat(cardRaw) || 0;
  const remainder = Math.round((effectiveTotal - cash - card) * 100) / 100;
  const isBalanced = Math.abs(remainder) < 0.01;

  // Reset when bill or discount changes
  useEffect(() => {
    setCashRaw(String(effectiveTotal));
    setCardRaw("0");
  }, [effectiveTotal]);

  // Reset discount when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setShowDiscount(false);
      setDiscountPercent(0);
      setDiscountReason("");
      setDiscountNote("");
    }
  }, [isOpen]);

  function handleCashChange(val: string) {
    setCashRaw(val);
    const parsed = parseFloat(val) || 0;
    const auto = Math.max(0, Math.round((effectiveTotal - parsed) * 100) / 100);
    setCardRaw(String(auto));
  }

  function handleCardChange(val: string) {
    setCardRaw(val);
    const parsed = parseFloat(val) || 0;
    const auto = Math.max(0, Math.round((effectiveTotal - parsed) * 100) / 100);
    setCashRaw(String(auto));
  }

  const discountValid = !showDiscount || discountPercent === 0 || (
    discountPercent > 0 &&
    discountPercent <= maxDiscountPercent &&
    discountReason !== "" &&
    (discountReason !== "other" || discountNote.length >= 5)
  );

  function handleConfirm() {
    const split: PaymentSplit = { cashAmount: cash, cardAmount: card };
    if (showDiscount && discountPercent > 0 && discountReason) {
      split.discountPercent = discountPercent;
      split.discountReason = discountReason;
      if (discountReason === "other" && discountNote) {
        split.discountNote = discountNote;
      }
    }
    onConfirm(split);
  }

  if (!isOpen) return null;
  const hasItems = bill.items.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl mx-4 overflow-hidden max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-base font-semibold text-zinc-900">Итоговый чек</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">×</button>
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
              {bill.startTime} — {bill.endTime}
              {" · "}
              <span className="font-medium">{formatDuration(bill.durationMin, bill.billedHours)}</span>
            </p>
          </div>
        </div>

        {/* Breakdown */}
        <div className="px-6 pb-4">
          <div className="border border-zinc-200 rounded-xl overflow-hidden">
            <div className="bg-zinc-50 px-4 py-2">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Аренда</span>
            </div>
            <div className="px-4 py-3">
              <div className="flex items-start justify-between text-sm">
                <div>
                  <p className="text-zinc-900">{bill.resourceName}</p>
                  <p className="text-xs text-zinc-500">
                    {bill.billedHours} ч. × {bill.pricePerHour.toLocaleString("ru-RU")} ₽/ч
                  </p>
                </div>
                <span className="font-medium text-zinc-900 tabular-nums whitespace-nowrap">
                  {bill.hoursCost.toLocaleString("ru-RU")} ₽
                </span>
              </div>
            </div>

            {hasItems && (
              <>
                <div className="bg-zinc-50 px-4 py-2 border-t border-zinc-200">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    Товары ({bill.items.length})
                  </span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {bill.items.map((item, idx) => (
                    <div key={item.skuId + idx} className="flex items-start justify-between text-sm">
                      <div>
                        <p className="text-zinc-900">{item.skuName}</p>
                        <p className="text-xs text-zinc-500">{item.quantity} × {item.price.toLocaleString("ru-RU")} ₽</p>
                      </div>
                      <span className="font-medium text-zinc-900 tabular-nums whitespace-nowrap">
                        {item.subtotal.toLocaleString("ru-RU")} ₽
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {hasItems && (
              <div className="border-t border-zinc-200 px-4 py-2.5 bg-zinc-50/50">
                <div className="flex justify-between text-sm text-zinc-600">
                  <span>Товары</span>
                  <span className="tabular-nums">{bill.itemsTotal.toLocaleString("ru-RU")} ₽</span>
                </div>
              </div>
            )}

            {/* Discount section */}
            {showDiscount && discountPercent > 0 && (
              <div className="border-t border-amber-200 px-4 py-2.5 bg-amber-50/50">
                <div className="flex justify-between text-sm text-amber-800">
                  <span>Скидка {discountPercent}%</span>
                  <span className="tabular-nums font-medium">−{discountAmount.toLocaleString("ru-RU")} ₽</span>
                </div>
              </div>
            )}

            {/* Grand total */}
            <div className="border-t-2 border-zinc-300 px-4 py-3 bg-white">
              <div className="flex justify-between items-center">
                <span className="text-base font-bold text-zinc-900">ИТОГ��</span>
                <div className="text-right">
                  {showDiscount && discountPercent > 0 && (
                    <span className="text-sm text-zinc-400 line-through mr-2 tabular-nums">
                      {formatMoney(originalTotal)}
                    </span>
                  )}
                  <span className="text-xl font-bold text-zinc-900 tabular-nums">
                    {formatMoney(effectiveTotal)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Discount toggle & form */}
        <div className="px-6 pb-4">
          {!showDiscount ? (
            <button
              type="button"
              onClick={() => setShowDiscount(true)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              + Применить скидку
            </button>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Скидка</span>
                <button
                  onClick={() => { setShowDiscount(false); setDiscountPercent(0); setDiscountReason(""); setDiscountNote(""); }}
                  className="text-xs text-zinc-500 hover:text-zinc-700"
                >
                  Убрать
                </button>
              </div>

              <div className="flex items-center gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">% (макс. {maxDiscountPercent})</label>
                  <input
                    type="number"
                    min={1}
                    max={maxDiscountPercent}
                    value={discountPercent || ""}
                    onChange={(e) => setDiscountPercent(Math.min(Number(e.target.value) || 0, maxDiscountPercent))}
                    className="w-20 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm tabular-nums focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    placeholder="0"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Причина</label>
                  <select
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value as DiscountReason)}
                    className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="">Выберите</option>
                    {DISCOUNT_REASONS.map((r) => (
                      <option key={r} value={r}>{DISCOUNT_REASON_LABELS[r]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {discountReason === "other" && (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Пояснение (мин. 5 символов)</label>
                  <textarea
                    value={discountNote}
                    onChange={(e) => setDiscountNote(e.target.value)}
                    maxLength={500}
                    rows={2}
                    className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                    placeholder="Укажите причину..."
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Split payment */}
        <div className="px-6 pb-4">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
            Оплата
          </p>
          <div className="rounded-xl border border-zinc-200 overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-zinc-200">
              {/* Cash */}
              <div className="p-3">
                <label className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 mb-1.5">
                  <span>💵</span> Наличные
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={effectiveTotal}
                    step={1}
                    value={cashRaw}
                    onChange={(e) => handleCashChange(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold tabular-nums focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400">₽</span>
                </div>
              </div>

              {/* Card */}
              <div className="p-3">
                <label className="flex items-center gap-1.5 text-xs font-medium text-blue-700 mb-1.5">
                  <span>💳</span> Безналичные
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={effectiveTotal}
                    step={1}
                    value={cardRaw}
                    onChange={(e) => handleCardChange(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-semibold tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400">₽</span>
                </div>
              </div>
            </div>

            {/* Balance indicator */}
            <div className={`px-4 py-2 flex items-center justify-between text-xs border-t ${
              isBalanced
                ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                : "bg-red-50 border-red-100 text-red-700"
            }`}>
              <span>{isBalanced ? "Сумма совпадает" : "Остаток не распределён"}</span>
              <span className="font-semibold tabular-nums">
                {isBalanced ? "✓" : `${remainder > 0 ? "+" : ""}${formatMoney(remainder)}`}
              </span>
            </div>
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
            onClick={handleConfirm}
            disabled={confirming || !isBalanced || !discountValid}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {confirming ? "Завершение..." : "Завершить сессию"}
          </button>
        </div>
      </div>
    </div>
  );
}
