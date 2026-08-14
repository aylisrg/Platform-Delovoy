import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { prisma } from "./helpers/db";

const TABLE_NAME = "Стол PlayStation 1";

test.describe("Плей Парк — выбор слота и бронирование", () => {
  test("выбор слота и отправка создают запись Booking в БД", async ({ page }) => {
    await loginAs(page, "user@local", "user");
    const me = await page.request.get("/api/auth/session").then((r) => r.json());
    const userId: string = me.user.id;

    await page.goto("/ps-park");

    // "Стол PlayStation 1" also appears as an <h3> in a separate marketing
    // showcase section — scope to #booking (DarkAvailabilityGrid) only.
    const heading = page
      .locator("#booking")
      .getByRole("heading", { level: 3, name: TABLE_NAME, exact: true });
    await expect(heading).toBeVisible();
    const card = heading.locator("xpath=ancestor::div[2]");

    // Слоты — просто время начала ("11:00"), минимум бронирования — 1 час.
    // Не берём .first() слепо — на CI-ретрае (retries: 1) или повторном
    // локальном прогоне первый слот дня может быть уже занят прошлой
    // попыткой; берём первый ДОСТУПНЫЙ.
    const slotButtons = card.getByRole("button", { name: /^\d{2}:\d{2}$/ });
    await expect(slotButtons.first()).toBeVisible();
    const enabledSlot = card.getByRole("button", { name: /^\d{2}:\d{2}$/, disabled: false }).first();
    await enabledSlot.click();

    await page.getByRole("button", { name: "Забронировать", exact: true }).click();
    await expect(
      page.getByText("Заявка отправлена! Ожидайте подтверждения от менеджера.")
    ).toBeVisible({ timeout: 15_000 });

    const resource = await prisma.resource.findFirst({
      where: { moduleSlug: "ps-park", name: TABLE_NAME },
    });
    expect(resource).not.toBeNull();

    const booking = await prisma.booking.findFirst({
      where: { moduleSlug: "ps-park", resourceId: resource!.id, userId },
      orderBy: { createdAt: "desc" },
    });
    expect(booking).not.toBeNull();
    expect(booking!.status).toBe("PENDING");
    expect(booking!.userId).toBe(userId);
  });
});
