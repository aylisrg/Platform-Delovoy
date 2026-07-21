import { describe, it, expect } from "vitest";
import {
  getParkingInfo,
  getParkingPricing,
  getGuardedParkingInfo,
  MODULE_SLUG,
} from "@/modules/parking/service";

describe("getParkingInfo", () => {
  it("returns parking info with correct structure", () => {
    const info = getParkingInfo();

    expect(info.totalSpots).toBe(150);
    expect(info.guestSpots).toBe(30);
    expect(info.tenantSpots).toBe(120);
    expect(info.operatingHours).toBe("Круглосуточно");
  });

  it("has correct spots breakdown", () => {
    const info = getParkingInfo();

    expect(info.guestSpots + info.tenantSpots).toBe(info.totalSpots);
  });

  it("returns rules as non-empty array", () => {
    const info = getParkingInfo();

    expect(info.rules).toBeInstanceOf(Array);
    expect(info.rules.length).toBeGreaterThan(0);
  });

  it("includes contacts", () => {
    const info = getParkingInfo();

    expect(info.contacts).toBeDefined();
    expect(info.contacts.phone).toBeDefined();
  });
});

describe("getParkingPricing", () => {
  it("matches the official price list (легковой 200 ₽, грузовой 400 ₽ за ночь)", () => {
    const pricing = getParkingPricing();
    expect(pricing.nightWindow).toBe("с 23:00 до 11:00");
    const car = pricing.tariffs.find((t) => t.vehicle === "Легковой автомобиль");
    const truck = pricing.tariffs.find((t) => t.vehicle === "Грузовой автомобиль");
    expect(car).toMatchObject({ nightPrice: 200, dayPrice: 200 });
    expect(truck).toMatchObject({ nightPrice: 400, dayPrice: 400 });
  });
});

describe("getGuardedParkingInfo", () => {
  it("returns standalone parking service content", () => {
    const info = getGuardedParkingInfo();
    expect(info.tagline).toBeTruthy();
    expect(info.hours).toBeTruthy();
    expect(info.address).toContain("Селятино");
  });

  it("has non-empty features and steps with title + description", () => {
    const info = getGuardedParkingInfo();
    expect(info.features.length).toBeGreaterThan(0);
    expect(info.steps.length).toBeGreaterThan(0);
    for (const f of [...info.features, ...info.steps]) {
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
    }
  });
});

describe("MODULE_SLUG", () => {
  it("equals parking", () => {
    expect(MODULE_SLUG).toBe("parking");
  });
});
