"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reachGoal } from "@/lib/metrika";
import type { CafeMenuItem } from "@/modules/cafe/types";

type CartItem = {
  menuItem: CafeMenuItem;
  quantity: number;
};

type Props = {
  items: CafeMenuItem[];
  categories: string[];
  /** ЮKassa настроена: кнопка ведёт на онлайн-оплату. */
  paymentsEnabled: boolean;
  /** Фискализация включена: контакт для чека обязателен. */
  receiptsRequired: boolean;
};

/**
 * Корзина переживает redirect на ЮKassa и перезагрузку: в localStorage лежат
 * только id и количество, цены и названия всегда берутся из серверных props.
 */
const CART_STORAGE_KEY = "cafe-cart-v1";

type StoredCartItem = { menuItemId: string; quantity: number };

function readStoredCart(): StoredCartItem[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i): i is StoredCartItem =>
        typeof i?.menuItemId === "string" &&
        typeof i?.quantity === "number" &&
        i.quantity > 0
    );
  } catch {
    return [];
  }
}

function writeStoredCart(cart: CartItem[]): void {
  try {
    if (cart.length === 0) {
      localStorage.removeItem(CART_STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify(cart.map((c) => ({ menuItemId: c.menuItem.id, quantity: c.quantity })))
    );
  } catch {
    // приватный режим / переполненное хранилище — корзина живёт в памяти
  }
}

type SuccessInfo = {
  orderNumber: string;
  paid: boolean;
};

export function MenuList({ items, categories, paymentsEnabled, receiptsRequired }: Props) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [deliveryTo, setDeliveryTo] = useState("");
  const [comment, setComment] = useState("");
  const [contact, setContact] = useState("");
  const [contactError, setContactError] = useState(false);
  const [isOrdering, setIsOrdering] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const cartRef = useRef<HTMLDivElement>(null);
  const startGoalFired = useRef(false);
  const hydrated = useRef(false);

  // Гидратация корзины из localStorage: позиции, исчезнувшие из меню,
  // молча выбрасываются. Корзина переживает redirect на ЮKassa: при отменённой
  // оплате клиент возвращается и пробует снова, а при успешной страница
  // /payments/[id] сама очищает хранилище.
  useEffect(() => {
    const stored = readStoredCart();
    if (stored.length > 0) {
      const byId = new Map(items.map((i) => [i.id, i]));
      const restored: CartItem[] = [];
      for (const s of stored) {
        const menuItem = byId.get(s.menuItemId);
        if (menuItem) restored.push({ menuItem, quantity: Math.min(s.quantity, 99) });
      }
      if (restored.length > 0) setCart(restored);
    }
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated.current) return; // не затирать хранилище до гидратации
    writeStoredCart(cart);
  }, [cart]);

  function scrollToCart() {
    cartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const filtered = activeCategory
    ? items.filter((i) => i.category === activeCategory)
    : items;

  function addToCart(item: CafeMenuItem) {
    if (!startGoalFired.current) {
      startGoalFired.current = true;
      reachGoal("cafe_order_start");
    }
    setSuccess(null);
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

    if (paymentsEnabled && receiptsRequired && !contact.trim()) {
      setContactError(true);
      setMessage({ type: "error", text: "Укажите email или телефон — на него придёт чек" });
      return;
    }

    setIsOrdering(true);
    setMessage(null);
    setContactError(false);

    const trimmedContact = contact.trim();
    const isEmail = trimmedContact.includes("@");

    try {
      const res = await fetch("/api/cafe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((c) => ({
            menuItemId: c.menuItem.id,
            quantity: c.quantity,
          })),
          deliveryTo: deliveryTo || undefined,
          comment: comment || undefined,
          ...(trimmedContact && isEmail && { customerEmail: trimmedContact }),
          ...(trimmedContact && !isEmail && { customerPhone: trimmedContact }),
        }),
      });

      const data = await res.json();

      if (data.success) {
        reachGoal("cafe_order_submit");

        const confirmationUrl: string | undefined = data.data?.payment?.confirmationUrl;
        if (confirmationUrl) {
          // ЮKassa hosted-страница: СБП или карта — выбор там. Корзину в
          // localStorage НЕ чистим: отменённая оплата = повтор в два тапа.
          window.location.href = confirmationUrl;
          return;
        }

        // Оплата на кассе (ЮKassa не настроена или временно недоступна).
        const orderNumber: string = String(data.data?.id ?? "").slice(-6).toUpperCase();
        setCart([]);
        setDeliveryTo("");
        setComment("");
        setSuccess({ orderNumber, paid: false });
      } else {
        const code = data.error?.code;
        if (code === "PAYMENT_CONTACT_REQUIRED") {
          setContactError(true);
        }
        if (code === "ITEM_NOT_FOUND") {
          setMessage({
            type: "error",
            text: "Часть позиций стала недоступна — обновите страницу и соберите корзину заново",
          });
        } else if (res.status === 429) {
          setMessage({ type: "error", text: "Слишком много запросов. Подождите минуту." });
        } else {
          setMessage({ type: "error", text: data.error?.message ?? "Ошибка при создании заказа" });
        }
      }
    } catch {
      setMessage({ type: "error", text: "Ошибка сети" });
    } finally {
      setIsOrdering(false);
    }
  }

  const totalItems = cart.reduce((sum, c) => sum + c.quantity, 0);

  return (
    <>
    {/* Mobile sticky cart bar */}
    {cart.length > 0 && (
      <div className="fixed bottom-0 inset-x-0 z-40 lg:hidden bg-white border-t border-zinc-200 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-900">{totalAmount} ₽</p>
            <p className="text-xs text-zinc-500">{totalItems} позиц.</p>
          </div>
          <Button size="sm" onClick={scrollToCart}>
            {paymentsEnabled ? "К оплате →" : "Перейти к заказу →"}
          </Button>
        </div>
      </div>
    )}
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
      {/* Menu */}
      <div className="lg:col-span-2">
        {/* Category filter */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setActiveCategory(null)}
            className={`px-4 py-2.5 rounded-full text-sm font-medium transition-colors min-h-[44px] ${
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
              className={`px-4 py-2.5 rounded-full text-sm font-medium transition-colors min-h-[44px] ${
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
            <Card key={item.id} className="overflow-hidden">
              {item.imageUrl && (
                <div className="relative aspect-[16/9] bg-zinc-100">
                  <Image
                    src={item.imageUrl}
                    alt={item.name}
                    fill
                    sizes="(max-width: 640px) 100vw, 33vw"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              )}
              <CardContent>
                <div className="flex items-start justify-between gap-2">
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
      <div ref={cartRef}>
        <Card>
          <CardContent>
            <h3 className="text-lg font-semibold text-zinc-900 mb-4">Корзина</h3>

            {success && (
              <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-center">
                <p className="text-sm text-green-700">Заказ создан!</p>
                <p className="mt-1 text-3xl font-bold tracking-widest text-green-800">
                  {success.orderNumber}
                </p>
                <p className="mt-2 text-sm text-green-700">
                  Назовите номер на кассе и оплатите там.
                </p>
              </div>
            )}

            {cart.length === 0 ? (
              !success && <p className="text-sm text-zinc-400">Корзина пуста</p>
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
                          className="w-9 h-9 rounded bg-zinc-100 text-zinc-600 hover:bg-zinc-200 text-sm flex items-center justify-center"
                        >
                          −
                        </button>
                        <span className="text-zinc-900 w-5 text-center">{c.quantity}</span>
                        <button
                          onClick={() => addToCart(c.menuItem)}
                          className="w-9 h-9 rounded bg-zinc-100 text-zinc-600 hover:bg-zinc-200 text-sm flex items-center justify-center"
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
                    placeholder="Принести в офис № (необязательно)"
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
                  {paymentsEnabled && receiptsRequired && (
                    <div>
                      <input
                        type="text"
                        placeholder="Email или телефон (для чека)"
                        value={contact}
                        onChange={(e) => {
                          setContact(e.target.value);
                          setContactError(false);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                          contactError
                            ? "border-red-400 focus:ring-red-500"
                            : "border-zinc-300 focus:ring-blue-500"
                        }`}
                      />
                      <p className="mt-1 text-xs text-zinc-400">
                        Сюда придёт электронный чек об оплате
                      </p>
                    </div>
                  )}
                  <Button
                    className="w-full"
                    onClick={submitOrder}
                    disabled={isOrdering}
                  >
                    {isOrdering
                      ? "Оформление..."
                      : paymentsEnabled
                        ? `Оплатить ${totalAmount} ₽ — СБП или карта`
                        : "Оформить заказ"}
                  </Button>
                  {paymentsEnabled && (
                    <p className="text-center text-xs text-zinc-400">
                      Оплата на защищённой странице ЮKassa
                    </p>
                  )}
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
    </>
  );
}
