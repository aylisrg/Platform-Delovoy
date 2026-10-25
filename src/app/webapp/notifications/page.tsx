"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  useTelegram,
  ApiFetchError,
} from "@/components/webapp/TelegramProvider";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  ListItem,
  SectionHeader,
  Skeleton,
  Toggle,
} from "@/components/webapp/ui";
import type { WebAppIconName } from "@/lib/webapp/icon-names";

/**
 * Центр уведомлений сотрудника (ADR `2026-08-13-miniapp-role-rebuild` §3.3).
 *
 * Типы описаны локально: серверный `webapp-center.ts` тянет prisma и в
 * клиентский бандл попадать не должен. Источник правды — контракт GET-ответа.
 */

interface CenterChannel {
  kind: "TELEGRAM";
  status: "active" | "inactive";
  provisionedNow: boolean;
}

interface CenterEvent {
  eventType: string;
  label: string;
  description: string;
  /** Effective: you actually get it (any path, no opt-out). */
  enabled: boolean;
  source: "explicit" | "default";
  /** Why it comes to you («Вы в списке получателей раздела …»). */
  caption: string | null;
  blockers: Array<{ code: string; label: string }>;
}

interface CenterCategory {
  key: string;
  label: string;
  description: string;
  icon: WebAppIconName;
  delivery: "personal" | "group" | "in-app";
  events: CenterEvent[];
}

interface CenterProtectedNotice {
  label: string;
  note: string;
}

interface CenterHint {
  code: "START_BOT" | "UNBLOCK_BOT";
  text: string;
  botUrl?: string;
}

interface CenterData {
  role: string;
  channel: CenterChannel;
  transparencyNote: string;
  emptyState: string | null;
  hint: CenterHint | null;
  categories: CenterCategory[];
  protected: CenterProtectedNotice[];
}

type LoadState = "loading" | "ready" | "forbidden" | "error";

