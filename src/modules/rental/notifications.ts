import { prisma } from "@/lib/db";
import type {
  EmailLogStatus,
  EmailLogType,
  EmailTemplate,
  Office,
  RentalContract,
  RentalNotificationSettings,
  RentalPayment,
  Tenant,
} from "@prisma/client";
import { sendTransactionalEmail } from "@/modules/notifications/channels/email";
import { buildVariables, renderWithMissing } from "./template-engine";

export class RentalEmailError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "RentalEmailError";
  }
}

export async function getOrCreateSettings(): Promise<RentalNotificationSettings> {
  const existing = await prisma.rentalNotificationSettings.findUnique({
    where: { id: "singleton" },
  });
  if (existing) return existing;
  return prisma.rentalNotificationSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

export function resolveRecipients(tenant: Tenant): string[] {
  const primary = tenant.email ? [tenant.email] : [];
  const extra = Array.isArray(tenant.emailsExtra)
    ? (tenant.emailsExtra as unknown[]).filter(
        (v): v is string => typeof v === "string" && v.length > 0
      )
    : [];
  const deduped = new Set<string>();
  for (const email of [...primary, ...extra]) {
    const trimmed = email.trim();
    if (trimmed) deduped.add(trimmed);
  }
  return [...deduped];
}

export async function logEmail(params: {
  type: EmailLogType;
  templateKey?: string | null;
  to: string[];
  subject: string;
  bodyHtml?: string | null;
  tenantId?: string | null;
  contractId?: string | null;
  paymentId?: string | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  sentById?: string | null;
  status: EmailLogStatus;
  error?: string | null;
}) {
  return prisma.emailLog.create({
    data: {
      type: params.type,
      templateKey: params.templateKey ?? null,
      to: params.to,
      subject: params.subject,
      bodyHtml: params.bodyHtml ?? null,
      tenantId: params.tenantId ?? null,
      contractId: params.contractId ?? null,
      paymentId: params.paymentId ?? null,
      periodYear: params.periodYear ?? null,
      periodMonth: params.periodMonth ?? null,
      sentById: params.sentById ?? null,
      status: params.status,
      error: params.error ?? null,
    },
  });
}

export type ManualSendInput = {
  tenantId?: string;
  contractId?: string;
  to: string[];
  templateKey?: string;
  customSubject?: string;
  customBodyHtml?: string;
  variables?: Record<string, string>;
  sentById: string;
};

export type ManualSendResult = {
  sent: { to: string; logId: string }[];
  failed: { to: string; logId: string; error: string }[];
};

export async function sendManualEmail(input: ManualSendInput): Promise<ManualSendResult> {
  if (!input.tenantId && !input.contractId) {
    throw new RentalEmailError(
      "TARGET_REQUIRED",
      "tenantId или contractId обязателен"
    );
  }
  if (!input.templateKey && !(input.customSubject && input.customBodyHtml)) {
    throw new RentalEmailError(
      "CONTENT_REQUIRED",
      "Нужен templateKey или customSubject+customBodyHtml"
    );
  }

  const contract = input.contractId
    ? await prisma.rentalContract.findUnique({
        where: { id: input.contractId },
        include: { tenant: true, office: true },
      })
    : null;
  const tenant = contract
    ? contract.tenant
    : input.tenantId
      ? await prisma.tenant.findUnique({
          where: { id: input.tenantId, isDeleted: false },
        })
      : null;
  if (!tenant) {
    throw new RentalEmailError("TENANT_NOT_FOUND", "Арендатор не найден");
  }
  if (input.contractId && !contract) {
    throw new RentalEmailError("CONTRACT_NOT_FOUND", "Договор не найден");
  }

  const allowed = resolveRecipients(tenant);
  if (allowed.length === 0) {
    throw new RentalEmailError(
      "NO_RECIPIENT",
      "У арендатора не указан ни один email"
    );
  }

  const extras = new Set(
    input.to.map((a) => a.trim()).filter((a) => a.length > 0)
  );
  const chosen = [...extras].filter((addr) => allowed.includes(addr));
  if (chosen.length === 0) {
    throw new RentalEmailError(
      "NO_VALID_RECIPIENT",
      "Указанные адреса не совпадают с email арендатора"
    );
  }

  const settings = await getOrCreateSettings();

  let template: EmailTemplate | null = null;
  if (input.templateKey) {
    template = await prisma.emailTemplate.findUnique({
      where: { key: input.templateKey },
    });
    if (!template) {
      throw new RentalEmailError(
        "TEMPLATE_NOT_FOUND",
        `Шаблон не найден: ${input.templateKey}`
      );
    }
    if (!template.isActive) {
      throw new RentalEmailError(
        "TEMPLATE_INACTIVE",
        "Шаблон деактивирован"
      );
    }
  }

  const autoVars = contract
    ? buildVariables({ contract, payment: null, settings })
    : baseVariablesForTenant(tenant, settings);
  const vars = { ...autoVars, ...(input.variables ?? {}) };

  const rendered = template
    ? renderWithMissing(template, vars)
    : renderWithMissing(
        { subject: input.customSubject!, bodyHtml: input.customBodyHtml! },
        vars
      );

  const result: ManualSendResult = { sent: [], failed: [] };

  for (const addr of chosen) {
    const send = await sendTransactionalEmail({
      to: addr,
      from: settings.fromEmail,
      fromName: settings.fromName,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text ?? undefined,
    });
    const log = await logEmail({
      type: "MANUAL",
      templateKey: template?.key,
      to: [addr],
      subject: rendered.subject,
      bodyHtml: rendered.html,
      tenantId: tenant.id,
      contractId: contract?.id ?? null,
      sentById: input.sentById,
      status: send.success ? "SENT" : "FAILED",
      error: send.error ?? null,
    });
    if (send.success) {
      result.sent.push({ to: addr, logId: log.id });
    } else {
      result.failed.push({ to: addr, logId: log.id, error: send.error ?? "UNKNOWN" });
    }
  }

  return result;
}

function baseVariablesForTenant(
  tenant: Tenant,
  settings: RentalNotificationSettings
): Record<string, string> {
  return {
    tenantName: tenant.companyName,
    contactName: tenant.contactName?.trim() || tenant.companyName,
    contractNumber: "",
    officeNumber: "",
    building: "",
    floor: "",
    amount: "",
    currency: "",
    dueDate: "",
    periodMonth: "",
    periodYear: "",
    daysOverdue: "",
    bankDetails: settings.bankDetails ?? "",
    managerName: settings.managerName ?? "",
    managerPhone: settings.managerPhone ?? "",
    parkAddress: "Селятино, Московская область, Бизнес-парк «Деловой»",
  };
}

export type PaymentWithContract = RentalPayment & {
  contract: RentalContract & { tenant: Tenant; office: Office };
};

/**
 * Send an auto-reminder email for a payment using a system template.
 * Returns true if at least one recipient got the message.
 */
export async function sendAutoReminder(params: {
  payment: PaymentWithContract;
  templateKey: "rental.payment_reminder_pre" | "rental.payment_reminder_due";
  type: "PAYMENT_PRE_REMINDER" | "PAYMENT_DUE_REMINDER";
  settings: RentalNotificationSettings;
}): Promise<boolean> {
  const { payment, templateKey, type, settings } = params;
  const recipients = resolveRecipients(payment.contract.tenant);
  if (recipients.length === 0) return false;

  const template = await prisma.emailTemplate.findUnique({ where: { key: templateKey } });
  if (!template || !template.isActive) return false;

  const vars = buildVariables({ contract: payment.contract, payment, settings });
  const rendered = renderWithMissing(template, vars);

  let anySuccess = false;
  for (const addr of recipients) {
    const send = await sendTransactionalEmail({
      to: addr,
      from: settings.fromEmail,
      fromName: settings.fromName,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text ?? undefined,
    });
    await logEmail({
      type,
      templateKey: template.key,
      to: [addr],
      subject: rendered.subject,
      bodyHtml: rendered.html,
      tenantId: payment.contract.tenantId,
      contractId: payment.contractId,
      paymentId: payment.id,
      periodYear: payment.periodYear,
      periodMonth: payment.periodMonth,
      status: send.success ? "SENT" : "FAILED",
      error: send.error ?? null,
    });
    if (send.success) anySuccess = true;
  }
  return anySuccess;
}
