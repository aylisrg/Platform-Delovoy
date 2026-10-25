import type { BotStatusDto } from "@/modules/telegram-link/bot-contact";

/**
 * «Бот запущен ✓ <дата>» / «Бот не запущен» / «Бот заблокирован» /
 * «Telegram не привязан» — one rendering for every screen (AC-E1.1).
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
}

export function botStatusLabel(status: BotStatusDto): string {
  switch (status.state) {
    case "NOT_LINKED":
      return "Telegram не привязан";
    case "NOT_STARTED":
      return "Бот не запущен";
    case "STARTED":
      return status.startedAt ? `Бот запущен ✓ ${formatDate(status.startedAt)}` : "Бот запущен ✓ (дата неизвестна)";
    case "BLOCKED":
      return "Бот заблокирован";
  }
}

export function botStatusHint(status: BotStatusDto): string | null {
  if (status.state === "NOT_STARTED") {
    return status.trackingSince
      ? `Обращений к боту не зафиксировано с ${formatDate(status.trackingSince)}`
      : "Обращений к боту не зафиксировано";
  }
  if (status.state === "BLOCKED") return `Заблокирован ${formatDate(status.blockedAt)}`;
  return null;
}

const TONE: Record<BotStatusDto["state"], string> = {
  NOT_LINKED: "bg-zinc-100 text-zinc-500",
  NOT_STARTED: "bg-amber-50 text-amber-700",
  STARTED: "bg-emerald-50 text-emerald-700",
  BLOCKED: "bg-red-50 text-red-700",
};

export function BotStatusBadge({ status }: { status: BotStatusDto }) {
  const hint = botStatusHint(status);
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[status.state]}`}
      title={hint ?? undefined}
    >
      {botStatusLabel(status)}
    </span>
  );
}
