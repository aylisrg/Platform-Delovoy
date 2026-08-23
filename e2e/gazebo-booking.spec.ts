import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { prisma } from "./helpers/db";

const GAZEBO_NAME = "Беседка №1";

function futureDateInput(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

test.describe("Бронирование беседки", () => {
  test("выбор слотов и отправка создают запись Booking в БД", async ({ page }) => {
    await loginAs(page, "user@local", "user");
    const me = await page.request.get("/api/auth/session").then((r) => r.json());
    const userId: string = me.user.id;

    await page.goto("/gazebos");
    await page.locator("#booking-date").fill(futureDateInput(3));
    await page.getByRole("button", { name: "Показать доступность" }).click();

    // Ищем внутри виджета бронирования: тем же <h3>{name}</h3> подписаны
    // карточки беседок в маркетинговом блоке выше, и локатор по всей странице
    // резолвится в два элемента.
    const flow = page.getByTestId("booking-flow");
    // Card container: <h3>{name}</h3> is two ancestor <div>s below the card root.
    const heading = flow.getByRole("heading", { level: 3, name: GAZEBO_NAME, exact: true });
    await expect(heading).toBeVisible();
    const card = heading.locator("xpath=ancestor::div[2]");

    // Минимальное число часов подряд — читаем с бейджа, не хардкодим.
    const minHoursBadge = page.getByText(/^Минимум \d+ ч\.$/);
    const minHoursText = await minHoursBadge.textContent();
    const minHours = Number(minHoursText?.match(/\d+/)?.[0] ?? 1);

    const slotButtons = card.getByRole("button", { name: /^\d{2}:\d{2}–\d{2}:\d{2}$/ });
    await expect(slotButtons.first()).toBeVisible();

    // Не предполагаем, что первые minHours слотов свободны — на CI-ретрае
    // (retries: 1) или при повторном локальном прогоне без чистой БД первые
    // слоты дня могут быть уже заняты предыдущей попыткой. Ищем первое
    // доступное окно из minHours подряд идущих слотов.
    const totalSlots = await slotButtons.count();
    let startIdx = -1;
    for (let i = 0; i <= totalSlots - minHours; i++) {
      let windowFree = true;
      for (let j = 0; j < minHours; j++) {
        if (!(await slotButtons.nth(i + j).isEnabled())) {
          windowFree = false;
          break;
        }
      }
      if (windowFree) {
        startIdx = i;
        break;
      }
    }
    expect(startIdx, "нет окна из minHours подряд свободных слотов").toBeGreaterThanOrEqual(0);
    for (let i = startIdx; i < startIdx + minHours; i++) {
      await slotButtons.nth(i).click();
    }

    await page.getByRole("button", { name: "Продолжить →" }).click();

    // Блок акцепта: без отметки оплата недоступна (ТЗ §5.2).
    const submit = page.getByTestId("offer-accept-submit");
    await expect(submit).toBeVisible();
    await expect(submit).toHaveAttribute("aria-disabled", "true");

    await page.getByRole("checkbox", { name: /ознакомлен/i }).check();
    await expect(submit).toHaveAttribute("aria-disabled", "false");
    await submit.click();

    await expect(page.getByRole("heading", { name: "Заявка отправлена!" })).toBeVisible({
      timeout: 15_000,
    });

    const resource = await prisma.resource.findFirst({
      where: { moduleSlug: "gazebos", name: GAZEBO_NAME },
    });
    expect(resource).not.toBeNull();

    const booking = await prisma.booking.findFirst({
      where: { moduleSlug: "gazebos", resourceId: resource!.id, userId },
      orderBy: { createdAt: "desc" },
    });
    expect(booking).not.toBeNull();
    expect(booking!.status).toBe("PENDING");
    expect(booking!.userId).toBe(userId);

    // Акцепт зафиксирован на сервере: редакция, хеш её текста, момент, IP и
    // user-agent (ТЗ §6.2, требование #7).
    expect(booking!.acceptedOfferAt).not.toBeNull();
    expect(booking!.offerVersionId).not.toBeNull();
    expect(booking!.offerContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(booking!.acceptedUserAgent).toBeTruthy();
    // Согласие на рекламу отдельное и по умолчанию не дано.
    expect(booking!.acceptedMarketing).toBe(false);
  });

  test("обе отметки при загрузке сняты и не восстанавливаются после перезагрузки", async ({
    page,
  }) => {
    await loginAs(page, "user@local", "user");
    await page.goto("/gazebos");
    await page.locator("#booking-date").fill(futureDateInput(4));
    await page.getByRole("button", { name: "Показать доступность" }).click();

    const flow = page.getByTestId("booking-flow");
    const heading = flow.getByRole("heading", { level: 3, name: GAZEBO_NAME, exact: true });
    await expect(heading).toBeVisible();
    const card = heading.locator("xpath=ancestor::div[2]");

    const minHoursText = await page.getByText(/^Минимум \d+ ч\.$/).textContent();
    const minHours = Number(minHoursText?.match(/\d+/)?.[0] ?? 1);

    const slots = card.getByRole("button", { name: /^\d{2}:\d{2}–\d{2}:\d{2}$/ });
    await expect(slots.first()).toBeVisible();
    const total = await slots.count();
    let startIdx = -1;
    for (let i = 0; i <= total - minHours; i++) {
      let free = true;
      for (let j = 0; j < minHours; j++) {
        if (!(await slots.nth(i + j).isEnabled())) {
          free = false;
          break;
        }
      }
      if (free) {
        startIdx = i;
        break;
      }
    }
    expect(startIdx).toBeGreaterThanOrEqual(0);
    for (let i = startIdx; i < startIdx + minHours; i++) await slots.nth(i).click();
    await page.getByRole("button", { name: "Продолжить →" }).click();

    const offer = page.getByRole("checkbox", { name: /ознакомлен/i });
    const marketing = page.getByRole("checkbox", { name: /рекламные сообщения/i });
    await expect(offer).not.toBeChecked();
    await expect(marketing).not.toBeChecked();

    await offer.check();
    await marketing.check();

    // После перезагрузки отметки обязаны быть сняты снова (требование #9.1).
    await page.reload();
    await expect(page.getByRole("checkbox", { name: /ознакомлен/i })).toHaveCount(0);
  });
});
