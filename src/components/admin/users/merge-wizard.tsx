"use client";

import { useEffect, useState, type ReactNode } from "react";
import type {
  AccountMergePreview,
  AccountSide,
  MergeConflict,
  MergeRequestItem,
  MergeSearchHit,
} from "@/modules/clients/types";
import { DialogShell, dangerButtonClass, primaryButtonClass, secondaryButtonClass } from "./dialog-shell";

/**
 * Мастер «Объединить аккаунты» (PRD 2026-10-25 US-E2, ADR §7 «Диалоги»).
 *
 * Шаги: поиск второго аккаунта / «Возможные дубли» → «Кого оставить»
 * (по умолчанию `suggestedPrimaryId`) → превью (ничего не меняет) → чекбокс
 * «Я понимаю, что действие нельзя отменить в интерфейсе» → отдельный чекбокс
 * конфликта Telegram → `POST /api/users/merge`.
 *
 * Not wired into a page here — the staff page / team tab mounts it.
 */

export const MERGE_TEXTS = {
  title: "Объединить аккаунты",
  irreversible: "Я понимаю, что действие нельзя отменить в интерфейсе",
  telegramConfirm: "Оставить Telegram основного аккаунта — Telegram второго аккаунта будет отвязан",
  chooseHint: "По умолчанию основной — аккаунт с более высокой ролью, при равенстве — тот, у кого есть email.",
  rolesHint: "Роль и права итогового аккаунта — как у основного. Права второго аккаунта не переносятся.",
  submit: "Объединить",
} as const;

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: "Суперадмин",
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
  USER: "Пользователь",
};

const CONFLICT_LABEL: Record<MergeConflict["field"], string> = {
  email: "Email",
  phone: "Телефон",
  telegram: "Telegram",
  vk: "VK",
  name: "Имя",
};

type Envelope<T> =
  | { success: true; data: T; meta?: { total?: number } }
  | { success: false; error?: { code?: string; message?: string } };

type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

async function callApi<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init);
    const body = (await res.json()) as Envelope<T>;
    if (body.success) return { ok: true, data: body.data };
    return { ok: false, code: body.error?.code ?? "ERROR", message: body.error?.message || "Не удалось выполнить запрос" };
  } catch {
    return { ok: false, code: "NETWORK", message: "Ошибка сети" };
  }
}

