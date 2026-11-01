import { dispatch } from "@/modules/notifications/dispatch/dispatcher";
import { resolveStaffRouting } from "@/modules/notifications/audience";
import { recordSkips } from "@/modules/notifications/skips";

/**
 * «Новый лид с Авито» → staff. Recipients come from the shared resolver
 * (ADR 2026-10-25-team-access-notifications §Q7): SUPERADMINs and MANAGER/ADMIN
 * assigned to the lead's module, plus personal subscribers; an explicit «выкл»
 * in the Center or on the staff page wins over the role and is recorded as a
 * delivery skip.
 */
export type LeadNotifyInput = {
  taskId: string;
  publicId: string;
  moduleSlug: string | null;
  title: string;
  body: string;
  reopened: boolean;
  created: boolean;
};

export async function dispatchLeadNotification(input: LeadNotifyInput): Promise<void> {
  if (!input.created && !input.reopened) return; // existing chat — no extra noise

  const eventType = "avito.lead.new";
  const routing = await resolveStaffRouting({ eventType, moduleSlug: input.moduleSlug });
  await recordSkips(
    routing.suppressed.map(({ userId }) => ({
      userId,
      eventType,
      entityType: "Task",
      entityId: input.taskId,
      reason: "OPTED_OUT" as const,
    }))
  );
  const recipients = routing.recipients.map((r) => r.userId);
  if (recipients.length === 0) return;

  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/admin/tasks/${input.publicId}`;
  await Promise.all(
    recipients.map((userId) =>
      dispatch({
        userId,
        eventType,
        entityType: "Task",
        entityId: input.taskId,
        payload: {
          title: `Новый лид с Авито (${input.publicId})`,
          body: `${input.title}\n\n${input.body.slice(0, 240)}`,
          actions: [{ label: "Открыть задачу", url }],
        },
      }).catch(() => undefined)
    )
  );
}
