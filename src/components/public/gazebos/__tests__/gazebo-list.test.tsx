// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { GazeboResource } from "@/modules/gazebos/types";
import { GazeboList, GazeboNumberLinks } from "../gazebo-list";
import { BookingFlow } from "../booking-flow";

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }));
vi.mock("@/lib/metrika", () => ({ reachGoal: vi.fn() }));
vi.mock("@/lib/funnel-beacon", () => ({ sendFunnelBeacon: vi.fn() }));

// Numeric fixture prices stand in for Prisma Decimal; no database calls.
const resources = [
  { id: "r2", name: "Беседка №2", description: "Беседка с отоплением, до 12 человек", capacity: 14, pricePerHour: 800, isActive: true,
    metadata: { priceList: { weekdayHour: 950, weekendHour: 1200, weekdayDay: 8000, weekendDay: 9000 }, features: ["интернет"] } },
  { id: "r1", name: "Беседка №1", description: "У воды", capacity: 24, pricePerHour: 1300, isActive: true, metadata: null },
] as unknown as GazeboResource[];

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("gazebo cards", () => {
  it("keeps number/photo mapping correct even when resources arrive in another order", () => {
    render(<><GazeboNumberLinks resources={resources} /><GazeboList resources={resources} bookingEnabled minBookingHours={5} /></>);
    const cards = screen.getAllByRole("article");
    expect(cards.map((card) => card.id)).toEqual(["gazebo-2", "gazebo-1"]);
    expect(within(cards[0]).getAllByRole("img")[0].getAttribute("src")).toContain(encodeURIComponent("/media/gazebos/gazebo-2/photo-03.webp"));
    expect(screen.getByRole("link", { name: "Перейти к Беседка №1" }).getAttribute("href")).toBe("#gazebo-1");
    expect(within(cards[0]).getByText("До 14 человек")).toBeTruthy();
    expect(within(cards[0]).getByText(/от 950 ₽/)).toBeTruthy();
    expect(within(cards[0]).getByText("Минимум 5 ч")).toBeTruthy();
    expect(within(cards[0]).getByText("интернет")).toBeTruthy();
    expect(within(cards[1]).getByText("У воды")).toBeTruthy();
    expect(within(cards[1]).queryByText("С отоплением")).toBeNull();
  });

  it("does not assign known photos to an unrecognized resource or display a made-up price", () => {
    render(<GazeboList resources={[{ ...resources[0], name: "Беседка №12", pricePerHour: null, metadata: null }]} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Стоимость уточняйте при бронировании")).toBeTruthy();
    expect(screen.queryByTestId("booking-cta-card")).toBeNull();
  });

  it("keeps help available when the resource list is empty", () => {
    render(<GazeboList resources={[]}><aside id="gazebo-help">Помощь</aside></GazeboList>);
    expect(screen.getByText("Помощь")).toBeTruthy();
  });

  it("keeps descriptive capacity when the numeric capacity is not provided", () => {
    render(<GazeboList resources={[{ ...resources[0], capacity: null }]} />);
    expect(screen.getByText("Беседка с отоплением, до 12 человек")).toBeTruthy();
  });

  it("preserves booking preselection, repeated card clicks and the existing form Back flow without any POST", async () => {
    const fetchMock = vi.fn(async (url: string) => ({ json: async () => {
      if (url === "/api/legal/current") return { success: true, data: { slug: "test-v1" } };
      if (!url.startsWith("/api/gazebos/availability")) return { success: true, data: [] };
      return { success: true, data: { minBookingHours: 4, resources: resources.map((resource) => ({
        resource, pricing: null, date: "2030-06-15", slots: Array.from({ length: 5 }, (_, i) => ({
          startTime: `${11 + i}:00`, endTime: `${12 + i}:00`, isAvailable: true,
        })),
      })) } };
    } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<><GazeboList resources={resources} bookingEnabled /><section id="booking"><BookingFlow /></section></>);
    const choose1 = screen.getByRole("link", { name: "Выбрать №1" });
    expect(choose1.getAttribute("href")).toBe("#booking");
    fireEvent.click(choose1);
    fireEvent.click(choose1);
    fireEvent.click(screen.getByRole("button", { name: "Показать доступность" }));
    const first = await screen.findByTestId("resource-r1");
    expect(first.getAttribute("data-preferred")).toBe("true");
    fireEvent.click(screen.getByRole("link", { name: "Выбрать №2" }));
    const second = screen.getByTestId("resource-r2");
    expect(second.getAttribute("data-preferred")).toBe("true");
    expect(first.getAttribute("data-preferred")).toBeNull();
    for (let hour = 11; hour < 15; hour++) fireEvent.click(within(second).getByRole("button", { name: `${hour}:00–${hour + 1}:00` }));
    fireEvent.click(screen.getByRole("button", { name: "Продолжить →" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Назад" })).toBeTruthy());
    expect(screen.getByTestId("offer-accept-submit").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(screen.getByTestId("resource-r2").getAttribute("data-preferred")).toBe("true");
    expect(fetchMock.mock.calls.every(([url]) => url !== "/api/gazebos/book")).toBe(true);
  });
});
