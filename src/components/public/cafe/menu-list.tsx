"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CafeMenuItem } from "@/modules/cafe/types";

type CartItem = {
  menuItem: CafeMenuItem;
  quantity: number;
};

type Props = {
  items: CafeMenuItem[];
  categories: string[];
};

export function MenuList({ items, categories }: Props) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [deliveryTo, setDeliveryTo] = useState("");
  const [comment, setComment] = useState("");
  const [isOrdering, setIsOrdering] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const filtered = activeCategory
    ? items.filter((i) => i.category === activeCategory)
    : items;

  function addToCart(item: CafeMenuItem) {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItem.id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.menuItem.id === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { menuItem: item, quantity: 1 }];
    });
  }

  function removeFromCart(itemId: string) {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItem.id === itemId);
      if (existing && existing.quantity > 1) {
        return prev.map((c) =>
          c.menuItem.id === itemId ? { ...c, quantity: c.quantity - 1 } : c
        );
      }
      return prev.filter((c) => c.menuItem.id !== itemId);
    });
  }

  const totalAmount = cart.reduce(
    (sum, c) => sum + Number(c.menuItem.price) * c.quantity,
    0
  );

  async function submitOrder() {
    if (cart.length === 0) return;
    setIsOrdering(true);
    setMessage(null);

    try {
      const res = await fetch("/api/cafe/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((c) => ({
            menuItemId: c.menuItem.id,
            quantity: c.quantity,
          })),
          deliveryTo: deliveryTo || undefined,
          comment: comment || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setCart([]);
        setDeliveryTo("");
        setComment("");
        setMessage({ type: "success", text: "Заказ создан!" });
      } else {
        setMessage({ type: "error", text: data.error?.message ?? "Ошибка при создании заказа" });
      }
    } catch {
      setMessage({ type: "error", text: "Ошибка сети" });
    } finally {
      setIsOrdering(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
      {/* Menu */}
      <div className="lg:col-span-2">
        {/* Category filter */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setActiveCategory(null)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              !activeCategory
                ? "bg-blue-600 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            Все
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeCategory === cat
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Items */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filtered.map((item) => (
            <Card key={item.id}>
              <CardContent>
                <div className="flex items-start justify-between">
                  <h3 className="text-lg font-semibold text-zinc-900">{item.name}</h3>
                  <Badge variant="info">{item.category}</Badge>
                </div>
                {item.description && (
                  <p className="mt-1 text-sm text-zinc-500">{item.description}</p>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-medium text-zinc-900">
                    {Number(item.price)} ₽
                  </span>
                  <Button size="sm" onClick={() => addToCart(item)}>
                    В корзину
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Cart */}
      <div>
        <Card>
          <CardContent>
            <h3 className="text-lg font-semibold text-zinc-900 mb-4">Корзина</h3>
            {cart.length === 0 ? (
              <p className="text-sm text-zinc-400">Корзина пуста</p>
            ) : (
              <>
                <div className="space-y-3">
                  {cart.map((c) => (
                    <div key={c.menuItem.id} className="flex items-center justify-between text-sm">
                      <div className="flex-1">
                        <p className="text-zinc-900">{c.menuItem.name}</p>
                        <p className="text-zinc-500">
                          {Number(c.menuItem.price)} ₽ × {c.quantity}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => removeFromCart(c.menuItem.id)}
                          className="w-7 h-7 rounded bg-zinc-100 text-zinc-600 hover:bg-zinc-200 text-sm"
                        >
                          −
                        </button>
                        <span className="text-zinc-900 w-5 text-center">{c.quantity}</span>
                        <button
                          onClick={() => addToCart(c.menuItem)}
                          className="w-7 h-7 rounded bg-zinc-100 text-zinc-600 hover:bg-zinc-200 text-sm"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 pt-4 border-t border-zinc-100">
                  <div className="flex justify-between font-semibold text-zinc-900">
                    <span>Итого</span>
                    <span>{totalAmount} ₽</span>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <input
                    type="text"
                    placeholder="Номер офиса (необязательно)"
                    value={deliveryTo}
                    onChange={(e) => setDeliveryTo(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    placeholder="Комментарий (необязательно)"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Button
                    className="w-full"
                    onClick={submitOrder}
                    disabled={isOrdering}
                  >
                    {isOrdering ? "Оформление..." : "Оформить заказ"}
                  </Button>
                </div>
              </>
            )}

            {message && (
              <p
                className={`mt-3 text-sm ${
                  message.type === "success" ? "text-green-600" : "text-red-600"
                }`}
              >
                {message.text}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
