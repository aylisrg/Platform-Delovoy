"use client";

import type { DeletionBlocker } from "@/modules/users/types";
import { DialogShell, dangerButtonClass, secondaryButtonClass } from "./dialog-shell";

/**
 * «Удалить нельзя: у аккаунта есть история» (PRD 2026-10-25 US-A3, ADR §7).
 * Opened on `DELETE /api/users/[id]` → 409 USER_HAS_HISTORY. Lists
 * `label — count` per blocker; a team member gets «Исключить из команды» as the
 * main action, a client only the explanation and «Закрыть» (AC-A3.3). No ids,
 * no technical codes (AC-A3.4); closing changes nothing.
 */

export const DELETE_BLOCKED_TEXTS = {
  title: "Удалить нельзя: у аккаунта есть история",
  team:
    "Мы не удаляем аккаунты с журналом действий, бронями и заказами. Исключите сотрудника из команды — доступ закроется, история сохранится.",
  client: "Аккаунты с историей не удаляются. Жёсткое удаление не поддерживается.",
  unknown: "Не удалось точно определить, какие записи мешают удалению.",
  exclude: "Исключить из команды",
} as const;

export function DeleteBlockedDialog({
  userName,
  blockers,
  isTeamMember,
  onClose,
  onExclude,
}: {
  userName: string | null;
  blockers: DeletionBlocker[];
  isTeamMember: boolean;
  onClose: () => void;
  onExclude?: () => void;
}) {
  return (
    <DialogShell
      title={DELETE_BLOCKED_TEXTS.title}
      subtitle={userName || "Без имени"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Закрыть
          </button>
          {isTeamMember && onExclude && (
            <button type="button" onClick={onExclude} className={dangerButtonClass}>
              {DELETE_BLOCKED_TEXTS.exclude}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4 text-sm text-zinc-700">
        {blockers.length > 0 ? (
          <ul className="space-y-1.5" data-testid="deletion-blockers">
            {blockers.map((blocker) => (
              <li key={blocker.type} className="font-medium text-zinc-900">
                {`${blocker.label} — ${blocker.count}`}
              </li>
            ))}
          </ul>
        ) : (
          <p>{DELETE_BLOCKED_TEXTS.unknown}</p>
        )}
        <p>{isTeamMember ? DELETE_BLOCKED_TEXTS.team : DELETE_BLOCKED_TEXTS.client}</p>
      </div>
    </DialogShell>
  );
}