export default function NotificationCenterPage() {
  const { ready, apiFetch, haptic, showBackButton, onBackButtonClick } =
    useTelegram();

  const [data, setData] = useState<CenterData | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [savingEvent, setSavingEvent] = useState<string | null>(null);

  useEffect(() => {
    showBackButton(true);
    onBackButtonClick(() => window.history.back());
    return () => showBackButton(false);
  }, [showBackButton, onBackButtonClick]);

  const load = useCallback(() => {
    setState("loading");
    apiFetch<CenterData>("/api/webapp/notification-center")
      .then((result) => {
        setData(result);
        setState("ready");
      })
      .catch((err: unknown) => {
        // Права перечитываются сервером на каждый запрос: понижение роли
        // приходит сюда как 403 (AC-1.5/AC-5.8).
        setState(
          err instanceof ApiFetchError && err.status === 403
            ? "forbidden"
            : "error"
        );
      });
  }, [apiFetch]);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  async function handleToggle(eventType: string, next: boolean) {
    if (!data || savingEvent) return;

    const snapshot = data;
    haptic.selection();
    setSavingEvent(eventType);
    setData(applyToggle(data, eventType, next));

    try {
      await apiFetch("/api/webapp/notification-center", {
        method: "PUT",
        body: JSON.stringify({ eventType, enabled: next }),
      });
      haptic.notification("success");
      // Re-read the server's truth: captions and blockers depend on every
      // delivery path, not just this toggle (ADR 2026-10-25 §Q7).
      apiFetch<CenterData>("/api/webapp/notification-center")
        .then(setData)
        .catch(() => {});
    } catch (err: unknown) {
      // Откат оптимистичного переключения — экран не врёт о состоянии.
      setData(snapshot);
      haptic.notification("error");
      if (err instanceof ApiFetchError && err.status === 403) {
        setState("forbidden");
      }
    } finally {
      setSavingEvent(null);
    }
  }

  if (!ready || state === "loading") {
    return (
      <div className="px-4 pt-4 space-y-4">
        <Skeleton className="h-7 w-52 rounded-lg" />
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }

  if (state === "forbidden") {
    return (
      <EmptyState
        icon="shield"
        title="Доступ отозван"
        hint="Центр уведомлений доступен сотрудникам парка. Если считаете это ошибкой — обратитесь к администратору."
      />
    );
  }

  if (state === "error" || !data) {
    return (
      <EmptyState
        icon="alert"
        title="Не удалось загрузить настройки"
        hint="Проверьте соединение и попробуйте ещё раз."
        action={<Button onClick={load}>Повторить</Button>}
      />
    );
  }

  return (
    <div className="tg-page-enter pb-8">
      <div className="px-4 pt-4">
        <h1 className="text-[20px] font-bold">Центр уведомлений</h1>
        <p className="text-[14px] mt-1" style={{ color: "var(--tg-hint)" }}>
          Выберите, какие события приходят лично вам
        </p>
      </div>

      <div className="px-4 mt-5">
        <Card>
          <InfoRow
            icon="bell"
            iconTone={data.channel.status === "active" ? "accent" : "hint"}
            title="Telegram"
            subtitle={channelSubtitle(data.channel)}
            right={
              data.channel.status === "active" ? (
                <Badge tone="success">Активен</Badge>
              ) : (
                <Badge tone="warning">Выключен</Badge>
              )
            }
          />
        </Card>
      </div>

      {data.categories.some((category) => category.delivery === "in-app") && (
        <div className="px-4 mt-3">
          <Card>
            <InfoRow
              icon="news"
              title="Сообщения внутри приложения"
              subtitle="Сводки появляются в ленте на главной. Активный Telegram-канал для них не нужен."
            />
          </Card>
        </div>
      )}

      {data.hint && (
        <div className="px-4 mt-3">
          <Card>
            <InfoRow
              icon="alert"
              iconTone="hint"
              title={data.hint.code === "START_BOT" ? "Бот не запущен" : "Бот заблокирован"}
              subtitle={data.hint.text}
              right={
                data.hint.botUrl ? (
                  <Button variant="secondary" className="!w-auto px-3 py-1.5 text-[14px]" onClick={() => openTelegram(data.hint?.botUrl ?? "")}>
                    Открыть бота
                  </Button>
                ) : undefined
              }
            />
          </Card>
        </div>
      )}

      {data.categories.length === 0 && (
        <EmptyState
          icon="bell"
          title="Пока нечего настраивать"
          hint={data.emptyState ?? "У вас пока нет разделов. Обратитесь к суперадмину"}
        />
      )}

      {data.categories.map((category) => (
        <section key={category.key} className="mt-5">
          <SectionHeader>
            <span className="inline-flex items-center gap-1.5 align-middle">
              <Icon name={category.icon} size={14} />
              {category.label}
            </span>
          </SectionHeader>

          <p
            className="px-4 pb-2 text-[13px] leading-snug"
            style={{ color: "var(--tg-hint)" }}
          >
            {category.description} · {deliveryHint(category)}
          </p>

          {category.delivery === "in-app" && category.events.some((event) => event.eventType === "telephony.daily_summary") && (
            <p className="px-4 pb-3 text-[13px] leading-relaxed" style={{ color: "var(--tg-text)" }}>
              Каждый день в 09:00 МСК — итоги предыдущего дня. Только в ленте приложения, без сообщений от бота.
            </p>
          )}

          <div className="px-4">
            <Card>
              {category.events.map((event) => (
                <EventRow
                  key={event.eventType}
                  event={event}
                  saving={savingEvent === event.eventType}
                  disabled={savingEvent !== null}
                  onChange={(next) => handleToggle(event.eventType, next)}
                />
              ))}

              {/* Неотключаемое — только в «Системных»: тумблера за
                  инфраструктурными CRITICAL-алертами не существует (AC-5.7) */}
              {category.key === "system" &&
                data.protected.map((notice) => (
                  <ListItem
                    key={notice.label}
                    icon="shield"
                    iconTone="hint"
                    title={notice.label}
                    subtitle={notice.note}
                    disabled
                  />
                ))}
            </Card>
          </div>
        </section>
      ))}

      <p className="px-4 mt-6 text-[12px] leading-snug" style={{ color: "var(--tg-hint)" }}>
        {data.transparencyNote}
      </p>
    </div>
  );
}

function openTelegram(url: string): void {
  if (!url) return;
  const webapp = typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
  if (webapp && typeof webapp.openTelegramLink === "function") {
    webapp.openTelegramLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Некликабельная строка списка.
 *
 * Общий `ListItem` рендерит `<button>` (а с `disabled` ещё и гасит строку до
 * 50% — для информационной карточки канала это выглядит как ошибка). Здесь
 * нужен тот же вид без интерактивности, поэтому строка собрана на том же
 * классе `.tg-list-item`: разделители и отступы наследуются один в один.
 */
function InfoRow({
  icon,
  iconTone = "accent",
  title,
  subtitle,
  right,
  dimmed,
}: {
  icon: WebAppIconName;
  iconTone?: "accent" | "hint";
  title: string;
  subtitle: string;
  right?: ReactNode;
  dimmed?: boolean;
}) {
  return (
    <div className="tg-list-item" style={{ opacity: dimmed ? 0.6 : 1 }}>
      <span
        className="flex items-center justify-center w-7 h-7 shrink-0"
        style={{
          color: iconTone === "accent" ? "var(--tg-accent)" : "var(--tg-hint)",
        }}
      >
        <Icon name={icon} size={22} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[16px] leading-tight">{title}</span>
        <span
          className="block text-[13px] mt-0.5 leading-snug"
          style={{ color: "var(--tg-subtitle)" }}
        >
          {subtitle}
        </span>
      </span>
      {right}
    </div>
  );
}

/**
 * Строка события с тумблером.
 *
 * `Toggle` — тоже `<button>`, а вложенные интерактивные элементы невалидны и
 * ломают гидрацию (парсер закрывает внешнюю кнопку `ListItem`), поэтому здесь
 * та же разметка `.tg-list-item` без внешней кнопки.
 */
function EventRow({
  event,
  saving,
  disabled,
  onChange,
}: {
  event: CenterEvent;
  saving: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="tg-list-item" style={{ opacity: saving ? 0.6 : 1 }}>
      <span className="flex-1 min-w-0">
        <span className="block text-[16px] leading-tight">{event.label}</span>
        <span
          className="block text-[13px] mt-0.5 leading-snug"
          style={{ color: "var(--tg-subtitle)" }}
        >
          {event.description}
        </span>
        {event.caption && (
          <span className="block text-[12px] mt-1 leading-snug" style={{ color: "var(--tg-accent)" }}>
            {event.caption}
          </span>
        )}
        {(event.blockers ?? []).map((blocker) => (
          <span
            key={blocker.code}
            className="block text-[12px] mt-1 leading-snug"
            style={{ color: "var(--tg-destructive, #d93025)" }}
          >
            {blocker.code === "OPTED_OUT" ? blocker.label : `Не дойдёт: ${blocker.label}`}
          </span>
        ))}
      </span>
      <Toggle
        checked={event.enabled}
        disabled={disabled}
        label={event.label}
        onChange={onChange}
      />
    </div>
  );
}

function channelSubtitle(channel: CenterChannel): string {
  if (channel.status === "inactive") {
    return "Канал выключен — включите его в настройках уведомлений";
  }
  return channel.provisionedNow
    ? "Канал подключён — уведомления придут в этот чат"
    : "Уведомления приходят в этот чат";
}

function deliveryHint(category: CenterCategory): string {
  if (category.delivery === "in-app") return "в ленте приложения";
  if (category.delivery === "personal") return "приходят вам лично";
  // У «Системных» группового канала нет вовсе — обещать общий чат нельзя.
  return category.key === "system"
    ? "вы пока не подписаны"
    : "сейчас уходят в общий чат раздела";
}

/** Оптимистичное состояние: подписка сразу переводит категорию в «лично». */
function applyToggle(
  data: CenterData,
  eventType: string,
  enabled: boolean
): CenterData {
  return {
    ...data,
    categories: data.categories.map((category) => {
      if (!category.events.some((e) => e.eventType === eventType)) {
        return category;
      }
      return {
        ...category,
        delivery: category.delivery === "in-app" ? "in-app" : enabled ? "personal" : category.delivery,
        events: category.events.map((event) =>
          event.eventType === eventType
            ? { ...event, enabled, source: "explicit" }
            : event
        ),
      };
    }),
  };
}
