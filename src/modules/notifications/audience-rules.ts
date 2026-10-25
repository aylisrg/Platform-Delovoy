import type { Role } from "@prisma/client";
import { ADMIN_SECTIONS, STRICT_ACCESS_MODULES, computeAdminSections } from "@/lib/permissions";
import { MODULE_ACCESS_ALIAS, categoryForEvent, type ManagedCategory } from "./catalog";

/**
 * Pure staff-notification routing rules — the single source of truth used by
 * real delivery (`resolveStaffRouting`) AND by every screen (Center, staff
 * page, matrix), so «what the screen says» = «who actually gets it» (AC-C1.6).
 * No DB access here. ADR 2026-10-25-team-access-notifications §Q7.
 */

export type StaffSnapshot = {
  id: string;
  role: Role;
  merged: boolean;
  /** Explicit AdminPermission sections. */
  grants: Set<string>;
  /** Module slugs from ModuleAssignment. */
  assignments: Set<string>;
  /** NotificationEventPreference rows by eventType. */
  prefs: Map<string, { enabled: boolean }>;
  /** Modules whose recipient list contains this user (ModuleNotificationRecipient). */
  listModules: Set<string>;
};

export type DeliveryPath = "personal" | "module_list" | "role_avito" | "in_app_superadmin";

export type AccessDecision =
  | { ok: true }
  | {
      ok: false;
      reason: "NOT_STAFF" | "SUPERADMIN_ONLY" | "STRICT_GRANT_REQUIRED" | "NO_SECTION";
      label: string;
    };

export type RouteDecision = {
  /** Delivered: some accessible path and no explicit opt-out. */
  receives: boolean;
  /** Accessible paths (computed regardless of the opt-out, so callers can tell «would get it»). */
  paths: DeliveryPath[];
  /** Explicit `enabled=false` — beats every path (AC-C2.1). */
  optedOut: boolean;
  access: AccessDecision;
};

export const AVITO_EVENT = "avito.lead.new";
export const TELEPHONY_EVENT = "telephony.daily_summary";

const SECTION_LABELS = new Map<string, string>(ADMIN_SECTIONS.map((s) => [s.slug, s.label]));

function sectionLabel(slug: string): string {
  return SECTION_LABELS.get(slug) ?? slug;
}

/** Same access rule for every path; `moduleSlug` = the event's context. */
export function contextAccess(
  s: StaffSnapshot,
  category: ManagedCategory,
  moduleSlug: string | null,
  path?: DeliveryPath,
): AccessDecision {
  if (s.role === "USER" || s.merged) {
    return { ok: false, reason: "NOT_STAFF", label: "Не входит в команду" };
  }
  if (category.superadminOnly && s.role !== "SUPERADMIN") {
    return { ok: false, reason: "SUPERADMIN_ONLY", label: "Только для суперадмина" };
  }
  if (moduleSlug && STRICT_ACCESS_MODULES.has(moduleSlug) && !s.grants.has(moduleSlug)) {
    return {
      ok: false,
      reason: "STRICT_GRANT_REQUIRED",
      label: `Нужен явный доступ к «${sectionLabel(moduleSlug)}»`,
    };
  }
  if (category.staffAlways) return { ok: true };

  const sections = computeAdminSections(s.role, [...s.grants]);
  if (category.sections.some((section) => sections.includes(section))) return { ok: true };
  if (category.superadminAlways && s.role === "SUPERADMIN") return { ok: true };

  const accessModule = moduleSlug ? (MODULE_ACCESS_ALIAS[moduleSlug] ?? moduleSlug) : null;
  if (accessModule && s.assignments.has(accessModule)) return { ok: true };

  // Recipient lists have always admitted every ADMIN (setRecipientUserIds rule).
  if (path === "module_list" && s.role === "ADMIN") return { ok: true };

  return { ok: false, reason: "NO_SECTION", label: `Нет доступа к разделу «${category.label}»` };
}

/** Candidate paths before access checks. */
function candidatePaths(s: StaffSnapshot, eventType: string, moduleSlug: string | null): DeliveryPath[] {
  const paths: DeliveryPath[] = [];
  if (s.prefs.get(eventType)?.enabled === true) paths.push("personal");
  // Module recipient lists only ever fed notifyAdmin events; Avito leads go
  // by role (they never reached list members), so the list path skips them.
  if (moduleSlug && eventType !== AVITO_EVENT && s.listModules.has(moduleSlug)) paths.push("module_list");
  if (eventType === AVITO_EVENT) {
    const assigned = moduleSlug !== null && s.assignments.has(moduleSlug);
    if (s.role === "SUPERADMIN" || ((s.role === "MANAGER" || s.role === "ADMIN") && assigned)) {
      paths.push("role_avito");
    }
  }
  if (eventType === TELEPHONY_EVENT && s.role === "SUPERADMIN") paths.push("in_app_superadmin");
  return paths;
}

const UNKNOWN_ACCESS: AccessDecision = { ok: false, reason: "NO_SECTION", label: "Неизвестный тип уведомления" };

export function evaluateRoute(s: StaffSnapshot, eventType: string, moduleSlug: string | null): RouteDecision {
  const category = categoryForEvent(eventType);
  if (!category) return { receives: false, paths: [], optedOut: false, access: UNKNOWN_ACCESS };

  const optedOut = s.prefs.get(eventType)?.enabled === false;
  const paths = candidatePaths(s, eventType, moduleSlug).filter(
    (path) => contextAccess(s, category, moduleSlug, path).ok,
  );

  // Display access: the general rule, or the list rule when listed (ADMIN in a list).
  const general = contextAccess(s, category, moduleSlug);
  const access =
    !general.ok && s.listModules.has(moduleSlug ?? "")
      ? contextAccess(s, category, moduleSlug, "module_list")
      : general;

  return { receives: !optedOut && paths.length > 0, paths, optedOut, access };
}

/**
 * Group chat decision — exactly the legacy `notifyAdmin` paths 1 and 3: not a
 * personal-only event, chat not disabled, the module recipient list is empty
 * (raw row count, as the JSON list was), and some chat is configured.
 */
export function groupChatDecision(input: {
  staffAudience?: "personal";
  chatEnabled: boolean;
  listRowCount: number;
  moduleChatId?: string;
  globalChatId?: string;
}): { send: boolean; chatId?: string; reason: string } {
  if (input.staffAudience === "personal") return { send: false, reason: "personal_only" };
  if (!input.chatEnabled) return { send: false, reason: "chat_disabled" };
  if (input.listRowCount > 0) return { send: false, reason: "replaced_by_recipient_list" };
  const chatId = input.moduleChatId || input.globalChatId;
  if (!chatId) return { send: false, reason: "no_chat_configured" };
  return { send: true, chatId, reason: input.moduleChatId ? "module_chat" : "global_chat" };
}
