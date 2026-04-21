import type { Office, RentalContract, RentalNotificationSettings, RentalPayment, Tenant } from "@prisma/client";

export const ALLOWED_VARIABLES = [
  "tenantName",
  "contactName",
  "contractNumber",
  "officeNumber",
  "building",
  "floor",
  "amount",
  "currency",
  "dueDate",
  "periodMonth",
  "periodYear",
  "daysOverdue",
  "bankDetails",
  "managerName",
  "managerPhone",
  "parkAddress",
] as const;

export type AllowedVariable = (typeof ALLOWED_VARIABLES)[number];

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

export function extractPlaceholders(tpl: string): string[] {
  const found = new Set<string>();
  for (const m of tpl.matchAll(PLACEHOLDER_RE)) found.add(m[1]);
  return [...found];
}

export function validateTemplate(
  ...parts: string[]
): { ok: true } | { ok: false; invalid: string[] } {
  const used = new Set<string>();
  for (const part of parts) {
    for (const v of extractPlaceholders(part)) used.add(v);
  }
  const whitelist = new Set<string>(ALLOWED_VARIABLES);
  const invalid = [...used].filter((v) => !whitelist.has(v));
  return invalid.length ? { ok: false, invalid } : { ok: true };
}

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(PLACEHOLDER_RE, (_, key) => (key in vars ? vars[key] : ""));
}

const RU_MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

export function formatDateRu(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const y = date.getUTCFullYear();
  return `${d}.${m}.${y}`;
}

export function formatMoney(value: number | string, currency = "RUB"): string {
  const num = typeof value === "string" ? Number(value) : value;
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(num) ? num : 0);
  const symbol = currency === "RUB" ? "₽" : currency;
  return `${formatted} ${symbol}`;
}

export function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export type TemplateContext = {
  contract: RentalContract & { tenant: Tenant; office: Office };
  payment?: RentalPayment | null;
  settings: Pick<
    RentalNotificationSettings,
    "bankDetails" | "managerName" | "managerPhone"
  >;
  now?: Date;
};

export function buildVariables(ctx: TemplateContext): Record<string, string> {
  const { contract, payment, settings, now = new Date() } = ctx;
  const amountValue = payment ? Number(payment.amount) : Number(contract.monthlyRate);
  const currency = payment?.currency ?? contract.currency;
  const daysOverdue = payment ? Math.max(0, daysBetween(now, payment.dueDate)) : 0;
  const month = payment ? RU_MONTHS[payment.periodMonth - 1] ?? "" : "";

  return {
    tenantName: contract.tenant.companyName,
    contactName: contract.tenant.contactName?.trim() || contract.tenant.companyName,
    contractNumber: contract.contractNumber?.trim() || "б/н",
    officeNumber: contract.office.number,
    building: String(contract.office.building),
    floor: String(contract.office.floor),
    amount: formatMoney(amountValue, currency),
    currency,
    dueDate: payment ? formatDateRu(payment.dueDate) : "",
    periodMonth: month,
    periodYear: payment ? String(payment.periodYear) : "",
    daysOverdue: String(daysOverdue),
    bankDetails: settings.bankDetails ?? "",
    managerName: settings.managerName ?? "",
    managerPhone: settings.managerPhone ?? "",
    parkAddress: "Селятино, Московская область, Бизнес-парк «Деловой»",
  };
}

export function renderWithMissing(
  template: { subject: string; bodyHtml: string; bodyText?: string | null },
  vars: Record<string, string>
): { subject: string; html: string; text: string | null; missingVars: string[] } {
  const usedInSubject = extractPlaceholders(template.subject);
  const usedInHtml = extractPlaceholders(template.bodyHtml);
  const usedInText = template.bodyText ? extractPlaceholders(template.bodyText) : [];
  const all = new Set<string>([...usedInSubject, ...usedInHtml, ...usedInText]);
  const missingVars = [...all].filter((v) => !(v in vars) || vars[v] === "");

  return {
    subject: renderTemplate(template.subject, vars),
    html: renderTemplate(template.bodyHtml, vars),
    text: template.bodyText ? renderTemplate(template.bodyText, vars) : null,
    missingVars,
  };
}
