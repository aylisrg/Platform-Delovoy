import { sendTelegramAlert } from "@/lib/telegram-alert";
import type { BackupStatus, BackupType } from "@prisma/client";

/**
 * Send a Telegram notification about a backup event. Failures are always
 * notified; successes only when `notifyOnSuccess` is true.
 */
export async function notifyBackup(args: {
  type: BackupType;
  status: BackupStatus;
  sizeBytes?: number | null;
  storagePath?: string | null;
  error?: string | null;
  durationMs?: number | null;
  notifyOnSuccess?: boolean;
}): Promise<void> {
  const { type, status, sizeBytes, storagePath, error, durationMs } = args;

  if (status === "SUCCESS" && !args.notifyOnSuccess) return;

  const emoji =
    status === "SUCCESS" ? "✅" : status === "PARTIAL" ? "⚠️" : "🚨";
  const heading =
    status === "SUCCESS"
      ? `${emoji} Бекап завершён: ${type}`
      : status === "PARTIAL"
      ? `${emoji} Бекап PARTIAL: ${type}`
      : `${emoji} CRITICAL: Бекап ${type} упал`;

  const lines = [heading];
  if (sizeBytes != null) {
    const mb = Math.round((Number(sizeBytes) / 1024 / 1024) * 100) / 100;
    lines.push(`Размер: ${mb} МБ`);
  }
  if (durationMs != null) {
    lines.push(`Длительность: ${Math.round(durationMs / 1000)} сек`);
  }
  if (storagePath) {
    lines.push(`Путь: <code>${escapeHtml(storagePath)}</code>`);
  }
  if (error) {
    lines.push(`Ошибка: <code>${escapeHtml(error.slice(0, 500))}</code>`);
  }
  lines.push(`<i>${new Date().toISOString()}</i>`);

  await sendTelegramAlert(lines.join("\n"), { parseMode: "HTML" });
}

/**
 * Notify a SUPERADMIN restore event — always sent (destructive action).
 */
export async function notifyRestore(args: {
  scope: "full" | "table" | "record" | "FULL" | "TABLE" | "RECORD";
  table?: string | null;
  status: BackupStatus;
  performedByName?: string | null;
  affectedRows?: number | null;
  error?: string | null;
  dryRun?: boolean;
}): Promise<void> {
  const emoji =
    args.status === "SUCCESS" ? "🔄" : args.status === "PARTIAL" ? "⚠️" : "🚨";
  const prefix = args.dryRun ? "[DRY-RUN] " : "";
  const lines = [
    `${emoji} ${prefix}Restore ${args.scope}${
      args.table ? ` (${escapeHtml(args.table)})` : ""
    } — ${args.status}`,
  ];
  if (args.performedByName) {
    lines.push(`Выполнил: ${escapeHtml(args.performedByName)}`);
  }
  if (args.affectedRows != null) {
    lines.push(`Строк затронуто: ${args.affectedRows}`);
  }
  if (args.error) {
    lines.push(`Ошибка: <code>${escapeHtml(args.error.slice(0, 500))}</code>`);
  }
  lines.push(`<i>${new Date().toISOString()}</i>`);

  await sendTelegramAlert(lines.join("\n"), { parseMode: "HTML" });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
