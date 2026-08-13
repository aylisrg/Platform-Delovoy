import { describe, it, expect } from "vitest";
import { buildNavigation } from "../navigation";
import { GUEST_CAPABILITIES } from "../types";

const STAFF_CAPS = {
  isStaff: true,
  staffSections: ["gazebos"],
  notificationCategories: ["bookings"],
  canNotificationCenter: true,
};

describe("buildNavigation", () => {
  it("USER: ровно 6 табов, без «Чатов» (AC-1.4)", () => {
    const nav = buildNavigation(GUEST_CAPABILITIES);
    expect(nav.tabs.map((t) => t.href)).toEqual([
      "/webapp",
      "/webapp/cafe",
      "/webapp/gazebos",
      "/webapp/ps-park",
      "/webapp/bookings",
      "/webapp/profile",
    ]);
    expect(nav.tabs.find((t) => t.href.includes("messenger"))).toBeUndefined();
    expect(
      nav.profileEntries.find((e) => e.href === "/webapp/notifications")
    ).toBeUndefined();
  });

  it("сотрудник: те же табы + вход в Центр уведомлений в профиле (AC-1.3)", () => {
    const nav = buildNavigation(STAFF_CAPS);
    expect(nav.tabs).toEqual(buildNavigation(GUEST_CAPABILITIES).tabs);
    expect(
      nav.profileEntries.find((e) => e.href === "/webapp/notifications")
    ).toBeDefined();
  });

  it("сотрудник без категорий (canNotificationCenter=false) — входа в Центр нет", () => {
    const nav = buildNavigation({
      ...STAFF_CAPS,
      notificationCategories: [],
      canNotificationCenter: false,
    });
    expect(
      nav.profileEntries.find((e) => e.href === "/webapp/notifications")
    ).toBeUndefined();
  });
});
