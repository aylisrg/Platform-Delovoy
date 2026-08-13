"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { ApiFetchError, useTelegram } from "@/components/webapp/TelegramProvider";
import {
  Button,
  Card,
  EmptyState,
  Icon,
  SectionHeader,
  Skeleton,
} from "@/components/webapp/ui";
import { receiptEmailSchema } from "@/modules/cafe/validation";

/**
 * Кафе в Mini App (ADR §3.2): меню читается из публичного `GET /api/cafe`
 * напрямую — обёртки над меню сознательно нет. Заказ уходит в
 * `POST /api/webapp/cafe/checkout`, который атрибутирует его пользователю.
 */

interface MenuItemDto {
  id: string;
  category: string;
  name: string;
  description: string | null;
  /** Decimal приезжает строкой — считаем через Number(). */
  price: string | number;
  imageUrl: string | null;
}

interface MenuResponse {
  items: MenuItemDto[];
  categories: string[];
}

interface CheckoutResponse {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  items: Array<{ name: string; quantity: number; price: number }>;
  payment: { id: string; confirmationUrl: string | null } | null;
}

type CartLine = { menuItemId: string; quantity: number };

type SuccessInfo = { orderNumber: string; confirmationUrl: string | null };

/**
 * В хранилище лежат только id и количество: цены и названия всегда берутся из
 * свежего меню, поэтому переживший неделю корзину клиент не увидит вчерашнюю
 * цену. Позиции, исчезнувшие из меню, молча выбрасываются при гидратации.
 */
const CART_STORAGE_KEY = "webapp-cafe-cart-v1";
const MAX_QUANTITY = 99;

function readStoredCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (line): line is CartLine =>
        typeof line === "object" &&
        line !== null &&
        typeof (line as CartLine).menuItemId === "string" &&
        typeof (line as CartLine).quantity === "number" &&
        (line as CartLine).quantity > 0
    );
  } catch {
    return [];
  }
}

function writeStoredCart(cart: CartLine[]): void {
  try {
    if (cart.length === 0) {
      localStorage.removeItem(CART_STORAGE_KEY);
      return;
    }
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // приватный режим / переполненное хранилище — корзина живёт в памяти
  }
}

