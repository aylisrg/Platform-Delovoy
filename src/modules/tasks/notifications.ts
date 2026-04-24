// Task-specific notifications. Kept separate from the generic notifications
// framework (src/modules/notifications/service.ts) to avoid registering every
// task event in the global EVENT_ROUTING table — tasks have many event types
// and they're module-internal.
//
// Channels:
//   - Email   → sendTransactionalEmail() (Yandex SMTP via nodemailer)
//   - Telegram→ telegramAdapter.send() (Grammy bot)

import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { sendTransactionalEmail } from "@/modules/notifications/channels/email";
import { telegramAdapter } from "@/modules/notifications/channels/telegram";

type Recipient = {
  id: string;
  email: string | null;
  telegramId: string | null;
};

type TaskContext = {
  publicId: string;
  title: string;
  link: string;
  actorName?: string | null;
};

export async function notifyAssignee(
  userId: string,
  ctx: TaskContext,
  reason: "assigned" | "commented" | "reminder" | "mentioned"
): Promise<void> {
  const user = await loadRecipient(userId);
  if (!user) return;

  const subjects: Record<typeof reason, string> = {
    assigned: `Задача ${ctx.publicId}: назначена вам`,
    commented: `Задача ${ctx.publicId}: новый комментарий`,
    reminder: `Напоминание по задаче ${ctx.publicId}`,
    mentioned: `Вас упомянули в задаче ${ctx.publicId}`,
  };

  const lines: Record<typeof reason, string> = {
    assigned: `Вам назначена задача ${ctx.publicId}: «${ctx.title}».`,
    commented: `Новый комментарий в задаче ${ctx.publicId} «${ctx.title}»${
      ctx.actorName ? ` от ${ctx.actorName}` : ""
    }.`,
    reminder: `Напоминание: задача ${ctx.publicId} «${ctx.title}».`,
    mentioned: `${ctx.actorName ?? "Коллега"} упомянул вас в задаче ${ctx.publicId} «${ctx.title}».`,
  };

  await dispatch(user, {
    subject: subjects[reason],
    textLead: lines[reason],
    link: ctx.link,
  });
}

export async function notifyReporterConfirmation(
  recipientEmail: string,
  publicId: string,
  title: string
): Promise<void> {
  const subject = `Ваша заявка принята: ${publicId}`;
  const html = htmlWrap(
    `<p>Здравствуйте!</p>
     <p>Мы получили вашу заявку.</p>
     <p><strong>Тикет:</strong> ${escape(publicId)}<br/>
        <strong>Тема:</strong> ${escape(title)}</p>
     <p>Чтобы добавить комментарий или уточнение — просто ответьте на это письмо. Не удаляйте пометку <code>[${escape(
       publicId
     )}]</code> из темы, иначе мы не поймём, к какой заявке относится ответ.</p>
     <p>С уважением,<br/>команда Делового Парка</p>`
  );
  const text = `Мы получили вашу заявку.\nТикет: ${publicId}\nТема: ${title}\n\nЧтобы добавить комментарий — просто ответьте на это письмо, сохранив пометку [${publicId}] в теме.\n\nКоманда Делового Парка`;

  const result = await sendTransactionalEmail({
    to: recipientEmail,
    subject,
    html,
    text,
  });
  if (!result.success) {
    await log.error(
      "tasks.notifications",
      `Failed to send reporter confirmation for ${publicId}: ${result.error ?? "unknown"}`
    );
  }
}

/**
 * Daily digest: "сегодня на тебе N задач". Fires at 09:00 MSK.
 * Takes assignee user + their open tasks already aggregated.
 */
export async function sendDailyDigest(
  userId: string,
  openTasks: Array<{ publicId: string; title: string; dueDate: Date | null }>
): Promise<void> {
  if (!openTasks.length) return;
  const user = await loadRecipient(userId);
  if (!user) return;

  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const overdue = openTasks.filter(
    (t) => t.dueDate && t.dueDate < now
  );
  const today = openTasks.filter(
    (t) => t.dueDate && t.dueDate >= now && t.dueDate <= todayEnd
  );

  const subject = `Задачи на сегодня: ${openTasks.length}${
    overdue.length ? ` (просрочено: ${overdue.length})` : ""
  }`;

  const listItem = (t: { publicId: string; title: string; dueDate: Date | null }) =>
    `<li>${escape(t.publicId)} — ${escape(t.title)}${
      t.dueDate ? ` <span style="color:#888">(${t.dueDate.toLocaleDateString("ru-RU")})</span>` : ""
    }</li>`;

  const html = htmlWrap(
    `<h2>Ваши задачи</h2>
     ${overdue.length ? `<h3 style="color:#c00">Просрочены</h3><ul>${overdue.map(listItem).join("")}</ul>` : ""}
     ${today.length ? `<h3>Сегодня</h3><ul>${today.map(listItem).join("")}</ul>` : ""}
     <h3>Все открытые</h3>
     <ul>${openTasks.map(listItem).join("")}</ul>`
  );

  const text = openTasks
    .map((t) => `- ${t.publicId} ${t.title}${t.dueDate ? ` [${t.dueDate.toLocaleDateString("ru-RU")}]` : ""}`)
    .join("\n");

  if (user.email) {
    await sendTransactionalEmail({ to: user.email, subject, html, text });
  }
  if (user.telegramId) {
    await telegramAdapter.send(user.telegramId, `${subject}\n\n${text}`);
  }
}

// ─── internal helpers ─────────────────────────────────────────────────────

async function loadRecipient(userId: string): Promise<Recipient | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, telegramId: true },
  });
}

async function dispatch(
  user: Recipient,
  msg: { subject: string; textLead: string; link: string }
) {
  const text = `${msg.textLead}\n\nОткрыть: ${msg.link}`;
  const html = htmlWrap(
    `<p>${escape(msg.textLead)}</p>
     <p><a href="${escape(msg.link)}">Открыть задачу</a></p>`
  );

  const tasks: Promise<unknown>[] = [];

  if (user.telegramId) {
    tasks.push(
      telegramAdapter
        .send(user.telegramId, text)
        .catch((err) =>
          log.warn(
            "tasks.notifications",
            `TG send failed for user ${user.id}: ${String(err)}`
          )
        )
    );
  }
  if (user.email) {
    tasks.push(
      sendTransactionalEmail({
        to: user.email,
        subject: msg.subject,
        html,
        text,
      }).then((r) => {
        if (!r.success) {
          return log.warn(
            "tasks.notifications",
            `Email send failed for user ${user.id}: ${r.error ?? "unknown"}`
          );
        }
      })
    );
  }

  await Promise.allSettled(tasks);
}

function htmlWrap(inner: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5;color:#222">${inner}</body></html>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the absolute link to a task card for use in notifications.
 * Falls back to a relative path if NEXT_PUBLIC_APP_URL is not set.
 */
export function taskLink(publicId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return `${base}/admin/tasks/${publicId}`;
}
