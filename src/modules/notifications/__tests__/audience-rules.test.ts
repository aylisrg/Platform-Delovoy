import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import { categoryForEvent } from "../catalog";
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
  it("explicit «on» adds the personal path; no row = no subscription", () => {
    const m = snap({ role: "MANAGER", grants: new Set(["gazebos"]) });
    expect(evaluateRoute(m, "booking.created", "gazebos")).toMatchObject({ receives: false, paths: [] });
    expect(evaluateRoute({ ...m, prefs: prefs({ "booking.created": true }) }, "booking.created", "gazebos")).toMatchObject({
      receives: true, paths: ["personal"],
    });
  });

  it("list member receives; explicit «off» beats the list", () => {
    const listed = snap({ role: "MANAGER", assignments: new Set(["gazebos"]), listModules: new Set(["gazebos"]) });
    expect(evaluateRoute(listed, "booking.created", "gazebos")).toMatchObject({ receives: true, paths: ["module_list"] });
    expect(evaluateRoute({ ...listed, prefs: prefs({ "booking.created": false }) }, "booking.created", "gazebos")).toMatchObject({
      receives: false, optedOut: true, paths: ["module_list"],
    });
    // the list of another module doesn't count
    expect(evaluateRoute(listed, "booking.created", "ps-park").receives).toBe(false);
  });

  it("Avito by role: SUPERADMIN always, MANAGER/ADMIN assigned to the lead module; «off» wins", () => {
    expect(evaluateRoute(snap({ role: "SUPERADMIN" }), "avito.lead.new", null)).toMatchObject({ receives: true, paths: ["role_avito"] });
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
