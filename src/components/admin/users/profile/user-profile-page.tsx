"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { UserOverview } from "@/modules/users/team";
import type { DeletionBlocker } from "@/modules/users/types";
import { BotStatusBadge, botStatusHint } from "../bot-status-badge";
import { ExcludeDialog } from "../exclude-dialog";
import { DeleteBlockedDialog } from "../delete-blocked-dialog";
import { PermissionsModal } from "../permissions-modal";
import { ConfirmDialog } from "../dialog-shell";
import { MergeWizard } from "../merge-wizard";
import { ResetPasswordModal } from "../users-list";
import { NotificationsBlock } from "./notifications-block";
import { UserStatsBlock } from "./stats-block";

/**
 * Страница сотрудника (US-B1): профиль и идентичности, ревью прав,
 * «кто что получает», статистика и действия. ADR 2026-10-25 §7.
 */

type Loaded = Extract<UserOverview, { kind: "user" }>;

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: "Суперадмин",
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
  USER: "Пользователь",
};

const AUTH_LABELS: Record<string, string> = {
  telegram: "Telegram",
  credentials: "Email и пароль",
  "vk-id": "VK ID",
  "telegram-token": "Вход через бота",
  "magic-link": "Ссылка на email",
};

function formatDate(iso: string | null, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })
    : d.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 py-1 text-sm">
      <dt className="w-40 shrink-0 text-zinc-500">{label}</dt>
      <dd className="text-zinc-900">{children}</dd>
    </div>
  );
}

