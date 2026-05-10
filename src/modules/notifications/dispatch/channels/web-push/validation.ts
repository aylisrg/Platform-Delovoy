import { z } from "zod";

/**
 * Allowlist хостов push-сервисов — защита от SSRF.
 * Любой endpoint, не попадающий ни под одно правило, отвергается.
 * См. ADR §«Безопасность» п.2.
 */
const ALLOWED_PUSH_HOST_PATTERNS: ReadonlyArray<RegExp> = [
  /^fcm\.googleapis\.com$/i,
  /^.+\.push\.apple\.com$/i,
  /^web\.push\.apple\.com$/i,
  /^updates\.push\.services\.mozilla\.com$/i,
  /^.+\.notify\.windows\.com$/i,
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return ALLOWED_PUSH_HOST_PATTERNS.some((re) => re.test(url.hostname));
}

/**
 * Тело запроса POST /api/notifications/web-push/subscribe.
 * Структура соответствует JSON.parse(JSON.stringify(PushSubscription)).
 */
export const webPushSubscribeSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2000)
    .refine(isAllowedPushEndpoint, {
      message: "endpoint host not allowed",
    }),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
  userAgent: z.string().max(500).optional(),
});

export type WebPushSubscribeInput = z.infer<typeof webPushSubscribeSchema>;

export const webPushUnsubscribeSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2000)
    .refine(isAllowedPushEndpoint, {
      message: "endpoint host not allowed",
    }),
});

export type WebPushUnsubscribeInput = z.infer<typeof webPushUnsubscribeSchema>;
