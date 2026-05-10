import { z } from "zod";
import type { VapidConfig } from "./types";

/**
 * Public key — base64url, обычно ~87 символов (uncompressed P-256: 65 байт * 4/3).
 * Private key — base64url, обычно ~43 символа (32 байта * 4/3).
 * Subject — mailto: URI или https URL (RFC 8292 §2.1).
 */
const vapidConfigSchema = z.object({
  publicKey: z
    .string()
    .min(40, "VAPID_PUBLIC_KEY too short")
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, "VAPID_PUBLIC_KEY must be base64url"),
  privateKey: z
    .string()
    .min(20, "VAPID_PRIVATE_KEY too short")
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, "VAPID_PRIVATE_KEY must be base64url"),
  subject: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("mailto:") || v.startsWith("https://"), {
      message: "VAPID_SUBJECT must start with mailto: or https://",
    }),
});

/**
 * Выбираем env-переменные. PRD AC-4.2 называет переменную VAPID_CONTACT_EMAIL,
 * но в ADR закреплено единое имя VAPID_SUBJECT (поскольку web-push.setVapidDetails
 * принимает именно subject — может быть как mailto:, так и https://).
 * Принимаем оба варианта: VAPID_SUBJECT приоритетен, fallback — VAPID_CONTACT_EMAIL.
 */
function readSubject(env: Partial<Record<string, string | undefined>>): string | undefined {
  if (env.VAPID_SUBJECT) return env.VAPID_SUBJECT;
  const email = env.VAPID_CONTACT_EMAIL;
  if (!email) return undefined;
  return email.startsWith("mailto:") ? email : `mailto:${email}`;
}

/**
 * Читает и валидирует VAPID-конфиг из окружения.
 * Возвращает null если хотя бы одна переменная отсутствует или невалидна —
 * канал переходит в состояние unavailable, не падает.
 */
export function readVapidConfigFromEnv(
  env: Partial<Record<string, string | undefined>> = process.env,
): VapidConfig | null {
  const candidate = {
    publicKey: env.VAPID_PUBLIC_KEY ?? "",
    privateKey: env.VAPID_PRIVATE_KEY ?? "",
    subject: readSubject(env) ?? "",
  };
  const parsed = vapidConfigSchema.safeParse(candidate);
  if (!parsed.success) return null;
  return parsed.data;
}

/**
 * Feature-flag: канал работает ТОЛЬКО когда WEB_PUSH_ENABLED=true И валидный VAPID.
 * По умолчанию OFF — безопасный no-op деплой.
 */
export function isWebPushEnabled(env: Partial<Record<string, string | undefined>> = process.env): boolean {
  if (env.WEB_PUSH_ENABLED !== "true") return false;
  return readVapidConfigFromEnv(env) !== null;
}
