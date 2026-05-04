"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// F5 ADR 2026-05-04-cafe-order-booking-link: minimal admin modal that lets a
// PS Park manager attach a cafe order to the active session. Reuses
// GET /api/cafe and POST /api/cafe/order — does not duplicate the public
// cart UI (no localStorage, no mobile-first layout).

type MenuItem = {
  id: string;
  category: string;
  name: string;
  price: string | number;
  isAvailable: boolean;
};

type Props = {
  bookingId: string;
  onCreated?: () => void;
};

export function CafeOrderButton({ bookingId, onCreated }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [qtyById, setQtyById] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingMenu(true);
    setError(null);
    fetch("/api/cafe")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success) {
          setMenu((data.data?.items ?? []).filter((i: MenuItem) => i.isAvailable));
        } else {
          setError(data.error?.message ?? "Не удалось загрузить меню");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Ошибка загрузки меню");
      })
      .finally(() => {
        if (!cancelled) setLoadingMenu(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function handleOpen() {
    setQtyById({});
    setError(null);
    setOpen(true);
  }

  function setQty(id: string, qty: number) {
    setQtyById((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  }

  async function handleSubmit() {
    const items = Object.entries(qtyById)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity }))
      .filter((i) => i.quantity > 0);
    if (items.length === 0) {
      setError("Выберите хотя бы одну позицию");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/cafe/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, bookingId }),
      });
      const data = await res.json();
      if (data.success) {
        setOpen(false);
        onCreated?.();
        router.refresh();
      } else {
        setError(data.error?.message ?? "Не удалось создать заказ");
      }
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setSubmitting(false);
    }
  }

  const total = menu.reduce(
    (sum, m) => sum + (qtyById[m.id] ?? 0) * Number(m.price),
    0
  );

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
      >
        + Кафе
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <h2 className="text-base font-semibold text-zinc-900">
                Добавить кафе-заказ
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-400 hover:text-zinc-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-3">
              {loadingMenu ? (
                <p className="text-sm text-zinc-500 py-6 text-center">
                  Загрузка меню...
                </p>
              ) : menu.length === 0 ? (
                <p className="text-sm text-zinc-500 py-6 text-center">
                  Меню пусто
                </p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {menu.map((item) => {
                    const qty = qtyById[item.id] ?? 0;
                    return (
                      <li
                        key={item.id}
                        className="flex items-center justify-between py-2"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-zinc-900 truncate">
                            {item.name}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {Number(item.price).toLocaleString("ru-RU")} ₽
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setQty(item.id, qty - 1)}
                            disabled={qty === 0}
                            className="h-7 w-7 rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-50 disabled:opacity-30"
                          >
                            −
                          </button>
                          <span className="w-6 text-center text-sm tabular-nums">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => setQty(item.id, qty + 1)}
                            className="h-7 w-7 rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                          >
                            +
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {error && (
              <p
                className="px-6 pb-2 text-sm text-red-600"
                role="alert"
              >
                {error}
              </p>
            )}

            <div className="border-t border-zinc-100 px-6 py-3 flex items-center justify-between">
              <span className="text-sm text-zinc-600">
                Итого:{" "}
                <span className="font-semibold tabular-nums text-zinc-900">
                  {total.toLocaleString("ru-RU")} ₽
                </span>
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || total === 0}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting ? "..." : "Создать"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
