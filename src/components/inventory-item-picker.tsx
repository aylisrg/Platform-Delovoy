"use client";

import { useState, useEffect, useCallback } from "react";

type SkuPublic = {
  id: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  stockQuantity: number;
  lowStockThreshold: number;
};

export type BookingItem = {
  skuId: string;
  quantity: number;
};

interface InventoryItemPickerProps {
  value: BookingItem[];
  onChange: (items: BookingItem[]) => void;
  /** Visual style: "default" for public pages, "compact" for admin forms */
  variant?: "default" | "compact";
}

export function InventoryItemPicker({
  value,
  onChange,
  variant = "default",
}: InventoryItemPickerProps) {
  const [skus, setSkus] = useState<SkuPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/api/inventory")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setSkus(d.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const getQty = useCallback(
    (skuId: string) => value.find((i) => i.skuId === skuId)?.quantity ?? 0,
    [value]
  );

  function setQty(skuId: string, qty: number) {
    const next = value.filter((i) => i.skuId !== skuId);
    if (qty > 0) next.push({ skuId, quantity: qty });
    onChange(next);
  }

  const selectedCount = value.reduce((s, i) => s + i.quantity, 0);
  const itemsTotal = value.reduce((s, item) => {
    const sku = skus.find((sk) => sk.id === item.skuId);
    return s + (sku ? Number(sku.price) * item.quantity : 0);
  }, 0);

  // Group by category
  const byCategory = skus.reduce<Record<string, SkuPublic[]>>((acc, sku) => {
    (acc[sku.category] ??= []).push(sku);
    return acc;
  }, {});

  if (variant === "compact") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-zinc-700">
            Товары к заказу
            {selectedCount > 0 && (
              <span className="ml-2 text-xs font-normal text-zinc-400">
                {selectedCount} поз. · {itemsTotal} ₽
              </span>
            )}
          </label>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            {expanded ? "Скрыть" : "Добавить товары"}
          </button>
        </div>

        {expanded && (
          <div className="rounded-lg border border-zinc-200 divide-y divide-zinc-100">
            {loading ? (
              <p className="text-xs text-zinc-400 p-3">Загрузка...</p>
            ) : skus.length === 0 ? (
              <p className="text-xs text-zinc-400 p-3">Нет доступных товаров</p>
            ) : (
              Object.entries(byCategory).map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-xs font-medium text-zinc-500 px-3 pt-2 pb-1">{cat}</p>
                  {items.map((sku) => {
                    const qty = getQty(sku.id);
                    const isLow = sku.stockQuantity <= sku.lowStockThreshold;
                    const isOut = sku.stockQuantity === 0;
                    return (
                      <div key={sku.id} className="flex items-center justify-between px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-zinc-800 truncate block">{sku.name}</span>
                          <span className="text-xs text-zinc-400">
                            {Number(sku.price)} ₽ · {sku.unit}
                            {isOut && <span className="ml-1 text-red-500">нет в наличии</span>}
                            {!isOut && isLow && (
                              <span className="ml-1 text-amber-500">осталось {sku.stockQuantity}</span>
                            )}
                          </span>
                        </div>
                        <QuantityControl
                          qty={qty}
                          max={sku.stockQuantity}
                          disabled={isOut}
                          onChange={(q) => setQty(sku.id, q)}
                          size="sm"
                        />
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}

        {selectedCount > 0 && !expanded && (
          <div className="text-xs text-zinc-500 space-y-0.5">
            {value.map((item) => {
              const sku = skus.find((s) => s.id === item.skuId);
              if (!sku) return null;
              return (
                <div key={item.skuId} className="flex justify-between">
                  <span>{sku.name} × {item.quantity}</span>
                  <span>{Number(sku.price) * item.quantity} ₽</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Default variant (Apple-style for public pages)
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <span className="text-sm font-medium text-[#1d1d1f] font-[family-name:var(--font-inter)]">
            Напитки и закуски
          </span>
          {selectedCount > 0 ? (
            <span className="ml-2 text-xs text-[#86868b] font-[family-name:var(--font-inter)]">
              {selectedCount} позиций · {itemsTotal} ₽
            </span>
          ) : (
            <span className="ml-2 text-xs text-[#86868b] font-[family-name:var(--font-inter)]">
              необязательно
            </span>
          )}
        </div>
        <span className="text-[#86868b] text-sm font-[family-name:var(--font-inter)]">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="rounded-2xl border border-black/[0.08] overflow-hidden">
          {loading ? (
            <div className="px-5 py-4 text-sm text-[#86868b] font-[family-name:var(--font-inter)]">
              Загрузка...
            </div>
          ) : skus.length === 0 ? (
            <div className="px-5 py-4 text-sm text-[#86868b] font-[family-name:var(--font-inter)]">
              Нет доступных товаров
            </div>
          ) : (
            Object.entries(byCategory).map(([cat, items], ci) => (
              <div key={cat} className={ci > 0 ? "border-t border-black/[0.04]" : ""}>
                <p className="text-xs font-medium text-[#86868b] uppercase tracking-wide px-5 pt-3 pb-1 font-[family-name:var(--font-inter)]">
                  {cat}
                </p>
                {items.map((sku) => {
                  const qty = getQty(sku.id);
                  const isLow = sku.stockQuantity <= sku.lowStockThreshold;
                  const isOut = sku.stockQuantity === 0;
                  return (
                    <div
                      key={sku.id}
                      className="flex items-center justify-between px-5 py-3 border-t border-black/[0.03] first:border-0"
                    >
                      <div className="flex-1 min-w-0 pr-3">
                        <p className="text-sm text-[#1d1d1f] font-medium font-[family-name:var(--font-inter)] truncate">
                          {sku.name}
                        </p>
                        <p className="text-xs text-[#86868b] font-[family-name:var(--font-inter)] mt-0.5">
                          {Number(sku.price)} ₽
                          {isOut && <span className="ml-1.5 text-red-500">нет в наличии</span>}
                          {!isOut && isLow && (
                            <span className="ml-1.5 text-amber-500">осталось {sku.stockQuantity} {sku.unit}</span>
                          )}
                        </p>
                      </div>
                      <QuantityControl
                        qty={qty}
                        max={sku.stockQuantity}
                        disabled={isOut}
                        onChange={(q) => setQty(sku.id, q)}
                        size="md"
                      />
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}

      {/* Selected items summary (when collapsed) */}
      {!expanded && selectedCount > 0 && (
        <div className="space-y-1">
          {value.map((item) => {
            const sku = skus.find((s) => s.id === item.skuId);
            if (!sku) return null;
            return (
              <div
                key={item.skuId}
                className="flex justify-between text-xs font-[family-name:var(--font-inter)]"
              >
                <span className="text-[#86868b]">
                  {sku.name} × {item.quantity}
                </span>
                <span className="text-[#1d1d1f] font-medium">
                  {Number(sku.price) * item.quantity} ₽
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface QuantityControlProps {
  qty: number;
  max: number;
  disabled: boolean;
  onChange: (qty: number) => void;
  size: "sm" | "md";
}

function QuantityControl({ qty, max, disabled, onChange, size }: QuantityControlProps) {
  const btnClass =
    size === "sm"
      ? "w-6 h-6 text-xs rounded-md"
      : "w-8 h-8 text-sm rounded-xl";

  if (disabled) {
    return (
      <span className="text-xs text-[#86868b] font-[family-name:var(--font-inter)]">
        —
      </span>
    );
  }

  if (qty === 0) {
    return (
      <button
        type="button"
        onClick={() => onChange(1)}
        className={`${btnClass} bg-[#0071e3] text-white font-semibold flex items-center justify-center transition-colors hover:bg-[#0077ED] font-[family-name:var(--font-inter)]`}
      >
        +
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        className={`${btnClass} bg-[#1d1d1f]/[0.08] text-[#1d1d1f] font-semibold flex items-center justify-center transition-colors hover:bg-[#1d1d1f]/[0.14] font-[family-name:var(--font-inter)]`}
      >
        −
      </button>
      <span
        className={`${size === "sm" ? "w-5 text-xs" : "w-6 text-sm"} text-center font-medium text-[#1d1d1f] font-[family-name:var(--font-inter)]`}
      >
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(qty + 1, max))}
        disabled={qty >= max}
        className={`${btnClass} bg-[#1d1d1f]/[0.08] text-[#1d1d1f] font-semibold flex items-center justify-center transition-colors hover:bg-[#1d1d1f]/[0.14] disabled:opacity-30 font-[family-name:var(--font-inter)]`}
      >
        +
      </button>
    </div>
  );
}

/** Convert BookingItem[] to API payload format */
export function itemsToPayload(items: BookingItem[]) {
  return items.length > 0 ? items : undefined;
}

/** Calculate items total from selected items and skus list */
export function calcItemsTotal(items: BookingItem[], skus: SkuPublic[]): number {
  return items.reduce((sum, item) => {
    const sku = skus.find((s) => s.id === item.skuId);
    return sum + (sku ? Number(sku.price) * item.quantity : 0);
  }, 0);
}
