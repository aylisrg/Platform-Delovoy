const YM_ID = 73068007;

type YmGoal =
  // Беседки
  | "gazebo_booking_start"      // открыл форму бронирования
  | "gazebo_booking_submit"     // отправил заявку
  | "gazebo_booking_success"    // бронь подтверждена
  // PS Park
  | "pspark_booking_start"
  | "pspark_booking_submit"
  | "pspark_booking_success"
  // Офисы
  | "office_inquiry_start"      // кликнул "Узнать цену" / "Посмотреть"
  | "office_inquiry_submit"     // отправил заявку на офис
  | "office_inquiry_success"
  // Кафе
  | "cafe_order_start"
  | "cafe_order_submit"
  // Общие
  | "phone_click"               // клик по номеру телефона
  | "map_click"                 // клик "Как добраться"
  | "whatsapp_click"
  | "telegram_click";

declare global {
  interface Window {
    ym?: (id: number, action: string, goal?: string, params?: object) => void;
  }
}

export function reachGoal(goal: YmGoal, params?: Record<string, unknown>) {
  if (typeof window !== "undefined" && window.ym) {
    window.ym(YM_ID, "reachGoal", goal, params);
  }
}

export function hitPage(url: string) {
  if (typeof window !== "undefined" && window.ym) {
    window.ym(YM_ID, "hit", url);
  }
}
