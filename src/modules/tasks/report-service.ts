import type { Office } from "@prisma/client";
import { prisma } from "@/lib/db";
import { matchOffice, type OfficeRecord } from "./office-matcher";
import { categorizeByKeywords } from "./routing";
import { createTask } from "./service";
import type { ReportTaskPayload } from "./validation";
import { TaskValidationError } from "./access";
import { EmailChannel } from "@/modules/notifications/dispatch/channels/email";

export class OfficeAmbiguousError extends Error {
  candidates: { id: string; label: string }[];
  constructor(candidates: { id: string; label: string }[]) {
    super("Найдено несколько офисов с этим номером");
    this.name = "OfficeAmbiguousError";
    this.candidates = candidates;
  }
}

/**
 * Public report submission entry. No auth.
 * Returns publicId on success. Throws OfficeAmbiguousError on multi-match.
 */
export async function submitPublicReport(
  payload: ReportTaskPayload,
  meta: { ip?: string; userAgent?: string }
): Promise<{ publicId: string }> {
  let officeId: string | null = payload.officeId ?? null;

  if (!officeId && payload.officeNumber) {
    const officeRecords = await prisma.office.findMany({
      select: { id: true, number: true, building: true, floor: true },
    });
    const records: OfficeRecord[] = officeRecords.map((o) => ({
      id: o.id,
      number: o.number,
      building: o.building,
      floor: o.floor,
    }));
    const result = matchOffice(payload.officeNumber, records);

    if (result.exact) {
      officeId = result.exact.id;
    } else if (result.candidates.length > 0 && payload.ambiguityResolution !== "unknown") {
      throw new OfficeAmbiguousError(
        result.candidates.map((c) => ({
          id: c.id,
          label: formatOfficeLabel(c, officeRecords),
        }))
      );
    }
  }

  // Categorization: explicit > keyword auto-match > "uncategorized"
  let categoryId: string | null = null;
  const allCategories = await prisma.taskCategory.findMany({
    where: { isArchived: false },
    select: { id: true, slug: true, keywords: true, sortOrder: true },
  });
  if (payload.category) {
    const explicit = allCategories.find((c) => c.slug === payload.category);
    if (explicit) categoryId = explicit.id;
  }
  if (!categoryId) {
    categoryId = categorizeByKeywords(payload.description, allCategories);
  }
  if (!categoryId) {
    const uncategorized = allCategories.find((c) => c.slug === "uncategorized");
    categoryId = uncategorized?.id ?? null;
  }

  const externalContact: Record<string, string> = {};
  if (payload.name) externalContact.name = payload.name;
  if (payload.email) externalContact.email = payload.email;
  if (payload.phone) externalContact.phone = payload.phone;
  if (payload.officeNumber) externalContact.officeNumber = payload.officeNumber;

  const title =
    payload.title?.trim() ||
    payload.description.slice(0, 80).replace(/\s+/g, " ").trim() ||
    "Обращение арендатора";

  const result = await createTask({
    data: {
      title,
      description: payload.description,
      categoryId: categoryId ?? undefined,
      source: "WEB",
      reporterUserId: null,
      externalContact,
      officeId: officeId ?? null,
    },
    actorUserId: null,
    actorRole: null,
  });

  await prisma.auditLog.create({
    data: {
      userId: "system",
      action: "task.report",
      entity: "Task",
      entityId: result.id,
      metadata: {
        publicId: result.publicId,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        hasEmail: Boolean(payload.email),
        hasPhone: Boolean(payload.phone),
      },
    },
  });

  // AC-013 — fire-and-forget reporter confirmation email
  if (payload.email) {
    const trackingUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/track/${result.publicId}`;
    const channel = new EmailChannel();
    void channel
      .send(payload.email, {
        title: `Обращение принято · ${result.publicId}`,
        body: `Здравствуйте${payload.name ? ", " + payload.name : ""}!\n\nВаше обращение зарегистрировано под номером ${result.publicId}.\n\nОтслеживать статус: ${trackingUrl}\n\n— Деловой Парк`,
        actions: [{ label: "Открыть статус", url: trackingUrl }],
        metadata: { entityType: "Task", entityId: result.id, publicId: result.publicId },
      })
      .catch((err) => {
        console.error("[tasks/report] reporter confirmation email failed", err);
      });
  }

  return { publicId: result.publicId };
}

function formatOfficeLabel(
  rec: OfficeRecord,
  full: Pick<Office, "id" | "number" | "building" | "floor">[]
): string {
  const f = full.find((o) => o.id === rec.id);
  if (!f) return rec.number;
  return `${f.number}, корпус ${f.building}, ${f.floor} этаж`;
}

export async function suggestOffices(
  query: string
): Promise<{ id: string; label: string; number: string }[]> {
  const all = await prisma.office.findMany({
    select: { id: true, number: true, building: true, floor: true, status: true },
    orderBy: { number: "asc" },
    take: 200,
  });
  // exclude reserved/maintenance — only AVAILABLE/OCCUPIED visible
  const records: OfficeRecord[] = all
    .filter((o) => o.status === "AVAILABLE" || o.status === "OCCUPIED")
    .map((o) => ({ id: o.id, number: o.number, building: o.building, floor: o.floor }));

  const result = matchOffice(query, records);
  const out: { id: string; label: string; number: string }[] = [];
  if (result.exact) {
    out.push({
      id: result.exact.id,
      label: formatOfficeLabel(result.exact, all),
      number: result.exact.number,
    });
  }
  for (const c of result.candidates) {
    if (out.find((o) => o.id === c.id)) continue;
    out.push({ id: c.id, label: formatOfficeLabel(c, all), number: c.number });
  }
  return out.slice(0, 10);
}

export async function getPublicTask(
  publicId: string,
  visitor: { email?: string }
): Promise<{
  publicId: string;
  title: string;
  status: string;
  columnName: string;
  columnIsTerminal: boolean;
  createdAt: Date;
  closedAt: Date | null;
  visibleComments: { body: string; createdAt: Date; authorName: string | null }[];
} | null> {
  const task = await prisma.task.findUnique({
    where: { publicId },
    include: {
      column: true,
      comments: {
        where: { visibleToReporter: true },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { name: true } } },
      },
    },
  });
  if (!task || task.deletedAt) return null;

  // Email gating: if reporter saved an email in externalContact, require match
  const ext = task.externalContact as { email?: string } | null;
  if (ext?.email && visitor.email && ext.email.toLowerCase() !== visitor.email.toLowerCase()) {
    throw new TaskValidationError("EMAIL_MISMATCH", "Email не совпадает с отправителем");
  }

  return {
    publicId: task.publicId,
    title: task.title,
    status: task.column.name,
    columnName: task.column.name,
    columnIsTerminal: task.column.isTerminal,
    createdAt: task.createdAt,
    closedAt: task.closedAt,
    visibleComments: task.comments.map((c) => ({
      body: c.body,
      createdAt: c.createdAt,
      authorName: c.author?.name ?? null,
    })),
  };
}
