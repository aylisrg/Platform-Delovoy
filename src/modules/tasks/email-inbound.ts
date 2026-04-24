// Inbound email processing: "someone emailed reports@… → create or update Task".
//
// The pure piece — processIncomingMessage — takes a parsed mail object and a
// set of lookup/factory functions (deps) and decides what to do. It's fully
// unit-testable: no IMAP, no DB, no network.
//
// The impure piece — pollInbox — opens an IMAP connection (imapflow),
// fetches UNSEEN messages in INBOUND_EMAIL_MAILBOX, feeds them through
// mailparser, and hands each one to processIncomingMessage wired to real
// Prisma + service helpers.

import { parsePublicId } from "./public-id";
import DOMPurify from "isomorphic-dompurify";

export type ParsedMail = {
  messageId?: string;
  from?: { address?: string; name?: string };
  subject?: string;
  text?: string;
  html?: string;
};

export type InboundAction =
  | {
      type: "comment";
      taskId: string;
      emailMessageId: string;
      body: string;
      author: { email: string; name: string };
    }
  | {
      type: "new_issue";
      reporterUserId: string | null;
      title: string;
      description: string;
      categoryId: string | null;
      externalContact: { email: string; name: string };
    }
  | { type: "skip"; reason: string };

export type InboundDeps = {
  findTaskByPublicId: (publicId: string) => Promise<{ id: string } | null>;
  findCommentByMessageId: (messageId: string) => Promise<boolean>;
  findUserByEmail: (email: string) => Promise<{ id: string } | null>;
  categorizeByKeywords: (text: string) => Promise<string | null>;
};

export async function processIncomingMessage(
  mail: ParsedMail,
  deps: InboundDeps
): Promise<InboundAction> {
  const fromEmail = mail.from?.address?.toLowerCase().trim();
  if (!fromEmail) {
    return { type: "skip", reason: "no sender" };
  }

  const subject = (mail.subject ?? "").trim();
  const messageId = mail.messageId ?? "";
  const fromName = (mail.from?.name ?? fromEmail).trim();

  // Prefer plain text; fall back to sanitized HTML (strips scripts/styles/img/links).
  let body = (mail.text ?? "").trim();
  if (!body && mail.html) {
    body = sanitizeHtmlToText(mail.html);
  }
  body = body.trim();
  if (!body) {
    return { type: "skip", reason: "empty body" };
  }

  // Reply to existing ticket? We look at subject for [TASK-XXXXX].
  const ticketId = parsePublicId(subject);
  if (ticketId) {
    const task = await deps.findTaskByPublicId(ticketId);
    if (task) {
      if (messageId) {
        const already = await deps.findCommentByMessageId(messageId);
        if (already) return { type: "skip", reason: "duplicate messageId" };
      }
      return {
        type: "comment",
        taskId: task.id,
        emailMessageId: messageId,
        body,
        author: { email: fromEmail, name: fromName },
      };
    }
    // Referenced ticket not found — treat as new
  }

  // New issue
  const existingUser = await deps.findUserByEmail(fromEmail);
  const categoryId = await deps.categorizeByKeywords(`${subject}\n${body}`);

  const title =
    subject.length > 0
      ? subject.slice(0, 200)
      : body.slice(0, 80) + (body.length > 80 ? "…" : "");

  return {
    type: "new_issue",
    reporterUserId: existingUser?.id ?? null,
    title,
    description: body,
    categoryId,
    externalContact: { email: fromEmail, name: fromName },
  };
}

function sanitizeHtmlToText(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["br", "p", "div", "span"],
    ALLOWED_ATTR: [],
  });
  // Replace block-level tags with newlines, then strip remaining tags.
  const withBreaks = clean
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(withBreaks).replace(/\n{3,}/g, "\n\n").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
