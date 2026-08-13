import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_CATALOG,
  MANAGED_EVENT_TYPES,
  categoryForEvent,
} from "../catalog";
import { EVENT_ROUTING } from "../events";
import { ADMIN_SECTION_SLUGS } from "@/lib/permissions";

describe("NOTIFICATION_CATALOG", () => {
  it("каждый eventType каталога существует в EVENT_ROUTING (нет мёртвых тумблеров)", () => {
    for (const eventType of MANAGED_EVENT_TYPES) {
      expect(
        EVENT_ROUTING[eventType as keyof typeof EVENT_ROUTING],
        `${eventType} отсутствует в EVENT_ROUTING`
      ).toBeDefined();
    }
  });

  it("все sections категорий — валидные секции админ-панели", () => {
    for (const category of NOTIFICATION_CATALOG) {
      for (const section of category.sections) {
        expect(ADMIN_SECTION_SLUGS).toContain(section);
      }
    }
  });

  it("инфраструктурные/CRITICAL типы не управляются каталогом (AC-5.7)", () => {
    const forbiddenPatterns = [/^health\./, /^site\./, /critical/i, /watchdog/i];
    for (const eventType of MANAGED_EVENT_TYPES) {
      for (const pattern of forbiddenPatterns) {
        expect(eventType).not.toMatch(pattern);
      }
    }
  });

  it("MANAGED_EVENT_TYPES без дублей", () => {
    expect(new Set(MANAGED_EVENT_TYPES).size).toBe(MANAGED_EVENT_TYPES.length);
  });

  it("categoryForEvent находит категорию для каждого управляемого типа", () => {
    for (const eventType of MANAGED_EVENT_TYPES) {
      expect(categoryForEvent(eventType)?.events).toEqual(
        expect.arrayContaining([expect.objectContaining({ eventType })])
      );
    }
    expect(categoryForEvent("nonexistent.event")).toBeUndefined();
  });

  it("system-категория доступна monitoring-секции и superadminAlways", () => {
    const system = NOTIFICATION_CATALOG.find((c) => c.key === "system");
    expect(system?.sections).toEqual(["monitoring"]);
    expect(system?.superadminAlways).toBe(true);
  });
});
