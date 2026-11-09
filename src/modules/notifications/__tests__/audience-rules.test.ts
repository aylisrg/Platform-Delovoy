import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import { EVENT_MODULE_CONTEXTS, MANAGED_EVENT_TYPES, categoryForEvent } from "../catalog";
import { contextAccess, evaluateRoute, groupChatDecision, type StaffSnapshot } from "../audience-rules";

function snap(partial: Partial<StaffSnapshot> & { role: Role }): StaffSnapshot {
  return {
    id: "u",
    merged: false,
    grants: new Set(),
    assignments: new Set(),
    prefs: new Map(),
    listModules: new Set(),
    ...partial,
  };
}
const prefs = (entries: Record<string, boolean>) => new Map(Object.entries(entries).map(([k, v]) => [k, { enabled: v }]));
const bookings = categoryForEvent("booking.created")!;

describe("contextAccess (ADR 2026-10-25 §Q7) — one rule for every path", () => {
  it("USER or merged → «Не входит в команду»", () => {
    expect(contextAccess(snap({ role: "USER" }), bookings, "gazebos")).toMatchObject({ ok: false, reason: "NOT_STAFF" });
    expect(contextAccess(snap({ role: "SUPERADMIN", merged: true }), bookings, "gazebos")).toMatchObject({ ok: false, reason: "NOT_STAFF" });
  });

  it("superadminOnly category (telephony) → «Только для суперадмина»", () => {
    const telephony = categoryForEvent("telephony.daily_summary")!;
    expect(contextAccess(snap({ role: "ADMIN", grants: new Set(["telephony"]) }), telephony, null)).toMatchObject({
      ok: false, reason: "SUPERADMIN_ONLY", label: "Только для суперадмина",
    });
    expect(contextAccess(snap({ role: "SUPERADMIN" }), telephony, null).ok).toBe(true);
  });

  it("strict module context needs an explicit grant even for SUPERADMIN", () => {
    const decision = contextAccess(snap({ role: "SUPERADMIN" }), bookings, "nedelovoy");
    expect(decision).toMatchObject({ ok: false, reason: "STRICT_GRANT_REQUIRED", label: "Нужен явный доступ к «НеДеловой»" });
    expect(contextAccess(snap({ role: "SUPERADMIN", grants: new Set(["nedelovoy"]) }), bookings, "nedelovoy").ok).toBe(true);
  });

  it("system category is open to any staff (staffAlways)", () => {
    const system = categoryForEvent("system.release")!;
    expect(contextAccess(snap({ role: "MANAGER" }), system, null).ok).toBe(true);
  });

  it("section, ADMIN role-owned section, assignment (with alias) and the list rule", () => {
    expect(contextAccess(snap({ role: "MANAGER", grants: new Set(["gazebos"]) }), bookings, "gazebos").ok).toBe(true);
    expect(contextAccess(snap({ role: "ADMIN" }), bookings, "gazebos").ok).toBe(true); // ADMIN owns gazebos by role
    expect(contextAccess(snap({ role: "MANAGER", assignments: new Set(["gazebos"]) }), bookings, "gazebos").ok).toBe(true);
    const rental = categoryForEvent("inquiry.created")!;
    expect(contextAccess(snap({ role: "MANAGER", assignments: new Set(["rental"]) }), rental, "rental-inquiry").ok).toBe(true);
    const cafe = categoryForEvent("order.placed")!;
    expect(contextAccess(snap({ role: "ADMIN" }), cafe, "cafe").ok).toBe(false);
    expect(contextAccess(snap({ role: "ADMIN" }), cafe, "cafe", "module_list").ok).toBe(true);
    expect(contextAccess(snap({ role: "MANAGER" }), cafe, "cafe")).toMatchObject({ ok: false, label: "Нет доступа к разделу «Кафе»" });
  });
});

