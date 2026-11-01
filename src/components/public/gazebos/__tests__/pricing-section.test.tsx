// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { GazeboResource } from "@/modules/gazebos/types";
import { PricingSection } from "../pricing-section";

afterEach(cleanup);

it("shows rental prices and paid extras without the retired pizza offer", () => {
  const resources = [{
    id: "gazebo-1", name: "Беседка №1", description: null, capacity: 20,
    pricePerHour: 1100, isActive: true,
    metadata: { priceList: { weekdayHour: 1100, weekdayDay: 11000, weekendHour: 1500, weekendDay: 14000 } },
  }] as unknown as GazeboResource[];
  const { container } = render(<PricingSection resources={resources} />);

  expect(screen.getByRole("table").textContent).toContain("1 100 ₽");
  expect(screen.getByText("Караоке").parentElement?.textContent).toContain("750 ₽/час");
  expect(screen.getByText(/Минимальное бронирование — 4 часа/)).toBeTruthy();
  expect(container.textContent).not.toMatch(/пицц|в подарок|аренда от [46] часов/i);
  expect(screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent))
    .toEqual(["Дополнительные услуги"]);
});
