/**
 * Клиент-безопасные типы Mini App: без импортов Prisma/БД.
 * Серверная логика вычисления — в `capabilities.ts` (импортирует prisma,
 * в клиентский бандл попадать не должна).
 */
export interface WebAppCapabilities {
  isStaff: boolean;
  staffSections: string[];
  notificationCategories: string[];
  canNotificationCenter: boolean;
}

export const GUEST_CAPABILITIES: WebAppCapabilities = Object.freeze({
  isStaff: false,
  staffSections: [],
  notificationCategories: [],
  canNotificationCenter: false,
});
