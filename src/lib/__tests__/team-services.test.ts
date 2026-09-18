import { describe, it, expect } from "vitest";
import {
  TEAM_SERVICES,
  TEAM_SERVICE_GROUP_ORDER,
  groupTeamServices,
  isTeamRole,
  visibleTeamServices,
} from "@/lib/team-services";
import { ADMIN_SECTION_SLUGS } from "@/lib/permissions";

/** Слепок того, что вернёт getUserAdminSections() для SUPERADMIN без строгих грантов. */
const SUPERADMIN_SECTIONS = ADMIN_SECTION_SLUGS.filter((s) => s !== "nedelovoy");

describe("isTeamRole", () => {
  it("команда — это SUPERADMIN, ADMIN и MANAGER", () => {
    expect(isTeamRole("SUPERADMIN")).toBe(true);
    expect(isTeamRole("ADMIN")).toBe(true);
    expect(isTeamRole("MANAGER")).toBe(true);
  });

  it("USER и отсутствие роли — не команда", () => {
    expect(isTeamRole("USER")).toBe(false);
    expect(isTeamRole(null)).toBe(false);
    expect(isTeamRole(undefined)).toBe(false);
  });
});

describe("каталог TEAM_SERVICES", () => {
  it("не содержит дублей по секции", () => {
    const sections = TEAM_SERVICES.map((s) => s.section);
    expect(new Set(sections).size).toBe(sections.length);
  });

  it("каждая ссылка ведёт на /admin/<section>", () => {
    for (const service of TEAM_SERVICES) {
      expect(service.href).toBe(`/admin/${service.section}`);
    }
  });

  it("все группы входят в TEAM_SERVICE_GROUP_ORDER", () => {
    for (const service of TEAM_SERVICES) {
      expect(TEAM_SERVICE_GROUP_ORDER).toContain(service.group);
    }
  });

  it("не показывает заглушку «Бани» — страницы /admin/sauna нет", () => {
    expect(TEAM_SERVICES.some((s) => s.section === "sauna")).toBe(false);
  });

  it("superadminOnly стоит ровно на секциях вне грида прав", () => {
    for (const service of TEAM_SERVICES) {
      const inGrid = (ADMIN_SECTION_SLUGS as readonly string[]).includes(
        service.section,
      );
      expect(service.superadminOnly ?? false).toBe(!inGrid);
    }
  });
});

describe("visibleTeamServices", () => {
  it("USER не видит ничего, даже с выданными секциями", () => {
    expect(visibleTeamServices("USER", ["cafe", "gazebos"])).toEqual([]);
  });

  it("MANAGER видит только выданные секции", () => {
    const visible = visibleTeamServices("MANAGER", ["cafe", "inventory"]);
    expect(visible.map((s) => s.section).sort()).toEqual(["cafe", "inventory"]);
  });

  it("MANAGER не видит секции вне грида прав, даже если их подсунули", () => {
    // authorized() отправит его на /admin/forbidden — ссылки быть не должно.
    const visible = visibleTeamServices("MANAGER", ["payments", "notifications"]);
    expect(visible).toEqual([]);
  });

  it("SUPERADMIN видит весь каталог, кроме строгого НеДелового без гранта", () => {
    const visible = visibleTeamServices("SUPERADMIN", SUPERADMIN_SECTIONS);
    const sections = visible.map((s) => s.section);
    expect(sections).not.toContain("nedelovoy");
    expect(sections).toEqual(
      TEAM_SERVICES.filter((s) => s.section !== "nedelovoy").map((s) => s.section),
    );
  });

  it("SUPERADMIN видит НеДеловой, когда грант выдан явно", () => {
    const visible = visibleTeamServices("SUPERADMIN", [
      ...SUPERADMIN_SECTIONS,
      "nedelovoy",
    ]);
    expect(visible.map((s) => s.section)).toContain("nedelovoy");
  });

  it("SUPERADMIN видит секции вне грида прав", () => {
    const sections = visibleTeamServices("SUPERADMIN", SUPERADMIN_SECTIONS).map(
      (s) => s.section,
    );
    expect(sections).toEqual(
      expect.arrayContaining(["payments", "feedback", "notifications"]),
    );
  });

  it("пустой список грантов — пустой каталог для MANAGER", () => {
    expect(visibleTeamServices("MANAGER", [])).toEqual([]);
  });
});

describe("groupTeamServices", () => {
  it("сохраняет порядок групп и выкидывает пустые", () => {
    const grouped = groupTeamServices(visibleTeamServices("MANAGER", ["cafe", "tasks"]));
    expect(grouped.map((g) => g.group)).toEqual(["Операции парка", "Работа команды"]);
    expect(grouped[0].services.map((s) => s.section)).toEqual(["cafe"]);
    expect(grouped[1].services.map((s) => s.section)).toEqual(["tasks"]);
  });

  it("для пустого входа отдаёт пустой список", () => {
    expect(groupTeamServices([])).toEqual([]);
  });
});
