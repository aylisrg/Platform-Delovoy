import { InlineKeyboard } from "grammy";

/**
 * Create a keyboard with gazebo resources.
 */
export function gazeboListKeyboard(
  resources: Array<{ id: string; name: string; capacity?: number | null; pricePerHour?: string | number | null }>
) {
  const keyboard = new InlineKeyboard();
  for (const r of resources) {
    const parts = [r.name];
    if (r.capacity) parts.push(`(${r.capacity} чел.)`);
    if (r.pricePerHour) parts.push(`${Number(r.pricePerHour)} ₽/ч`);
    keyboard.text(parts.join(" "), `gazebo_select:${r.id}`).row();
  }
  return keyboard;
}

/**
 * Create a date selection keyboard for the next N days.
 */
export function dateKeyboard(resourceId: string, days = 7) {
  const keyboard = new InlineKeyboard();
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split("T")[0];
    const label = date.toLocaleDateString("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    keyboard.text(label, `gazebo_date:${resourceId}:${dateStr}`).row();
  }
  return keyboard;
}