describe("evaluateRoute — paths and the opt-out (AC-C2.1)", () => {
  it("explicit «on» adds the personal path; no row = no subscription for an opt-in event", () => {
    const m = snap({ role: "MANAGER", grants: new Set(["cafe"]) });
    expect(evaluateRoute(m, "order.placed", "cafe")).toMatchObject({ receives: false, paths: [] });
    expect(evaluateRoute({ ...m, prefs: prefs({ "order.placed": true }) }, "order.placed", "cafe")).toMatchObject({
      receives: true, paths: ["personal"],
    });
  });

  // ADR 2026-11-09: booking events are on by default for everyone with the section.
  it("on-by-default event: no row = «default»; explicit «on» = personal; explicit «off» wins", () => {
    const m = snap({ role: "MANAGER", grants: new Set(["gazebos"]) });
    expect(evaluateRoute(m, "booking.created", "gazebos")).toMatchObject({ receives: true, paths: ["default"] });
    expect(evaluateRoute({ ...m, prefs: prefs({ "booking.created": true }) }, "booking.created", "gazebos")).toMatchObject({
      receives: true, paths: ["personal"],
    });
    expect(evaluateRoute({ ...m, prefs: prefs({ "booking.created": false }) }, "booking.created", "gazebos")).toMatchObject({
      receives: false, optedOut: true, paths: [],
    });
    // no section → the default gives nothing
    expect(evaluateRoute(snap({ role: "MANAGER", grants: new Set(["cafe"]) }), "booking.created", "gazebos").receives).toBe(false);
    // RBAC: a Плей Парк-only manager never gets gazebo bookings (client name/phone)
    const psOnly = snap({ role: "MANAGER", grants: new Set(["ps-park"]) });
    expect(evaluateRoute(psOnly, "booking.created", "gazebos")).toMatchObject({ receives: false, paths: [] });
    expect(evaluateRoute(psOnly, "booking.created", "ps-park").paths).toEqual(["default"]);
    expect(evaluateRoute({ ...psOnly, prefs: prefs({ "booking.created": true }) }, "booking.created", "gazebos").receives).toBe(false);
    const psAssigned = snap({ role: "MANAGER", assignments: new Set(["ps-park"]) });
    expect(evaluateRoute(psAssigned, "booking.cancelled", "gazebos").receives).toBe(false);
    expect(evaluateRoute(psAssigned, "booking.cancelled", "ps-park").receives).toBe(true);
    // ADMIN owns gazebos/ps-park by role
    expect(evaluateRoute(snap({ role: "ADMIN" }), "booking.admin_created", "ps-park").paths).toEqual(["default"]);
    // ending_soon: on for ADMIN/SUPERADMIN, opt-in for MANAGER
    expect(evaluateRoute(snap({ role: "ADMIN" }), "booking.ending_soon", "gazebos").receives).toBe(true);
    expect(evaluateRoute(snap({ role: "MANAGER", grants: new Set(["gazebos"]) }), "booking.ending_soon", "gazebos").receives).toBe(false);
  });

  it("weekly business report: on for SUPERADMIN and ADMIN with analytics, never for MANAGER", () => {
    expect(evaluateRoute(snap({ role: "SUPERADMIN" }), "analytics.business_weekly", null)).toMatchObject({ receives: true, paths: ["default"] });
    const admin = snap({ role: "ADMIN", grants: new Set(["analytics"]) });
    expect(evaluateRoute(admin, "analytics.business_weekly", null)).toMatchObject({ receives: true, paths: ["default"] });
    expect(evaluateRoute({ ...admin, prefs: prefs({ "analytics.business_weekly": false }) }, "analytics.business_weekly", null).receives).toBe(false);
    const manager = snap({ role: "MANAGER", grants: new Set(["analytics"]), prefs: prefs({ "analytics.business_weekly": true }) });
    expect(evaluateRoute(manager, "analytics.business_weekly", null)).toMatchObject({
      receives: false, access: { ok: false, reason: "ROLE_NOT_ALLOWED" },
    });
    expect(evaluateRoute(snap({ role: "SUPERADMIN" }), "telephony.daily_summary_telegram", null).paths).toEqual(["default"]);
    expect(evaluateRoute(snap({ role: "ADMIN", grants: new Set(["telephony"]) }), "telephony.daily_summary_telegram", null).receives).toBe(false);
  });

  it("list member receives; explicit «off» beats the list", () => {
    const listed = snap({ role: "MANAGER", assignments: new Set(["gazebos"]), listModules: new Set(["gazebos"]) });
    expect(evaluateRoute(listed, "booking.created", "gazebos")).toMatchObject({ receives: true, paths: ["default", "module_list"] });
    expect(evaluateRoute({ ...listed, prefs: prefs({ "booking.created": false }) }, "booking.created", "gazebos")).toMatchObject({
      receives: false, optedOut: true, paths: ["module_list"],
    });
    // the list of another module doesn't count
    expect(evaluateRoute(listed, "booking.created", "ps-park").receives).toBe(false);
  });

  it("Avito by role: SUPERADMIN always, MANAGER/ADMIN assigned to the lead module; «off» wins", () => {
    expect(evaluateRoute(snap({ role: "SUPERADMIN" }), "avito.lead.new", null)).toMatchObject({ receives: true, paths: ["default", "role_avito"] });
    const assigned = snap({ role: "MANAGER", assignments: new Set(["gazebos"]) });
    expect(evaluateRoute(assigned, "avito.lead.new", "gazebos").paths).toEqual(["role_avito"]);
    expect(evaluateRoute(assigned, "avito.lead.new", "ps-park").receives).toBe(false);
    expect(evaluateRoute(assigned, "avito.lead.new", null).receives).toBe(false);
    expect(evaluateRoute({ ...assigned, prefs: prefs({ "avito.lead.new": false }) }, "avito.lead.new", "gazebos").receives).toBe(false);
  });

  it("Avito leads never go by module recipient list (they didn't before either)", () => {
    const listedAdmin = snap({ role: "ADMIN", listModules: new Set(["gazebos"]) });
    expect(evaluateRoute(listedAdmin, "avito.lead.new", "gazebos")).toMatchObject({ receives: false, paths: [] });
  });

  it("telephony summary: SUPERADMIN by default, explicit off wins, nobody else", () => {
    expect(evaluateRoute(snap({ role: "SUPERADMIN" }), "telephony.daily_summary", null).paths).toEqual(["in_app_superadmin"]);
    expect(evaluateRoute(snap({ role: "SUPERADMIN", prefs: prefs({ "telephony.daily_summary": false }) }), "telephony.daily_summary", null).receives).toBe(false);
    expect(evaluateRoute(snap({ role: "MANAGER", prefs: prefs({ "telephony.daily_summary": true }) }), "telephony.daily_summary", null).receives).toBe(false);
  });

  it("an excluded (USER) account never receives, whatever rows remain", () => {
    const ex = snap({ role: "USER", listModules: new Set(["gazebos"]), prefs: prefs({ "booking.created": true }) });
    expect(evaluateRoute(ex, "booking.created", "gazebos")).toMatchObject({ receives: false, paths: [] });
  });

  it("several paths → still one decision (one message, AC-C1.3)", () => {
    const both = snap({ role: "MANAGER", grants: new Set(["gazebos"]), listModules: new Set(["gazebos"]), prefs: prefs({ "booking.created": true }) });
    expect(evaluateRoute(both, "booking.created", "gazebos")).toMatchObject({ receives: true, paths: ["personal", "module_list"] });
  });

  it("unknown event type → nothing", () => {
    expect(evaluateRoute(snap({ role: "SUPERADMIN" }), "x.y", null).receives).toBe(false);
  });
});