function postJson(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

type Duplicate = { userId: string; name: string | null; role: string; reason: string };

type OverviewDuplicates = {
  kind?: string;
  possibleDuplicates?: Array<{ userId: string; name: string | null; role: string; reason: "phone" | "merge_request" }>;
};

export type MergeWizardProps = {
  open: boolean;
  initialUserId?: string;
  initialSecondaryId?: string;
  mergeRequestId?: string;
  onClose: () => void;
  onMerged: (result: { primaryId: string }) => void;
};

export function MergeWizard(props: MergeWizardProps) {
  if (!props.open) return null;
  return <MergeWizardBody {...props} />;
}

type Step = "pick" | "choose" | "preview";

function MergeWizardBody({ initialUserId, initialSecondaryId, mergeRequestId, onClose, onMerged }: MergeWizardProps) {
  const [firstId, setFirstId] = useState<string | null>(initialUserId ?? null);
  const [secondId, setSecondId] = useState<string | null>(initialSecondaryId ?? null);
  const [step, setStep] = useState<Step>(initialUserId && initialSecondaryId ? "choose" : "pick");
  const [pairState, setPairState] = useState<{ key: string; preview?: AccountMergePreview; error?: string } | null>(null);
  const [primaryChoice, setPrimaryChoice] = useState<string | null>(null);
  const [preview, setPreview] = useState<AccountMergePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmIrreversible, setConfirmIrreversible] = useState(false);
  const [confirmTelegram, setConfirmTelegram] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // «Кого оставить»: load both sides once per pair; default = suggestedPrimaryId.
  const pairKey = firstId && secondId ? `${firstId}|${secondId}` : null;
  const pairLoaded = pairState !== null && pairState.key === pairKey;
  const pairPreview = pairLoaded ? pairState.preview ?? null : null;
  const pairLoading = step === "choose" && pairKey !== null && !pairLoaded;

  useEffect(() => {
    if (step !== "choose" || !firstId || !secondId || !pairKey || pairLoaded) return;
    let cancelled = false;
    void callApi<AccountMergePreview>("/api/users/merge/preview", postJson({ primaryId: firstId, secondaryId: secondId })).then(
      (res) => {
        if (cancelled) return;
        if (res.ok) {
          setPairState({ key: pairKey, preview: res.data });
          setPrimaryChoice(res.data.suggestedPrimaryId);
        } else {
          setPairState({ key: pairKey, error: res.message });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [step, firstId, secondId, pairKey, pairLoaded]);

  async function showPreview() {
    if (!pairPreview || !primaryChoice) return;
    const secondaryChoice = primaryChoice === pairPreview.primary.id ? pairPreview.secondary.id : pairPreview.primary.id;
    setError(null);
    setConfirmIrreversible(false);
    setConfirmTelegram(false);
    if (primaryChoice === pairPreview.primary.id) {
      setPreview(pairPreview);
      setStep("preview");
      return;
    }
    setLoading(true);
    const res = await callApi<AccountMergePreview>(
      "/api/users/merge/preview",
      postJson({ primaryId: primaryChoice, secondaryId: secondaryChoice }),
    );
    setLoading(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPreview(res.data);
    setStep("preview");
  }

  const telegramConflict = Boolean(preview?.conflicts.some((c) => c.field === "telegram" && c.requiresConfirmation));
  const blocked = (preview?.blockers.length ?? 0) > 0;
  const canSubmit =
    Boolean(preview) && !blocked && confirmIrreversible && (!telegramConflict || confirmTelegram) && !submitting;

  async function submit() {
    if (!preview || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    const res = await callApi<{ primaryId: string }>(
      "/api/users/merge",
      postJson({
        primaryId: preview.primary.id,
        secondaryId: preview.secondary.id,
        confirmIrreversible: true,
        ...(telegramConflict ? { confirmTelegramConflict: true } : {}),
      }),
    );
    setSubmitting(false);
    if (res.ok) {
      onMerged({ primaryId: res.data.primaryId });
      return;
    }
    setError(res.message);
  }

  function pick(id: string) {
    setError(null);
    if (!firstId) {
      setFirstId(id);
      return;
    }
    setSecondId(id);
    setStep("choose");
  }

  function back() {
    setError(null);
    if (step === "preview") {
      setStep("choose");
      return;
    }
    if (step === "choose" && !(initialUserId && initialSecondaryId)) {
      setSecondId(null);
      setStep("pick");
    }
  }

  const shownError = error ?? (step === "choose" && pairLoaded ? pairState.error ?? null : null);
  const canGoBack = step === "preview" || (step === "choose" && !(initialUserId && initialSecondaryId));

  let footer: ReactNode;
  if (step === "choose") {
    footer = (
      <>
        <FooterBack canGoBack={canGoBack} onBack={back} onClose={onClose} />
        <button
          type="button"
          onClick={showPreview}
          disabled={!pairPreview || !primaryChoice || loading || pairLoading}
          className={primaryButtonClass}
        >
          {loading || pairLoading ? "Загрузка..." : "Показать превью"}
        </button>
      </>
    );
  } else if (step === "preview") {
    footer = (
      <>
        <FooterBack canGoBack={canGoBack} onBack={back} onClose={onClose} />
        <button type="button" onClick={submit} disabled={!canSubmit} className={dangerButtonClass}>
          {submitting ? "Объединяем..." : MERGE_TEXTS.submit}
        </button>
      </>
    );
  } else {
    footer = (
      <button type="button" onClick={onClose} className={secondaryButtonClass}>
        Отмена
      </button>
    );
  }

  return (
    <DialogShell
      title={MERGE_TEXTS.title}
      subtitle={mergeRequestId ? "Запрос на объединение" : stepSubtitle(step)}
      onClose={onClose}
      footer={footer}
    >
      <div className="space-y-4 text-sm text-zinc-700">
        {step === "pick" && <PickStep firstId={firstId} onPick={pick} onResetFirst={() => setFirstId(null)} />}

        {step === "choose" &&
          (pairLoading ? (
            <Skeleton />
          ) : pairPreview ? (
            <ChooseStep preview={pairPreview} primaryChoice={primaryChoice} onChoose={setPrimaryChoice} />
          ) : null)}

        {step === "preview" && preview && (
          <PreviewStep
            preview={preview}
            telegramConflict={telegramConflict}
            confirmIrreversible={confirmIrreversible}
            confirmTelegram={confirmTelegram}
            onConfirmIrreversible={setConfirmIrreversible}
            onConfirmTelegram={setConfirmTelegram}
          />
        )}

        {shownError && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
            {shownError}
          </div>
        )}
      </div>
    </DialogShell>
  );
}

function stepSubtitle(step: Step): string {
  if (step === "pick") return "Шаг 1 из 3 — выберите аккаунты";
  if (step === "choose") return "Шаг 2 из 3 — кого оставить";
  return "Шаг 3 из 3 — проверьте и подтвердите";
}

function FooterBack({ canGoBack, onBack, onClose }: { canGoBack: boolean; onBack: () => void; onClose: () => void }) {
  return canGoBack ? (
    <button type="button" onClick={onBack} className={secondaryButtonClass}>
      Назад
    </button>
  ) : (
    <button type="button" onClick={onClose} className={secondaryButtonClass}>
      Отмена
    </button>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-8 animate-pulse rounded-lg bg-zinc-100" />
      ))}
    </div>
  );
}

// ─── Step 1: search + possible duplicates ──────────────────────────────────

function PickStep({
  firstId,
  onPick,
  onResetFirst,
}: {
  firstId: string | null;
  onPick: (id: string) => void;
  onResetFirst: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ query: string; items: MergeSearchHit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<{ owner: string; items: Duplicate[] } | null>(null);

  const trimmed = query.trim();
  const visibleHits = trimmed.length >= 2 && hits?.query === trimmed ? hits.items : [];
  const visibleDuplicates = firstId && duplicates?.owner === firstId ? duplicates.items : [];

  useEffect(() => {
    if (trimmed.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      const params = new URLSearchParams({ q: trimmed });
      if (firstId) params.set("exclude", firstId);
      void callApi<MergeSearchHit[]>(`/api/users/merge/search?${params.toString()}`).then((res) => {
        if (cancelled) return;
        setSearching(false);
        if (res.ok) {
          setHits({ query: trimmed, items: res.data });
          setSearchError(null);
        } else {
          setSearchError(res.message);
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, firstId]);

  // «Возможные дубли» (AC-E2.1): merge requests of this account + phone
  // matches from the account overview when it is available.
  useEffect(() => {
    if (!firstId) return;
    let cancelled = false;
    void Promise.all([
      callApi<MergeRequestItem[]>(`/api/users/merge-requests?userId=${encodeURIComponent(firstId)}`),
      callApi<OverviewDuplicates>(`/api/users/${encodeURIComponent(firstId)}/overview`),
    ]).then(([requests, overview]) => {
      if (cancelled) return;
      const found = new Map<string, Duplicate>();
      if (requests.ok) {
        for (const item of requests.data) {
          const other = item.users.find((u) => u.id !== firstId);
          if (other) found.set(other.id, { userId: other.id, name: other.name, role: other.role, reason: item.reasonLabel });
        }
      }
      if (overview.ok && overview.data.kind === "user") {
        for (const d of overview.data.possibleDuplicates ?? []) {
          if (!found.has(d.userId)) {
            found.set(d.userId, {
              userId: d.userId,
              name: d.name,
              role: d.role,
              reason: d.reason === "phone" ? "Совпадает телефон" : "Запрос на объединение",
            });
          }
        }
      }
      setDuplicates({ owner: firstId, items: [...found.values()] });
    });
    return () => {
      cancelled = true;
    };
  }, [firstId]);

  return (
    <div className="space-y-4">
      {firstId ? (
        <p className="text-zinc-600">
          Найдите второй аккаунт этого человека по имени, email, телефону или Telegram ID.
          {" "}
          <button type="button" onClick={onResetFirst} className="text-blue-600 hover:underline">
            Выбрать другой первый аккаунт
          </button>
        </p>
      ) : (
        <p className="text-zinc-600">Найдите первый аккаунт по имени, email, телефону или Telegram ID.</p>
      )}

      {visibleDuplicates.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Возможные дубли</p>
          <ul className="space-y-1.5" data-testid="merge-duplicates">
            {visibleDuplicates.map((d) => (
              <li key={d.userId}>
                <button
                  type="button"
                  onClick={() => onPick(d.userId)}
                  className="flex w-full items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left hover:bg-amber-100"
                >
                  <span className="font-medium text-zinc-900">{d.name || "Без имени"}</span>
                  <span className="text-xs text-zinc-600">
                    {ROLE_LABEL[d.role] ?? d.role} · {d.reason}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Имя, email, телефон или Telegram ID"
        aria-label="Поиск аккаунта"
        autoFocus
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      {searching && <p className="text-xs text-zinc-500">Ищем...</p>}
      {searchError && <p className="text-xs text-red-600">{searchError}</p>}
      {visibleHits.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200" data-testid="merge-search-results">
          {visibleHits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => onPick(h.id)}
                className="flex w-full flex-col px-3 py-2 text-left hover:bg-zinc-50"
              >
                <span className="font-medium text-zinc-900">
                  {h.name || "Без имени"}{" "}
                  <span className="text-xs font-normal text-zinc-500">{ROLE_LABEL[h.role] ?? h.role}</span>
                </span>
                <span className="text-xs text-zinc-500">
                  {[h.email, h.phone, h.hasTelegram ? "Telegram привязан" : null].filter(Boolean).join(" · ") ||
                    "Нет контактов"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {trimmed.length >= 2 && hits?.query === trimmed && !searching && visibleHits.length === 0 && !searchError && (
        <p className="text-xs text-zinc-500">Ничего не найдено</p>
      )}
    </div>
  );
}

// ─── Step 2: «Кого оставить» ────────────────────────────────────────────────

function ChooseStep({
  preview,
  primaryChoice,
  onChoose,
}: {
  preview: AccountMergePreview;
  primaryChoice: string | null;
  onChoose: (id: string) => void;
}) {
  const sides = [preview.primary, preview.secondary];
  return (
    <div className="space-y-3">
      <p>Кого оставить основным аккаунтом?</p>
      <p className="text-xs text-zinc-500">{MERGE_TEXTS.chooseHint}</p>
      <div className="space-y-2" role="radiogroup" aria-label="Основной аккаунт">
        {sides.map((side) => (
          <label
            key={side.id}
            className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
              primaryChoice === side.id ? "border-blue-500 bg-blue-50" : "border-zinc-200"
            }`}
          >
            <input
              type="radio"
              name="merge-primary"
              checked={primaryChoice === side.id}
              onChange={() => onChoose(side.id)}
              className="mt-1"
            />
            <SideCard side={side} suggested={side.id === preview.suggestedPrimaryId} />
          </label>
        ))}
      </div>
      <p className="text-xs text-zinc-500">{MERGE_TEXTS.rolesHint}</p>
    </div>
  );
}

function SideCard({ side, suggested }: { side: AccountSide; suggested: boolean }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-medium text-zinc-900">
        {side.name || "Без имени"} <span className="text-xs font-normal text-zinc-500">{ROLE_LABEL[side.role]}</span>
        {suggested && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">рекомендуем</span>}
      </span>
      <span className="text-xs text-zinc-600">
        {[side.email, side.phone, side.hasTelegram ? "Telegram привязан" : "Без Telegram", side.hasVk ? "VK" : null]
          .filter(Boolean)
          .join(" · ")}
      </span>
      <span className="text-xs text-zinc-400">
        Создан {new Date(side.createdAt).toLocaleDateString("ru-RU")}
        {side.isSeededSuperadmin ? " · привязан к настройке сервера" : ""}
      </span>
    </span>
  );
}

// ─── Step 3: preview + confirmations ───────────────────────────────────────

function PreviewStep({
  preview,
  telegramConflict,
  confirmIrreversible,
  confirmTelegram,
  onConfirmIrreversible,
  onConfirmTelegram,
}: {
  preview: AccountMergePreview;
  telegramConflict: boolean;
  confirmIrreversible: boolean;
  confirmTelegram: boolean;
  onConfirmIrreversible: (v: boolean) => void;
  onConfirmTelegram: (v: boolean) => void;
}) {
  const conflictFields = new Set(preview.conflicts.map((c) => c.field));
  const t = preview.transfer;
  return (
    <div className="space-y-4" data-testid="merge-preview">
      <p>
        Основной: <b>{preview.primary.name || "Без имени"}</b>. Второй аккаунт{" "}
        <b>{preview.secondary.name || "Без имени"}</b> будет скрыт и не сможет войти.
      </p>

      {preview.blockers.length > 0 && (
        <div role="alert" className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
          {preview.blockers.map((b) => (
            <p key={b.code}>{b.message}</p>
          ))}
        </div>
      )}

      <Section title="Итоговый аккаунт">
        <Row label="Роль" value={ROLE_LABEL[preview.result.role]} />
        <Row label="Имя" value={preview.result.name} highlight={conflictFields.has("name")} />
        <Row label="Email" value={preview.result.email} highlight={conflictFields.has("email")} />
        <Row label="Телефон" value={preview.result.phone} highlight={conflictFields.has("phone")} />
        <Row
          label="Telegram"
          value={preview.result.telegramLinked ? "привязан" : "не привязан"}
          highlight={conflictFields.has("telegram")}
        />
        <Row label="VK" value={preview.result.vkLinked ? "привязан" : "не привязан"} highlight={conflictFields.has("vk")} />
      </Section>

      {preview.conflicts.length > 0 && (
        <Section title="Конфликты">
          <ul className="space-y-1.5" data-testid="merge-conflicts">
            {preview.conflicts.map((c) => (
              <li key={c.field} className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900">
                <b>{CONFLICT_LABEL[c.field]}:</b> останется значение основного
                {c.field === "telegram" || c.field === "vk" ? "" : ` (${c.primaryValue ?? "—"})`}; значение второго
                {c.field === "telegram" || c.field === "vk" ? "" : ` (${c.secondaryValue ?? "—"})`} попадёт в журнал.
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Доступ (как у основного)">
        <List label="Разделы" items={preview.access.sections} />
        <List label="Модули" items={preview.access.modules} />
        <List label="Списки получателей" items={preview.access.recipientLists} />
      </Section>

      <Section title="Подписки и каналы доставки">
        <List label="Остаются" items={preview.subscriptions.kept} />
        <List label="Переносятся" items={preview.subscriptions.moved} />
        <List label="Конфликт — останутся настройки основного" items={preview.subscriptions.droppedConflicts} />
        <List label="Каналы основного" items={preview.channels.kept} />
        <List label="Каналы второго (переносятся)" items={preview.channels.moved} />
      </Section>

      <Section title="Будет перенесено на основной">
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1" data-testid="merge-transfer">
          <li>Брони — {t.bookings}</li>
          <li>Заказы — {t.orders}</li>
          <li>Абонементы — {t.subscriptions}</li>
          <li>Задачи — {t.tasks}</li>
          <li>Сообщения — {t.chatMessages}</li>
          <li>Записи журнала — {t.auditLogs}</li>
          <li>Уведомления — {t.notifications}</li>
        </ul>
      </Section>

      {preview.notTransferred.length > 0 && (
        <Section title="Не будут перенесены">
          <ul className="space-y-1" data-testid="merge-not-transferred">
            {preview.notTransferred.map((n) => (
              <li key={n.key}>
                <span className="font-medium">{n.label}:</span> {n.items.join(", ")}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {preview.blockers.length === 0 && (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <label className="flex cursor-pointer items-start gap-2 font-medium text-zinc-900">
            <input
              type="checkbox"
              checked={confirmIrreversible}
              onChange={(e) => onConfirmIrreversible(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            {MERGE_TEXTS.irreversible}
          </label>
          {telegramConflict && (
            <label className="flex cursor-pointer items-start gap-2 font-medium text-amber-900">
              <input
                type="checkbox"
                checked={confirmTelegram}
                onChange={(e) => onConfirmTelegram(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              {MERGE_TEXTS.telegramConfirm}
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</p>
      {children}
    </div>
  );
}

function Row({ label, value, highlight = false }: { label: string; value: string | null | undefined; highlight?: boolean }) {
  return (
    <p className={highlight ? "rounded bg-amber-50 px-1 text-amber-900" : undefined}>
      <span className="text-zinc-500">{label}:</span> {value || "—"}
    </p>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <p>
      <span className="text-zinc-500">{label}:</span> {items.length > 0 ? items.join(", ") : "—"}
    </p>
  );
}
