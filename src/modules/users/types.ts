import type { Role } from "@prisma/client";

export interface UserListItem {
  id: string;
  email: string | null;
  name: string | null;
  role: Role;
  phone: string | null;
  createdAt: Date;
}

/** Roles that make an account part of the team (PRD 2026-10-25 glossary). */
export type TeamRole = Exclude<Role, "USER">;

export const TEAM_ROLES: ReadonlySet<Role> = new Set<Role>(["SUPERADMIN", "ADMIN", "MANAGER"]);

/** Rank for demotion/promotion: SUPERADMIN 3 > ADMIN 2 > MANAGER 1 > USER 0. */
export const ROLE_RANK: Record<Role, number> = {
  USER: 0,
  MANAGER: 1,
  ADMIN: 2,
  SUPERADMIN: 3,
};

// ─── Exclusion from the team (ADR 2026-10-25 §5.1) ──────────────────────────

export type ExclusionVia = "exclude" | "role_change";

export type ExclusionGuardCode =
  | "CANNOT_EXCLUDE_SELF"
  | "LAST_SUPERADMIN"
  | "NOT_IN_TEAM"
  | "ALREADY_EXCLUDED";

/**
 * What the confirmation window shows (AC-A1.2). Lists are human labels
 * (section / module names, event labels) — the preview is UI-facing only.
 */
export interface ExclusionPreview {
  user: { id: string; name: string | null; role: Role };
  isSeededSuperadmin: boolean;
  removes: {
    /** Sections the role grants by itself (gone together with the role). */
    sectionsByRole: string[];
    /** Explicit AdminPermission grants (deleted). */
    explicitSections: string[];
    modules: string[];
    recipientLists: string[];
    subscriptions: string[];
  };
  counts: { sections: number; modules: number; recipientLists: number; subscriptions: number };
  /** Open tasks where the user is RESPONSIBLE/COLLABORATOR — they stay with him. */
  openAssignedTasks: number;
  guard: null | { code: ExclusionGuardCode; message: string };
}

/** Exactly what was deleted — slugs / event types (also written to AuditLog). */
export interface ExclusionRemoved {
  sections: string[];
  modules: string[];
  recipientLists: string[];
  subscriptions: string[];
}

export interface ExclusionResult {
  userId: string;
  role: "USER";
  removed: ExclusionRemoved;
  sessionsRevoked: true;
}

export type ChangeRoleResult =
  | { kind: "unchanged"; oldRole: Role; newRole: Role }
  | { kind: "excluded"; oldRole: Role; newRole: "USER"; exclusion: ExclusionResult }
  | { kind: "demoted"; oldRole: Role; newRole: Role; sessionsRevoked: true }
  | { kind: "promoted"; oldRole: Role; newRole: Role };

// ─── Deletion blockers (ADR 2026-10-25 §5.1, AC-A3.1) ───────────────────────

export interface DeletionBlocker {
  type: string;
  label: string;
  count: number;
}

// ─── Section grants (permissions modal, ADR 2026-10-25 §6.2) ────────────────

export interface SectionOption {
  slug: string;
  label: string;
  icon: string;
}

export interface UserPermissionsView {
  userId: string;
  userName: string | null;
  userRole: Role;
  /** Read-only: the role yields these by itself. */
  roleSections: SectionOption[];
  /** Non-strict sections a SUPERADMIN may grant or revoke. */
  grantableSections: SectionOption[];
  /** Strict sections — explicit grant for everyone (НеДеловой). */
  strictSections: SectionOption[];
  /** Explicit grants within grantable ∪ strict. */
  granted: string[];
  notes: { superadminStrictAutoGrant: boolean };
}

export interface UserPermissionsUpdateResult {
  userId: string;
  granted: string[];
}