export function UserProfilePage({ userId }: { userId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPermissions, setShowPermissions] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [exclude, setExclude] = useState<null | "exclude" | "role_change">(null);
  const [roleChange, setRoleChange] = useState<{ role: string; seeded: boolean; error: string | null; busy: boolean } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ busy: boolean; error: string | null } | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<{ blockers: DeletionBlocker[]; isTeamMember: boolean } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [merge, setMerge] = useState<{ secondaryId?: string; mergeRequestId?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/users/${userId}/overview`);
      const body = await res.json();
      if (!body.success) {
        setError(body.error?.message ?? "Пользователь не найден");
        return;
      }
      const overview = body.data as UserOverview;
      if (overview.kind === "merged") {
        router.replace(`/admin/users/${overview.primaryUserId}?mergedFrom=1`);
        return;
      }
      setData(overview);
      setError(null);
    } catch {
      setError("Ошибка сети");
    }
  }, [userId, router]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const refresh = () => setReloadKey((k) => k + 1);

  async function submitRole(role: string, confirmSeeded: boolean) {
    if (role === "USER") {
      setRoleChange(null);
      setExclude("role_change");
      return;
    }
    setRoleChange((r) => (r ? { ...r, busy: true, error: null } : r));
    let body;
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, ...(confirmSeeded ? { confirmSeeded: true } : {}) }),
      });
      body = await res.json();
    } catch {
      setRoleChange((r) => (r ? { ...r, busy: false, error: "Ошибка сети" } : r));
      return;
    }
    if (body.success) {
      setRoleChange(null);
      refresh();
      return;
    }
    if (body.error?.code === "SEEDED_SUPERADMIN_CONFIRM_REQUIRED") {
      setRoleChange({ role, seeded: true, busy: false, error: null });
      return;
    }
    setRoleChange((r) => (r ? { ...r, busy: false, error: body.error?.message ?? "Не удалось сменить роль" } : r));
  }

  async function submitDelete() {
    setDeleteConfirm({ busy: true, error: null });
    let body;
    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      body = await res.json();
    } catch {
      setDeleteConfirm({ busy: false, error: "Ошибка сети" });
      return;
    }
    if (body.success) {
      setDeleteConfirm(null);
      router.replace("/admin/users?tab=team");
      return;
    }
    if (body.error?.code === "USER_HAS_HISTORY") {
      setDeleteConfirm(null);
      const meta = body.error.metadata as { blockers?: DeletionBlocker[]; isTeamMember?: boolean } | undefined;
      setDeleteBlocked({ blockers: meta?.blockers ?? [], isTeamMember: meta?.isTeamMember ?? false });
      return;
    }
    setDeleteConfirm({ busy: false, error: body.error?.message ?? "Ошибка удаления" });
  }

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        {error}{" "}
        <Link href="/admin/users?tab=team" className="text-blue-600 hover:underline">
          К команде
        </Link>
      </div>
    );
  }
  if (!data) return <div className="text-sm text-zinc-400">Загрузка...</div>;

  const { user, contacts, access, actions, possibleDuplicates } = data;
  const hint = botStatusHint(contacts.botStatus);

  return (
    <div className="space-y-6">
      {searchParams.get("mergedFrom") === "1" && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Этот аккаунт объединён с другим — показан основной.
        </div>
      )}
      {!user.isTeamMember && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          Не входит в команду.{" "}
          <Link href={`/admin/clients/${user.id}`} className="text-blue-600 hover:underline">
            Карточка клиента
          </Link>
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-6">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">{user.name || contacts.email || "Без имени"}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {ROLE_LABEL[user.role]} · зарегистрирован {formatDate(user.createdAt)} · источник: {user.sourceLabel} · последний
            вход: {formatDate(user.lastLoginAt, true)}
          </p>
          {user.isSeededSuperadmin && (
            <p className="mt-1 text-xs text-amber-700">Суперадмин назначен в настройках сервера</p>
          )}
        </div>
        <Link href="/admin/users?tab=team" className="text-sm text-blue-600 hover:underline">
          ← Команда
        </Link>
      </header>

      <Section title="Контакты и вход">
        <dl>
          <Row label="Email">
            {contacts.email ? (
              <>
                {contacts.email} {contacts.emailVerified ? <span className="text-emerald-600">✓ подтверждён</span> : <span className="text-zinc-400">не подтверждён</span>}
              </>
            ) : (
              <span className="text-zinc-400">Email не указан</span>
            )}
          </Row>
          <Row label="Телефон">{contacts.phone ?? <span className="text-zinc-400">Телефон не указан</span>}</Row>
          <Row label="Telegram">
            {contacts.telegramLinked ? <span className="text-emerald-600">✓ привязан</span> : <span className="text-zinc-400">Telegram не привязан</span>}
          </Row>
          <Row label="Delovoy Bot">
            <BotStatusBadge status={contacts.botStatus} />
            {hint && <span className="ml-2 text-xs text-zinc-500">{hint}</span>}
          </Row>
          <Row label="VK">{contacts.vkLinked ? <span className="text-emerald-600">✓ привязан</span> : <span className="text-zinc-400">VK не привязан</span>}</Row>
          <Row label="Способы входа">
            {contacts.authMethods.length ? contacts.authMethods.map((m) => AUTH_LABELS[m] ?? m).join(", ") : "—"}
          </Row>
        </dl>
      </Section>

      <Section
        title="Права"
        aside={
          user.isTeamMember && (
            <button type="button" className="text-sm text-blue-600 hover:underline" onClick={() => setShowPermissions(true)}>
              Изменить права
            </button>
          )
        }
      >
        <dl>
          <Row label="Роль">{ROLE_LABEL[user.role]}</Row>
          <Row label="Разделы">
            {access.sections.length === 0 ? (
              <span className="text-zinc-400">Нет разделов</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {access.sections.map((s) => (
                  <span key={s.slug} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                    {s.label}
                    {s.source === "role" ? " · по роли" : s.source === "strict_grant" ? " · особый доступ" : " · выдан отдельно"}
                  </span>
                ))}
              </span>
            )}
          </Row>
          <Row label="Особый доступ">
            {access.strictSections.map((s) => `${s.label}: ${s.granted ? "есть" : "нужен явный доступ"}`).join(", ")}
          </Row>
          <Row label="Модули">{access.modules.length ? access.modules.map((m) => m.name).join(", ") : "—"}</Row>
          <Row label="Списки получателей">
            {access.recipientLists.length ? access.recipientLists.map((l) => l.label).join(", ") : "—"}
          </Row>
        </dl>
      </Section>

      <NotificationsBlock key={`n-${reloadKey}`} userId={user.id} />
      <UserStatsBlock userId={user.id} />

      {possibleDuplicates.length > 0 && (
        <Section title="Возможные дубли">
          <ul className="space-y-2 text-sm">
            {possibleDuplicates.map((d) => (
              <li key={d.userId} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <Link href={`/admin/users/${d.userId}`} className="text-blue-600 hover:underline">
                    {d.name ?? "Без имени"}
                  </Link>{" "}
                  <span className="text-zinc-500">
                    · {ROLE_LABEL[d.role]} · {d.reason === "phone" ? "совпадает телефон" : "запрос на объединение"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setMerge({ secondaryId: d.userId, mergeRequestId: d.mergeRequestId })}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Объединить
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Действия">
        <div className="flex flex-wrap gap-3">
          {actions.canExclude && (
            <button type="button" onClick={() => setExclude("exclude")} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
              Исключить из команды
            </button>
          )}
          {actions.canMerge && (
            <button type="button" onClick={() => setMerge({})} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50">
              Объединить аккаунты
            </button>
          )}
          {actions.canResetPassword && (
            <button type="button" onClick={() => setShowPassword(true)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50">
              Сбросить пароль
            </button>
          )}
          {actions.canChangeRole && (
            <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
              Сменить роль
              <select
                aria-label="Сменить роль"
                className="rounded-lg border border-zinc-300 px-2 py-1.5"
                value={user.role}
                onChange={(e) => {
                  const role = e.target.value;
                  if (role === user.role) return;
                  if (role === "USER") setExclude("role_change");
                  else setRoleChange({ role, seeded: false, error: null, busy: false });
                }}
              >
                {Object.entries(ROLE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Section>

      {actions.canDelete && (
        <Section title="Опасные действия">
          <button
            type="button"
            onClick={() => setDeleteConfirm({ busy: false, error: null })}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50"
          >
            Удалить
          </button>
        </Section>
      )}

      {showPermissions && (
        <PermissionsModal
          userId={user.id}
          userName={user.name}
          userRole={user.role}
          onClose={() => setShowPermissions(false)}
          onSaved={() => {
            setShowPermissions(false);
            refresh();
          }}
        />
      )}
      <MergeWizard
        open={merge !== null}
        initialUserId={user.id}
        initialSecondaryId={merge?.secondaryId}
        mergeRequestId={merge?.mergeRequestId}
        onClose={() => setMerge(null)}
        onMerged={({ primaryId }) => {
          setMerge(null);
          if (primaryId === user.id) refresh();
          else router.replace(`/admin/users/${primaryId}?mergedFrom=1`);
        }}
      />
      {showPassword && (
        <ResetPasswordModal userId={user.id} userName={user.name} userEmail={contacts.email} onClose={() => setShowPassword(false)} />
      )}
      {exclude && (
        <ExcludeDialog
          userId={user.id}
          userName={user.name}
          submitVia={exclude}
          onClose={() => setExclude(null)}
          onExcluded={() => {
            setExclude(null);
            refresh();
          }}
        />
      )}
      {roleChange && (
        <ConfirmDialog
          title="Сменить роль"
          tone="primary"
          message={
            roleChange.seeded
              ? "Этот аккаунт назначен суперадмином в настройках сервера. При ближайшем обновлении платформы роль вернётся автоматически. Всё равно сменить?"
              : `Сменить роль на «${ROLE_LABEL[roleChange.role]}»? При понижении текущие сессии сотрудника будут обновлены.`
          }
          confirmLabel={roleChange.seeded ? "Всё равно сменить" : "Сменить"}
          busy={roleChange.busy}
          error={roleChange.error}
          onConfirm={() => void submitRole(roleChange.role, roleChange.seeded)}
          onClose={() => setRoleChange(null)}
        />
      )}
      {deleteConfirm && (
        <ConfirmDialog
          title="Удалить аккаунт"
          message="Аккаунт без истории будет удалён безвозвратно. Если у него есть история, мы покажем, что мешает удалению."
          confirmLabel="Удалить"
          busy={deleteConfirm.busy}
          error={deleteConfirm.error}
          onConfirm={() => void submitDelete()}
          onClose={() => setDeleteConfirm(null)}
        />
      )}
      {deleteBlocked && (
        <DeleteBlockedDialog
          userName={user.name}
          blockers={deleteBlocked.blockers}
          isTeamMember={deleteBlocked.isTeamMember}
          onClose={() => setDeleteBlocked(null)}
          onExclude={() => {
            setDeleteBlocked(null);
            setExclude("exclude");
          }}
        />
      )}
    </div>
  );
}
