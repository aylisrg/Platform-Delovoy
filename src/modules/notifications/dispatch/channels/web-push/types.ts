/**
 * Канонический формат браузерной подписки PushManager.subscribe().
 * Используется только при сериализации/десериализации payload-ов.
 */
export type BrowserPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
};

/**
 * Конфиг VAPID, валидированный из env. Все поля обязательны для работы канала.
 */
export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};
