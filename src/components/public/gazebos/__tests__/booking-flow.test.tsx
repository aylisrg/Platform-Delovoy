// @vitest-environment jsdom
//
// Инцидент: клиент просил беседку на весь день, система дала записать только
// 6 часов (упирался максимум длительности), и хвост дня ушёл другому клиенту,
// который его оплатил. Кнопка «Весь день» делает намерение выразимым в один
// клик, а подсказка про бесплатные часы закрывает «огрызок дня».
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BookingFlow } from "../booking-flow";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("@/lib/metrika", () => ({ reachGoal: vi.fn() }));

// Беседка № 5 в выходной: час 2000 ₽, день 16 000 ₽.
// Полный день 11 ч × 2000 = 22 000 ₽ по часам → потолок 16 000 ₽.
const PRICING = {
  weekdayHour: 1400,
  weekdayDay: 13000,
  weekendHour: 2000,
  weekendDay: 16000,
  hourRate: 2000,
  dayRate: 16000,
  isWeekend: true,
};

/** Рабочий день 11:00–22:00 = 11 часовых слотов. */
function daySlots(busyFrom?: string) {
  return Array.from({ length: 11 }, (_, i) => {
    const startTime = `${String(11 + i).padStart(2, "0")}:00`;
    const endTime = `${String(12 + i).padStart(2, "0")}:00`;
    return {
      startTime,
      endTime,
      isAvailable: busyFrom === undefined || startTime < busyFrom,
    };
  });
}

function availabilityResponse(busyFrom?: string) {
  return {
    success: true,
    data: {
      minBookingHours: 4,
      openHour: 11,
      closeHour: 22,
      resources: [
        {
          date: "2030-06-15",
          resource: { id: "r1", name: "Беседка №5", pricePerHour: 2000, capacity: 30 },
          slots: daySlots(busyFrom),
          pricing: PRICING,
        },
      ],
    },
  };
}

/** Доводит форму до шага выбора слотов. */
async function openSlots(busyFrom?: string) {
  vi.mocked(fetch).mockResolvedValue({
    json: async () => availabilityResponse(busyFrom),
  } as Response);

  render(<BookingFlow />);
  fireEvent.click(screen.getByRole("button", { name: "Показать доступность" }));

  await waitFor(() => expect(screen.getByRole("button", { name: /Весь день/ })).toBeTruthy());
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("BookingFlow — бронь на весь день", () => {
  it("показывает кнопку «Весь день» с ценой по дневному тарифу", async () => {
    await openSlots();

    // 16 000, а не 22 000: сработал потолок дневного тарифа.
    expect(screen.getByRole("button", { name: /Весь день.*16\s000/ })).toBeTruthy();
  });

  it("клик выбирает весь день и подписывает выбор как «весь день»", async () => {
    await openSlots();

    fireEvent.click(screen.getByRole("button", { name: /Весь день/ }));

    // Сводка подписывает выбор как «весь день», а не «11 из 4 ч.».
    expect(screen.getByText(/11:00–22:00\s*\(весь день\)/)).toBeTruthy();
  });

  it("блокирует кнопку и объясняет причину, когда часть дня занята", async () => {
    await openSlots("15:00");

    const button = screen.getByRole("button", { name: /Весь день/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/занято с 15:00/)).toBeTruthy();
  });

  it("предлагает добрать день бесплатно, когда дневной тариф уже покрыл выбор", async () => {
    await openSlots();

    // 11:00–19:00 = 8 ч × 2000 = 16 000 — ровно дневной тариф.
    for (let h = 11; h < 19; h++) {
      fireEvent.click(screen.getByRole("button", { name: `${h}:00–${h + 1}:00` }));
    }

    expect(
      screen.getByRole("button", { name: /Ещё 3 ч — бесплатно/ })
    ).toBeTruthy();
  });

  it("молчит про добор, когда он платный", async () => {
    await openSlots();

    // 11:00–15:00 = 4 ч × 2000 = 8 000 — брать весь день за 16 000 дороже.
    for (let h = 11; h < 15; h++) {
      fireEvent.click(screen.getByRole("button", { name: `${h}:00–${h + 1}:00` }));
    }

    expect(screen.queryByRole("button", { name: /бесплатно/ })).toBeNull();
  });
});
