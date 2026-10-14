import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_NAVIGATION,
  DELOVOY_SECTIONS,
  NEDELOVOY_SECTIONS,
  detectParkFromPath,
} from "../navigation";
import { ADMIN_SECTION_SLUGS } from "@/lib/permissions";

const ADMIN_APP_DIR = path.resolve(__dirname, "../../../app/admin");

describe("админ-меню (#914, #915)", () => {
  it("у каждого пункта есть страница в src/app/admin — меню не даёт 404", () => {
    const missing = ALL_NAVIGATION.filter((item) => {
      const rel = item.href.replace(/^\/admin\/?/, "");
      return !existsSync(path.join(ADMIN_APP_DIR, rel, "page.tsx"));
    }).map((i) => i.href);
    expect(missing).toEqual([]);
  });

  it("href пункта совпадает с /admin/<section>", () => {
    for (const item of ALL_NAVIGATION) {
      expect(item.href).toBe(`/admin/${item.section}`);
    }
  });

  it("ALL_NAVIGATION и ADMIN_SECTIONS совпадают по набору секций", () => {
    const nav = ALL_NAVIGATION.map((i) => i.section).sort();
    const grid = [...ADMIN_SECTION_SLUGS].sort();
    expect(nav).toEqual(grid);
  });

  it("платежи, обратная связь и уведомления есть в гриде прав", () => {
    expect(ADMIN_SECTION_SLUGS).toEqual(
      expect.arrayContaining(["payments", "feedback", "notifications"]),
    );
  });

  it("«Бани» убраны из меню, парка НеДеловой и грида прав", () => {
    expect(ALL_NAVIGATION.some((i) => i.section === "sauna")).toBe(false);
    expect(NEDELOVOY_SECTIONS.has("sauna")).toBe(false);
    expect((ADMIN_SECTION_SLUGS as readonly string[]).includes("sauna")).toBe(false);
  });

  it("каждая секция меню, кроме users, привязана ровно к одному парку", () => {
    for (const { section } of ALL_NAVIGATION) {
      if (section === "users") continue;
      const parks = [DELOVOY_SECTIONS.has(section), NEDELOVOY_SECTIONS.has(section)];
      expect(parks.filter(Boolean)).toHaveLength(1);
    }
  });

  it("сайдбар и мобильное меню берут пункты из общего списка", () => {
    for (const file of ["sidebar.tsx", "mobile-nav.tsx"]) {
      const src = readFileSync(path.resolve(__dirname, "..", file), "utf8");
      expect(src).toMatch(/from "\.\/navigation"/);
      expect(src).not.toMatch(/const ALL_NAVIGATION/);
    }
  });

  it("detectParkFromPath определяет парк по пути", () => {
    expect(detectParkFromPath("/admin/nedelovoy/x")).toBe("nedelovoy");
    expect(detectParkFromPath("/admin/payments")).toBe("delovoy");
    expect(detectParkFromPath("/admin/notifications")).toBe("delovoy");
    expect(detectParkFromPath("/admin/users")).toBeNull();
    expect(detectParkFromPath("/admin/sauna")).toBeNull();
    expect(detectParkFromPath(null)).toBeNull();
  });
});
