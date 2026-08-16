import { prisma } from "./db";
import type { EventLevel } from "@prisma/client";
import { redis, redisAvailable } from "./redis";
import { sendAlert } from "./notifications";
import { escapeHtml } from "./telegram/escape";
import type { EventSource } from "./event-sources";

/**
 * Log a system event to the database.
 */
export async function logEvent(
  level: EventLevel,
  source: EventSource,
  message: string,
  metadata?: Record<string, unknown>
) {
  try {
    await prisma.systemEvent.create({
      data: {
        level,
        source,
        message,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      },
    });
  } catch (error) {
    // Fallback to console if DB is unavailable
    console.error(`[${level}] [${source}] ${message}`, metadata, error);
  }
}

/**
 * Log an audit trail entry for user actions.
 */
export async function logAudit(
  userId: string,
  action: string,
  entity: string,
  entityId?: string,
  metadata?: Record<string, unknown>
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      },
    });
  } catch (error) {
    console.error(`[AUDIT] ${action} ${entity} ${entityId}`, metadata, error);
  }
}

const CRITICAL_ALERT_THROTTLE_TTL = 300; // seconds, per source

/**
 * Телеграм-алерт для CRITICAL, не чаще раза в 300с на один source — иначе
 * шторм повторяющихся CRITICAL (например, БД лежит несколько минут подряд)
 * завалил бы админ-чат тем же сообщением. `SET NX EX` атомарен — исключает
 * гонку между двумя параллельными critical-логами одного source. Redis
 * недоступен → шлём без троттлинга: не терять инцидент молча важнее, чем
 * изредка продублировать алерт. Ошибка отправки не должна ронять
 * вызывающий код — fire-and-forget с собственным try/catch.
 */
async function alertCritical(source: EventSource, message: string): Promise<void> {
  let shouldAlert = true;
  if (redisAvailable) {
    try {
      const acquired = await redis.set(
        `critical-alert:${source}`,
        "1",
        "EX",
        CRITICAL_ALERT_THROTTLE_TTL,
        "NX"
      );
      shouldAlert = acquired !== null; // null — тот же source уже алертили в этом окне
    } catch {
      // Ошибка Redis — троттлинг недоступен, шлём как есть (fail-open).
    }
  }
  if (!shouldAlert) return;
  try {
    // sendAlert() шлёт с parse_mode:"HTML" и сам не эскейпит — source/message
    // здесь может содержать данные пользователя (например, имя из фидбека),
    // непроэкранированный HTML сломает парсинг сообщения в Telegram или
    // откроет XSS-подобную инъекцию (кликабельные ссылки) в админ-чате.
    await sendAlert("CRITICAL", escapeHtml(source), escapeHtml(message));
  } catch (error) {
    console.error(`[CRITICAL alert] Не удалось отправить алерт для ${source}`, error);
  }
}

// Convenience methods
export const log = {
  info: (source: EventSource, message: string, metadata?: Record<string, unknown>) =>
    logEvent("INFO", source, message, metadata),
  warn: (source: EventSource, message: string, metadata?: Record<string, unknown>) =>
    logEvent("WARNING", source, message, metadata),
  error: (source: EventSource, message: string, metadata?: Record<string, unknown>) =>
    logEvent("ERROR", source, message, metadata),
  critical: (source: EventSource, message: string, metadata?: Record<string, unknown>) => {
    void alertCritical(source, message);
    return logEvent("CRITICAL", source, message, metadata);
  },
};