describe("groupChatDecision — legacy paths 1 and 3, unchanged", () => {
  it("module chat, else global; never when a list exists, chat disabled or personal-only", () => {
    expect(groupChatDecision({ chatEnabled: true, listRowCount: 0, moduleChatId: "-1" })).toMatchObject({ send: true, chatId: "-1" });
    expect(groupChatDecision({ chatEnabled: true, listRowCount: 0, globalChatId: "-9" })).toMatchObject({ send: true, chatId: "-9" });
    expect(groupChatDecision({ chatEnabled: true, listRowCount: 1, moduleChatId: "-1" }).send).toBe(false);
    expect(groupChatDecision({ chatEnabled: false, listRowCount: 0, moduleChatId: "-1" }).send).toBe(false);
    expect(groupChatDecision({ staffAudience: "personal", chatEnabled: true, listRowCount: 0, moduleChatId: "-1" }).send).toBe(false);
    expect(groupChatDecision({ chatEnabled: true, listRowCount: 0 })).toMatchObject({ send: false, reason: "no_chat_configured" });
  });
});

// Owner 2026-11-09: for ADMIN and SUPERADMIN every notification is on by
// default (wherever they have access); MANAGER keeps opt-in outside bookings.
describe("всё включено по умолчанию у ADMIN и SUPERADMIN", () => {
  it("SUPERADMIN без строк предпочтений получает каждый тип каталога хотя бы в одном контексте", () => {
    const sa = snap({ role: "SUPERADMIN" });
    for (const eventType of MANAGED_EVENT_TYPES) {
      const contexts = EVENT_MODULE_CONTEXTS[eventType];
      expect(contexts.some((ctx) => evaluateRoute(sa, eventType, ctx).receives), eventType).toBe(true);
    }
  });

  it("ADMIN со всеми грантами получает всё, кроме суперадминских звонков", () => {
    const admin = snap({ role: "ADMIN", grants: new Set(["cafe", "rental", "analytics", "avito", "monitoring"]) });
    for (const eventType of MANAGED_EVENT_TYPES) {
      const contexts = EVENT_MODULE_CONTEXTS[eventType];
      const receives = contexts.some((ctx) => evaluateRoute(admin, eventType, ctx).receives);
      expect(receives, eventType).toBe(!eventType.startsWith("telephony."));
    }
  });

  it("ADMIN без раздела не получает его по умолчанию; явное «выкл» сильнее", () => {
    const admin = snap({ role: "ADMIN" });
    expect(evaluateRoute(admin, "order.placed", "cafe").receives).toBe(false);
    expect(evaluateRoute(admin, "analytics.business_weekly", null).receives).toBe(false);
    const cafeAdmin = snap({ role: "ADMIN", grants: new Set(["cafe"]), prefs: prefs({ "order.placed": false }) });
    expect(evaluateRoute(cafeAdmin, "order.placed", "cafe").receives).toBe(false);
    expect(evaluateRoute(cafeAdmin, "order.cancelled", "cafe").receives).toBe(true);
  });

  it("MANAGER вне броней — по подписке", () => {
    const m = snap({ role: "MANAGER", grants: new Set(["cafe"]) });
    expect(evaluateRoute(m, "order.placed", "cafe").receives).toBe(false);
    expect(evaluateRoute(m, "system.release", null).receives).toBe(false);
  });
});
