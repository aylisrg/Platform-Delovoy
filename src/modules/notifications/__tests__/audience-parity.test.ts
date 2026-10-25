import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    notificationEventPreference: { findMany: vi.fn() },
    moduleNotificationRecipient: { findMany: vi.fn(), count: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { EVENT_MODULE_CONTEXTS, MANAGED_EVENT_TYPES } from "../catalog";
import { resolveStaffRouting, toStaffSnapshot } from "../audience";
import { buildExplain } from "../explain";
import { installStaffFixtures, toSnapshotRow, type StaffFixture } from "./helpers/staff-fixture";

/**
 * AC-C1.6 «экран говорит правду»: for every catalog event × module context,
 * the recipients of the REAL delivery resolver (incl. its candidate queries)
 * must equal the people the screens show as receiving — 0 mismatches across
 * every combination of role × grants × assignment × list × preference × merged.
 */
const ROLES: Role[] = ["SUPERADMIN", "ADMIN", "MANAGER", "USER"];
const GRANTS = [[], ["gazebos"], ["cafe"], ["avito"], ["rental"], ["nedelovoy"]];
const ASSIGNMENTS = [[], ["gazebos"], ["cafe"], ["rental"]];
const LISTS = [[], ["gazebos"], ["cafe"], ["rental"]];
const PREF_STATES: Array<boolean | undefined> = [undefined, true, false];

function population(eventType: string): StaffFixture[] {
  const out: StaffFixture[] = [];
  let n = 0;
  for (const role of ROLES)
    for (const grants of GRANTS)
      for (const assignments of ASSIGNMENTS)
        for (const lists of LISTS)
          for (const pref of PREF_STATES)
            for (const merged of [false, true]) {
              out.push({
                id: `u${n++}`,
                role,
                merged,
                grants,
                assignments,
                lists,
                prefs: pref === undefined ? {} : { [eventType]: pref },
              });
            }
  return out;
}

let staff: StaffFixture[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  installStaffFixtures(prisma as never, () => staff);
});

describe("AC-C1.6 parity: delivery resolver = screen", () => {
  it.each(MANAGED_EVENT_TYPES.map((e) => [e]))("%s — 0 mismatches in every module context", async (eventType) => {
    staff = population(eventType);
    const screens = staff.map((s) =>
      buildExplain({
        snapshot: toStaffSnapshot(toSnapshotRow(s)),
        telegramId: null,
        channels: [],
        prefRows: new Map(),
        global: null,
        botStatus: { state: "NOT_LINKED" },
        groupChat: new Map(),
        actorNames: new Map(),
        channelAvailable: () => true,
        now: new Date("2026-10-25T10:00:00Z"),
      }),
    );

    let checked = 0;
    for (const moduleSlug of EVENT_MODULE_CONTEXTS[eventType]) {
      const routing = await resolveStaffRouting({ eventType, moduleSlug });
      const delivered = new Set(routing.recipients.map((r) => r.userId));
      const onScreen = new Set(
        screens
          .filter((screen) =>
            screen.categories
              .flatMap((c) => c.events)
              .find((e) => e.eventType === eventType)
              ?.contexts.find((ctx) => ctx.moduleSlug === moduleSlug)?.receives,
          )
          .map((screen) => screen.userId),
      );
      expect([...delivered].filter((id) => !onScreen.has(id))).toEqual([]);
      expect([...onScreen].filter((id) => !delivered.has(id))).toEqual([]);
      checked++;
    }
    expect(checked).toBe(EVENT_MODULE_CONTEXTS[eventType].length);

    // Status on screen is consistent: «получает / не дойдёт» ⇔ some context delivers.
    for (const screen of screens) {
      const ev = screen.categories.flatMap((c) => c.events).find((e) => e.eventType === eventType)!;
      const anyContext = ev.contexts.some((c) => c.receives);
      expect(ev.status === "RECEIVES" || ev.status === "BLOCKED").toBe(anyContext);
      expect(ev.toggle.enabled).toBe(anyContext);
    }
  });

  it("personal-only events reach exactly the explicit subscribers with access", async () => {
    staff = population("booking.created");
    const routing = await resolveStaffRouting({ eventType: "booking.created", moduleSlug: "gazebos", staffAudience: "personal" });
    for (const r of routing.recipients) expect(r.paths).toEqual(["personal"]);
    const expected = staff.filter(
      (s) =>
        s.role !== "USER" &&
        !s.merged &&
        s.prefs?.["booking.created"] === true &&
        (s.role === "SUPERADMIN" || s.role === "ADMIN" || (s.grants ?? []).includes("gazebos") || (s.assignments ?? []).includes("gazebos")),
    );
    expect(new Set(routing.recipients.map((r) => r.userId))).toEqual(new Set(expected.map((s) => s.id)));
    expect(routing.suppressed).toEqual([]);
  });

  it("opted-out people with a path are reported as suppressed, never delivered", async () => {
    staff = population("order.placed");
    const routing = await resolveStaffRouting({ eventType: "order.placed", moduleSlug: "cafe" });
    const suppressed = new Set(routing.suppressed.map((s) => s.userId));
    for (const s of staff.filter((x) => suppressed.has(x.id))) expect(s.prefs?.["order.placed"]).toBe(false);
    for (const r of routing.recipients) expect(suppressed.has(r.userId)).toBe(false);
    expect(suppressed.size).toBeGreaterThan(0);
  });
});
