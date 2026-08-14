import { test, expect } from "@playwright/test";
import { prisma } from "./helpers/db";

const ITEM_NAME = "Эспрессо";

test.describe("Кафе — гостевой чекаут", () => {
  test("добавление в корзину и оформление создают запись Order в БД", async ({ page }) => {
    await page.goto("/cafe");

    const heading = page.getByRole("heading", { level: 3, name: ITEM_NAME, exact: true });
    await expect(heading).toBeVisible();
    const card = heading.locator("xpath=ancestor::div[2]");
    await card.getByRole("button", { name: "В корзину" }).click();

    // Без онлайн-оплаты (нет YOOKASSA_* в CI, isYooKassaConfigured() === false)
    // кнопка — "Оформить заказ", без редиректа на ЮKassa — Order создаётся
    // до любой попытки платежа (src/modules/cafe/service.ts createCheckout()).
    await page.getByRole("button", { name: "Оформить заказ", exact: true }).click();
    await expect(page.getByText("Заказ создан!")).toBeVisible({ timeout: 15_000 });

    const order = await prisma.order.findFirst({
      where: { moduleSlug: "cafe" },
      orderBy: { createdAt: "desc" },
      include: { items: true },
    });
    expect(order).not.toBeNull();
    expect(order!.status).toBe("NEW");
    expect(order!.paidAt).toBeNull();
    expect(order!.items.some((i) => i.name === ITEM_NAME)).toBe(true);
  });
});