function formatPrice(value: number): string {
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

/** Поля ввода — на токенах темы, без собственных цветов (AC-7.2). */
const INPUT_CLASS = "w-full rounded-xl px-4 py-3 text-[16px] focus:outline-none";
const INPUT_STYLE: CSSProperties = {
  background: "var(--tg-secondary-bg)",
  color: "var(--tg-text)",
  border: "1px solid var(--tg-separator)",
};

/**
 * Оплата открывается штатным `openLink` Telegram — внутри WebView редирект на
 * ЮKassa обрывает Mini App. Вне Telegram (dev, браузер) — обычное окно.
 * Проверка через `typeof`, а не `??`: `openLink` возвращает undefined, и
 * `?? window.open` открыл бы страницу дважды.
 */
function openPaymentPage(url: string): void {
  const webapp = typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
  if (webapp && typeof webapp.openLink === "function") {
    webapp.openLink(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export default function CafePage() {
  const { ready, user, apiFetch, haptic, showBackButton, onBackButtonClick } =
    useTelegram();

  const [items, setItems] = useState<MenuItemDto[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [step, setStep] = useState<"menu" | "checkout">("menu");

  const [deliveryTo, setDeliveryTo] = useState("");
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);

  const hydrated = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const stepRef = useRef(step);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  // Кнопка «назад» Telegram: из оформления — к меню, из меню — назад по истории.
  useEffect(() => {
    showBackButton(true);
    onBackButtonClick(() => {
      if (stepRef.current === "checkout") {
        setStep("menu");
        return;
      }
      window.history.back();
    });
    return () => showBackButton(false);
  }, [showBackButton, onBackButtonClick]);

  // Меню публичное — грузим сразу, не дожидаясь авторизации (токен нужен
  // только на оформление).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cafe")
      .then((res) => res.json())
      .then((body: { success?: boolean; data?: MenuResponse }) => {
        if (cancelled) return;
        if (body.success && body.data) {
          setItems(body.data.items ?? []);
          setCategories(body.data.categories ?? []);
        } else {
          setLoadFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const stored = readStoredCart();
    if (stored.length > 0) setCart(stored);
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return; // не затирать хранилище до гидратации
    writeStoredCart(cart);
  }, [cart]);

  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );

  /** Категории уже приходят в порядке витрины — сохраняем его. */
  const grouped = useMemo(() => {
    const map = new Map<string, MenuItemDto[]>();
    for (const item of items) {
      const list = map.get(item.category);
      if (list) list.push(item);
      else map.set(item.category, [item]);
    }
    const ordered = [
      ...categories.filter((category) => map.has(category)),
      ...[...map.keys()].filter((category) => !categories.includes(category)),
    ];
    return ordered.map((category) => ({
      category,
      items: map.get(category) ?? [],
    }));
  }, [items, categories]);

  const visibleGroups = activeCategory
    ? grouped.filter((group) => group.category === activeCategory)
    : grouped;

  const cartLines = useMemo(
    () =>
      cart
        .map((line) => {
          const item = itemsById.get(line.menuItemId);
          return item ? { item, quantity: line.quantity } : null;
        })
        .filter((line): line is { item: MenuItemDto; quantity: number } => line !== null),
    [cart, itemsById]
  );

  const totalAmount = cartLines.reduce(
    (sum, line) => sum + Number(line.item.price) * line.quantity,
    0
  );
  const totalCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);

  const quantityOf = useCallback(
    (menuItemId: string) =>
      cart.find((line) => line.menuItemId === menuItemId)?.quantity ?? 0,
    [cart]
  );

  const addToCart = useCallback(
    (menuItemId: string) => {
      haptic.impact("light");
      setSuccess(null);
      setCart((prev) => {
        const existing = prev.find((line) => line.menuItemId === menuItemId);
        if (!existing) return [...prev, { menuItemId, quantity: 1 }];
        return prev.map((line) =>
          line.menuItemId === menuItemId
            ? { ...line, quantity: Math.min(line.quantity + 1, MAX_QUANTITY) }
            : line
        );
      });
    },
    [haptic]
  );

  const removeFromCart = useCallback(
    (menuItemId: string) => {
      haptic.impact("light");
      setCart((prev) =>
        prev
          .map((line) =>
            line.menuItemId === menuItemId
              ? { ...line, quantity: line.quantity - 1 }
              : line
          )
          .filter((line) => line.quantity > 0)
      );
    },
    [haptic]
  );

  async function submitOrder() {
    if (cartLines.length === 0 || submitting) return;

    // Ту же схему применяет сервер: без проверки опечатка доезжает до
    // createCheckout, тот создаёт заказ и тут же отменяет его — мусор в БД.
    let customerEmail: string | undefined;
    const trimmedEmail = email.trim();
    if (trimmedEmail) {
      const parsedEmail = receiptEmailSchema.safeParse(trimmedEmail);
      if (!parsedEmail.success) {
        haptic.notification("error");
        setEmailError("Проверьте адрес почты");
        return;
      }
      customerEmail = parsedEmail.data;
    }

    setSubmitting(true);
    setFormError(null);
    setEmailError(null);

    try {
      const result = await apiFetch<CheckoutResponse>("/api/webapp/cafe/checkout", {
        method: "POST",
        body: JSON.stringify({
          items: cartLines.map((line) => ({
            menuItemId: line.item.id,
            quantity: line.quantity,
          })),
          deliveryTo: deliveryTo.trim() || undefined,
          comment: comment.trim() || undefined,
          ...(customerEmail && { customerEmail }),
        }),
      });

      haptic.notification("success");
      setCart([]);
      setDeliveryTo("");
      setComment("");
      setStep("menu");
      setSuccess({
        orderNumber: result.orderNumber,
        confirmationUrl: result.payment?.confirmationUrl ?? null,
      });
      if (result.payment?.confirmationUrl) {
        openPaymentPage(result.payment.confirmationUrl);
      }
    } catch (error) {
      haptic.notification("error");
      if (error instanceof ApiFetchError) {
        if (error.code === "PAYMENT_CONTACT_REQUIRED") {
          setEmailError("Укажите email — на него придёт электронный чек");
          emailRef.current?.focus();
        } else if (error.code === "ITEM_NOT_FOUND") {
          setFormError(
            "Часть позиций закончилась. Обновите меню и соберите заказ заново."
          );
        } else if (error.status === 401) {
          setFormError("Сессия истекла — закройте и снова откройте приложение.");
        } else if (error.status === 429) {
          setFormError("Слишком много запросов. Подождите минуту.");
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError("Нет связи с сервером. Попробуйте ещё раз.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const header = (
    <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[24px] font-bold">Кафе</h1>
        <p className="text-[14px] mt-0.5" style={{ color: "var(--tg-hint)" }}>
          Заказ с собой или в офис
        </p>
      </div>
      <Link
        href="/webapp/cafe/orders"
        aria-label="Мои заказы"
        className="flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-xl text-[14px] font-medium"
        style={{ background: "var(--tg-section-bg)", color: "var(--tg-accent)" }}
      >
        <Icon name="receipt" size={18} />
        Заказы
      </Link>
    </div>
  );

  if (success) {
    const { confirmationUrl } = success;
    return (
      <div className="tg-page-enter">
        {header}
        <div className="px-4 mt-2">
          <Card className="p-5 text-center">
            <span style={{ color: "var(--tg-accent)" }}>
              <Icon name="check" size={40} strokeWidth={1.5} />
            </span>
            <p className="mt-3 text-[17px] font-semibold">
              {confirmationUrl ? "Заказ создан" : "Оплата на кассе"}
            </p>
            <p
              className="mt-4 text-[32px] font-bold tracking-[0.18em]"
              style={{ color: "var(--tg-text)" }}
            >
              {success.orderNumber}
            </p>
            <p
              className="mt-3 text-[14px] leading-relaxed"
              style={{ color: "var(--tg-hint)" }}
            >
              {confirmationUrl
                ? "Оплатите на странице ЮKassa — после оплаты заказ появится в «Моих заказах»."
                : "Назовите номер на кассе и оплатите там. Заказ уже принят."}
            </p>

            <div className="mt-5 space-y-2.5">
              {confirmationUrl && (
                <Button
                  onClick={() => {
                    haptic.impact("medium");
                    openPaymentPage(confirmationUrl);
                  }}
                >
                  Открыть страницу оплаты
                </Button>
              )}
              <Link
                href="/webapp/cafe/orders"
                className="tg-button"
                style={{
                  background: "var(--tg-section-bg)",
                  color: "var(--tg-accent)",
                }}
              >
                Мои заказы
              </Link>
              <Button variant="secondary" onClick={() => setSuccess(null)}>
                Вернуться в меню
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (step === "checkout") {
    return (
      <div className="tg-page-enter pb-6">
        <div className="px-4 pt-4 pb-2">
          <h1 className="text-[24px] font-bold">Оформление</h1>
          <p className="text-[14px] mt-0.5" style={{ color: "var(--tg-hint)" }}>
            {totalCount} позиц. на {formatPrice(totalAmount)}
          </p>
        </div>

        <div className="px-4 mt-2 space-y-4">
          <Card>
            {cartLines.map((line) => (
              <div key={line.item.id} className="tg-list-item">
                <span className="flex-1 min-w-0">
                  <span className="block text-[16px] leading-tight truncate">
                    {line.item.name}
                  </span>
                  <span
                    className="block text-[13px] mt-0.5"
                    style={{ color: "var(--tg-subtitle)" }}
                  >
                    {formatPrice(Number(line.item.price))} × {line.quantity}
                  </span>
                </span>
                <Stepper
                  quantity={line.quantity}
                  onAdd={() => addToCart(line.item.id)}
                  onRemove={() => removeFromCart(line.item.id)}
                />
              </div>
            ))}
            <div
              className="flex items-center justify-between px-4 py-3 text-[16px] font-semibold"
              style={{ borderTop: "0.5px solid var(--tg-separator)" }}
            >
              <span>Итого</span>
              <span>{formatPrice(totalAmount)}</span>
            </div>
          </Card>

          <div>
            <SectionHeader>Куда принести</SectionHeader>
            <Card className="p-4 space-y-3">
              <input
                type="text"
                inputMode="text"
                placeholder="Номер офиса (необязательно)"
                value={deliveryTo}
                maxLength={50}
                onChange={(event) => setDeliveryTo(event.target.value)}
                className={INPUT_CLASS}
                style={INPUT_STYLE}
              />
              <input
                type="text"
                placeholder="Комментарий (необязательно)"
                value={comment}
                maxLength={500}
                onChange={(event) => setComment(event.target.value)}
                className={INPUT_CLASS}
                style={INPUT_STYLE}
              />
              <p className="text-[13px]" style={{ color: "var(--tg-hint)" }}>
                Пустое поле — заберёте на стойке.
              </p>
            </Card>
          </div>

          <div>
            <SectionHeader>Электронный чек</SectionHeader>
            <Card className="p-4 space-y-2">
              <input
                ref={emailRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Email для чека"
                value={email}
                maxLength={200}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError(null);
                }}
                className={INPUT_CLASS}
                style={
                  emailError
                    ? { ...INPUT_STYLE, border: "1px solid var(--tg-destructive)" }
                    : INPUT_STYLE
                }
              />
              <p
                className="text-[13px]"
                style={{
                  color: emailError ? "var(--tg-destructive)" : "var(--tg-hint)",
                }}
              >
                {emailError ??
                  "Если не указать — возьмём почту профиля. Чек нужен только при онлайн-оплате."}
              </p>
            </Card>
          </div>

          {formError && (
            <p
              className="text-[14px] text-center"
              style={{ color: "var(--tg-destructive)" }}
            >
              {formError}
            </p>
          )}

          {ready && !user && (
            <p
              className="text-[14px] text-center"
              style={{ color: "var(--tg-hint)" }}
            >
              Откройте кафе через бота — заказ оформляется от вашего аккаунта.
            </p>
          )}

          <div className="space-y-2.5">
            <Button
              onClick={submitOrder}
              disabled={submitting || cartLines.length === 0 || !user}
            >
              {submitting ? "Оформляем…" : `Оформить · ${formatPrice(totalAmount)}`}
            </Button>
            <Button variant="secondary" onClick={() => setStep("menu")}>
              Вернуться к меню
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tg-page-enter">
      {header}

      {loading ? (
        <div className="px-4 mt-2 space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : loadFailed ? (
        <EmptyState
          icon="alert"
          title="Меню не загрузилось"
          hint="Проверьте связь и попробуйте ещё раз."
          action={
            <Button onClick={() => window.location.reload()}>Обновить</Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="coffee"
          title="Меню пока пустое"
          hint="Кухня обновляет позиции — загляните чуть позже."
          action={
            <Link href="/webapp" className="tg-button">
              На главную
            </Link>
          }
        />
      ) : (
        <>
          {categories.length > 1 && (
            <div className="mt-1 overflow-x-auto">
              <div className="flex gap-2 px-4 py-2 w-max">
                <button
                  type="button"
                  className={
                    activeCategory === null ? "tg-slot selected" : "tg-slot"
                  }
                  onClick={() => {
                    haptic.selection();
                    setActiveCategory(null);
                  }}
                >
                  Все
                </button>
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={
                      activeCategory === category ? "tg-slot selected" : "tg-slot"
                    }
                    onClick={() => {
                      haptic.selection();
                      setActiveCategory(category);
                    }}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={cartLines.length > 0 ? "pb-28" : "pb-4"}>
            {visibleGroups.map((group) => (
              <div key={group.category} className="mt-2">
                <SectionHeader>{group.category}</SectionHeader>
                <div className="px-4 space-y-3">
                  {group.items.map((item) => (
                    <Card key={item.id} className="p-3 flex gap-3 items-center">
                      {item.imageUrl && (
                        // Фото приходят с нашего же домена (/api/cafe/menu/images/…),
                        // оптимизатор next/image здесь ничего не даёт — ADR §3.2.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt=""
                          width={64}
                          height={64}
                          loading="lazy"
                          className="w-16 h-16 rounded-xl object-cover shrink-0"
                          style={{ background: "var(--tg-secondary-bg)" }}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[16px] font-medium leading-tight">
                          {item.name}
                        </p>
                        {item.description && (
                          <p
                            className="text-[13px] mt-0.5 line-clamp-2"
                            style={{ color: "var(--tg-subtitle)" }}
                          >
                            {item.description}
                          </p>
                        )}
                        <p className="text-[15px] mt-1 font-semibold">
                          {formatPrice(Number(item.price))}
                        </p>
                      </div>
                      {quantityOf(item.id) > 0 ? (
                        <Stepper
                          quantity={quantityOf(item.id)}
                          onAdd={() => addToCart(item.id)}
                          onRemove={() => removeFromCart(item.id)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => addToCart(item.id)}
                          aria-label={`Добавить ${item.name}`}
                          className="shrink-0 px-4 py-2 rounded-xl text-[15px] font-semibold"
                          style={{
                            background: "var(--tg-button)",
                            color: "var(--tg-button-text)",
                          }}
                        >
                          +
                        </button>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {cartLines.length > 0 && (
            <div
              className="fixed left-0 right-0 z-40 px-4"
              style={{ bottom: "calc(72px + env(safe-area-inset-bottom, 0px))" }}
            >
              <Button
                onClick={() => {
                  haptic.impact("medium");
                  setFormError(null);
                  setStep("checkout");
                }}
              >
                Оформить · {formatPrice(totalAmount)}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stepper({
  quantity,
  onAdd,
  onRemove,
}: {
  quantity: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1 shrink-0 rounded-xl"
      style={{ background: "var(--tg-secondary-bg)" }}
    >
      <button
        type="button"
        onClick={onRemove}
        aria-label="Убрать одну"
        className="w-9 h-9 rounded-xl text-[18px] font-semibold"
        style={{ color: "var(--tg-accent)" }}
      >
        −
      </button>
      <span className="min-w-[20px] text-center text-[16px] font-semibold">
        {quantity}
      </span>
      <button
        type="button"
        onClick={onAdd}
        aria-label="Добавить одну"
        className="w-9 h-9 rounded-xl text-[18px] font-semibold"
        style={{ color: "var(--tg-accent)" }}
      >
        +
      </button>
    </div>
  );
}
