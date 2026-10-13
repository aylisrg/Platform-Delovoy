// @vitest-environment jsdom
// #1085: CTA онлайн-брони на /gazebos.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const beacon = vi.fn();
vi.mock("@/lib/metrika", () => ({ reachGoal: (...a: unknown[]) => beacon(...a) }));

import { BookOnlineButton, PRESELECT_EVENT, StickyBookingCta } from "../booking-cta";
import { GazeboList } from "../gazebo-list";

const RES = [
  { id: "r-1", name: "Беседка №1", description: null, capacity: 12, pricePerHour: 1000, isActive: true, metadata: null },
];

afterEach(() => {
  cleanup();
  beacon.mockReset();
});

describe("booking CTA (#1085)", () => {
  it("ведёт к #booking и пишет цель Метрики с источником", () => {
    render(<BookOnlineButton source="hero">Забронировать онлайн</BookOnlineButton>);
    const a = screen.getByTestId("booking-cta-hero");
    expect(a.getAttribute("href")).toBe("#booking");
    fireEvent.click(a);
    expect(beacon).toHaveBeenCalledWith("gazebo_booking_start", { source: "hero" });
  });

  it("кнопка на карточке предвыбирает беседку", () => {
    const seen: string[] = [];
    const h = (e: Event) => seen.push((e as CustomEvent).detail.resourceId);
    window.addEventListener(PRESELECT_EVENT, h);
    // @ts-expect-error тестовый ресурс без лишних полей
    render(<GazeboList resources={RES} bookingEnabled />);
    fireEvent.click(screen.getByTestId("booking-cta-card"));
    window.removeEventListener(PRESELECT_EVENT, h);
    expect(seen).toEqual(["r-1"]);
  });

  it("онлайн-бронь выключена: на карточке нет кнопки", () => {
    // @ts-expect-error тестовый ресурс без лишних полей
    render(<GazeboList resources={RES} />);
    expect(screen.queryByTestId("booking-cta-card")).toBeNull();
  });

  it("sticky-кнопка прячется, когда форма в зоне видимости", () => {
    let cb: (e: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(fn: typeof cb) {
          cb = fn;
        }
        observe() {}
        disconnect() {}
      }
    );
    const section = document.createElement("section");
    section.id = "booking";
    document.body.appendChild(section);
    render(<StickyBookingCta />);
    expect(screen.getByTestId("booking-cta-sticky")).toBeTruthy();
    act(() => cb([{ isIntersecting: true }]));
    expect(screen.queryByTestId("booking-cta-sticky")).toBeNull();
    section.remove();
    vi.unstubAllGlobals();
  });
});
