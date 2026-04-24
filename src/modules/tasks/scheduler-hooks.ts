// Background work for the tasks module.
// Called from src/modules/notifications/scheduler.ts so we don't start a new
// cron infrastructure — just hook into the existing one.

import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { notifyAssignee, sendDailyDigest, taskLink } from "./notifications";

/**
 * Every minute — find tasks whose remindAt is due and haven't been reminded yet,
 * notify assignee, stamp reminderSentAt, write a REMINDED event.
 */
export async function processDueReminders(): Promise<void> {
  const now = new Date();
  try {
    const tasks = await prisma.task.findMany({
      where: {
        remindAt: { lte: now },
        reminderSentAt: null,
        status: { notIn: ["DONE", "CANCELLED"] },
        assigneeUserId: { not: null },
      },
      select: {
        id: true,
        publicId: true,
        title: true,
        assigneeUserId: true,
      },
      take: 100, // cap per tick to avoid runaway work
    });

    for (const t of tasks) {
      if (!t.assigneeUserId) continue;
      await notifyAssignee(
        t.assigneeUserId,
        { publicId: t.publicId, title: t.title, link: taskLink(t.publicId) },
        "reminder"
      ).catch((err) =>
        log.warn("tasks.scheduler", `reminder notify failed: ${String(err)}`)
      );

      await prisma.task.update({
        where: { id: t.id },
        data: { reminderSentAt: now },
      });

      await prisma.taskEvent.create({
        data: { taskId: t.id, kind: "REMINDED", metadata: { at: now.toISOString() } },
      });
    }
  } catch (err) {
    await log.error(
      "tasks.scheduler",
      `processDueReminders failed: ${String(err)}`
    );
  }
}

/**
 * Once per day (scheduler's job to ensure that) — send each assignee a digest
 * of their open tasks.
 */
export async function sendDigestsToAllAssignees(): Promise<void> {
  try {
    const grouped = await prisma.task.groupBy({
      by: ["assigneeUserId"],
      where: {
        assigneeUserId: { not: null },
        status: { notIn: ["DONE", "CANCELLED"] },
      },
      _count: { id: true },
    });

    for (const g of grouped) {
      if (!g.assigneeUserId) continue;
      const open = await prisma.task.findMany({
        where: {
          assigneeUserId: g.assigneeUserId,
          status: { notIn: ["DONE", "CANCELLED"] },
        },
        select: { publicId: true, title: true, dueDate: true },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        take: 50,
      });
      await sendDailyDigest(g.assigneeUserId, open).catch((err) =>
        log.warn("tasks.scheduler", `digest failed: ${String(err)}`)
      );
    }
  } catch (err) {
    await log.error(
      "tasks.scheduler",
      `sendDigestsToAllAssignees failed: ${String(err)}`
    );
  }
}

/**
 * Poll the IMAP mailbox for new tenant emails. Only runs when
 * INBOUND_EMAIL_ENABLED=true and all creds are present. Real imapflow client
 * is loaded lazily so the import is a no-op in tests / dev without IMAP.
 */
export async function pollInbox(): Promise<void> {
  if (process.env.INBOUND_EMAIL_ENABLED !== "true") return;
  const host = process.env.INBOUND_EMAIL_HOST || "imap.yandex.ru";
  const port = Number(process.env.INBOUND_EMAIL_PORT || 993);
  const user = process.env.INBOUND_EMAIL_USER;
  const pass = process.env.INBOUND_EMAIL_PASS;
  const mailbox = process.env.INBOUND_EMAIL_MAILBOX || "INBOX";
  if (!user || !pass) {
    await log.warn("tasks.email-inbound", "INBOUND_EMAIL_ENABLED=true but user/pass missing");
    return;
  }

  let ImapFlow: unknown;
  let simpleParser: unknown;
  try {
    ({ ImapFlow } = await import("imapflow"));
    ({ simpleParser } = await import("mailparser"));
  } catch (err) {
    await log.error(
      "tasks.email-inbound",
      `IMAP libs not installed: ${String(err)}`
    );
    return;
  }

  try {
    type ClientCtor = new (cfg: Record<string, unknown>) => {
      connect(): Promise<void>;
      logout(): Promise<void>;
      mailboxOpen(name: string): Promise<void>;
      fetch(range: string, opts: Record<string, unknown>): AsyncIterable<{
        seq: number;
        uid: number;
        source: Buffer;
      }>;
      messageFlagsAdd(seq: number | string, flags: string[]): Promise<boolean>;
    };
    const client = new (ImapFlow as ClientCtor)({
      host,
      port,
      secure: true,
      auth: { user, pass },
      logger: false,
    });

    await client.connect();
    await client.mailboxOpen(mailbox);

    const { processIncomingMessage } = await import("./email-inbound");
    const { createTask, addComment } = await import("./service");
    const { categorizeByKeywords } = await import("./routing");
    const { notifyReporterConfirmation } = await import("./notifications");

    const deps = {
      findTaskByPublicId: (publicId: string) =>
        prisma.task.findUnique({
          where: { publicId },
          select: { id: true },
        }),
      findCommentByMessageId: async (messageId: string) => {
        const existing = await prisma.taskComment.findUnique({
          where: { emailMessageId: messageId },
          select: { id: true },
        });
        return !!existing;
      },
      findUserByEmail: (email: string) =>
        prisma.user.findUnique({
          where: { email: email.toLowerCase() },
          select: { id: true },
        }),
      categorizeByKeywords,
    };

    for await (const msg of client.fetch("1:*", { source: true, flags: true })) {
      const parseFn = simpleParser as (input: Buffer) => Promise<Record<string, unknown>>;
      const parsed = await parseFn(msg.source);
      const raw = parsed as {
        messageId?: string;
        subject?: string;
        text?: string;
        html?: string;
        from?: { value?: Array<{ address?: string; name?: string }> };
      };
      const from = raw.from?.value?.[0];
      const action = await processIncomingMessage(
        {
          messageId: raw.messageId,
          subject: raw.subject,
          text: raw.text,
          html: raw.html,
          from: { address: from?.address, name: from?.name },
        },
        deps
      );

      if (action.type === "comment") {
        await addComment(
          action.taskId,
          { body: action.body, source: "EMAIL" },
          {
            id: null,
            name: action.author.name,
            externalContact: action.author,
          },
          { emailMessageId: action.emailMessageId }
        );
      } else if (action.type === "new_issue") {
        const task = await createTask(
          {
            type: "ISSUE",
            source: "EMAIL",
            title: action.title,
            description: action.description,
            priority: "MEDIUM",
            categoryId: action.categoryId,
            labels: [],
            reporterUserId: action.reporterUserId,
            externalContact: action.externalContact,
          },
          { id: action.reporterUserId, source: action.reporterUserId ? "user" : "system" }
        );
        // Confirmation is sent by createTask() for ISSUE with externalContact.email.
        // Still, if createTask skipped it (no contact email) — do a safety re-send.
        if (action.externalContact.email) {
          await notifyReporterConfirmation(
            action.externalContact.email,
            task.publicId,
            task.title
          ).catch(() => {});
        }
      }

      await client.messageFlagsAdd(msg.seq, ["\\Seen"]);
    }

    await client.logout();
  } catch (err) {
    await log.error(
      "tasks.email-inbound",
      `poll failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
