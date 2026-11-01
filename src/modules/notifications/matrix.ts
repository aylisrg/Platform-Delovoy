import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { EVENT_MODULE_CONTEXTS, NOTIFICATION_CATALOG } from "./catalog";
import { explainStaffNotifications, type ExplainEvent, type ExplainStatus } from "./explain";
import type { NotificationMatrixQuery } from "./validation";

/**
 * «Сотрудники × события» (US-C4) — the same explanation as the staff page
 * (AC-C4.4), so a cell never disagrees with the delivery.
 * ADR 2026-10-25-team-access-notifications §6.2.
 */

const TEAM_ROLES: Role[] = ["SUPERADMIN", "ADMIN", "MANAGER"];

export type MatrixCell = { status: ExplainStatus; reason?: string; editable: boolean; enabled: boolean };

export type NotificationMatrix = {
  events: Array<{ eventType: string; label: string; categoryKey: string; categoryLabel: string }>;
  rows: Array<{ user: { id: string; name: string | null; role: Role }; cells: Record<string, MatrixCell> }>;
  totals: Record<string, { personalRecipients: number; groupChatOnly: boolean }>;
};

function cellReason(event: ExplainEvent, accessLabel: string | null): string | undefined {
  if (event.status === "NO_ACCESS") return accessLabel ?? undefined;
  if (event.blockers.length > 0) return event.blockers.map((b) => b.label).join(", ");
  return undefined;
}

export async function getNotificationMatrix(q: NotificationMatrixQuery = {}): Promise<NotificationMatrix> {
  const users = await prisma.user.findMany({
    where: { role: q.role ? q.role : { in: TEAM_ROLES }, mergedIntoUserId: null, id: { not: "system" } },
    select: { id: true, name: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  const explains = await explainStaffNotifications(users.map((u) => u.id));

  const categories = NOTIFICATION_CATALOG.filter((c) => !q.category || c.key === q.category);
  const events = categories.flatMap((c) =>
    c.events.map((e) => ({ eventType: e.eventType, label: e.label, categoryKey: c.key, categoryLabel: c.label })),
  );

  const allRows = users.flatMap<NotificationMatrix["rows"][number]>((u) => {
    const explain = explains.get(u.id);
    if (!explain) return [];
    const cells: Record<string, MatrixCell> = {};
    for (const category of explain.categories) {
      for (const event of category.events) {
        if (!events.some((e) => e.eventType === event.eventType)) continue;
        cells[event.eventType] = {
          status: event.status,
          reason: cellReason(event, category.access.ok ? null : category.access.label),
          editable: event.toggle.editable,
          enabled: event.toggle.enabled,
        };
      }
    }
    return [{ user: { id: u.id, name: u.name, role: u.role }, cells }];
  });

  // Group chat is the same for everybody — read it off any explanation.
  const anyExplain = explains.values().next().value;
  const totals: NotificationMatrix["totals"] = {};
  for (const event of events) {
    const personalRecipients = allRows.filter((r) => {
      const status = r.cells[event.eventType]?.status;
      return status === "RECEIVES" || status === "BLOCKED";
    }).length;
    const contexts = EVENT_MODULE_CONTEXTS[event.eventType] ?? [];
    const groupChat =
      anyExplain?.categories
        .find((c) => c.key === event.categoryKey)
        ?.groupChat.some((g) => contexts.includes(g.moduleSlug) && g.receives) ?? false;
    totals[event.eventType] = { personalRecipients, groupChatOnly: personalRecipients === 0 && groupChat };
  }

  const rows = q.problems
    ? allRows.filter((r) => Object.values(r.cells).some((c) => c.status === "BLOCKED"))
    : allRows;

  return { events, rows, totals };
}
