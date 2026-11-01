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

// ADR 2026-10-25-team-access-notifications §Q7/§Q8.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EVENT_MODULE_CONTEXTS } from "../catalog";

describe("EVENT_MODULE_CONTEXTS (резолвер получателей)", () => {
  it("каждый тип каталога имеет ≥ 1 контекст и лишних ключей нет", () => {
    expect(Object.keys(EVENT_MODULE_CONTEXTS).sort()).toEqual([...MANAGED_EVENT_TYPES].sort());
    for (const eventType of MANAGED_EVENT_TYPES) {
      expect(EVENT_MODULE_CONTEXTS[eventType].length, eventType).toBeGreaterThan(0);
    }
  });
});

describe("инвариант §Q8: типы каталога — только для сотрудников", () => {
  const root = join(__dirname, "..", "..", "..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it("клиентский путь notifyClient не читает NotificationEventPreference", () => {
    const service = readFileSync(join(__dirname, "..", "service.ts"), "utf8");
    const start = service.indexOf("async function notifyClient(");
    const end = service.indexOf("\nasync function ", start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(service.slice(start, end)).not.toMatch(/notificationEventPreference/);
  });

  it("никто не диспатчит тип каталога литералом мимо staff-путей", () => {
    const literal = new RegExp(
      `dispatch\\(\\{[^}]*eventType:\\s*"(${MANAGED_EVENT_TYPES.map((t) => t.replace(".", "\\.")).join("|")})"`,
    );
    const offenders = sources(root).filter((file) => literal.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
