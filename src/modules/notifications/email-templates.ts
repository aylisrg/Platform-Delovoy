/**
 * HTML email templates for transactional notifications.
 * All styles are inline (email-client compatible).
 * Uses emailLayout() wrapper for consistent header/footer.
 */

type TemplateData = Record<string, unknown>;

// ─── Layout ───────────────────────────────────────────────────────────────────

function emailLayout(
  content: string,
  options?: { accentColor?: string; title?: string }
): string {
  const accent = options?.accentColor || "#0071e3";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://delovoy-park.ru";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${options?.title || "Деловой Парк"}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="padding:24px 32px 20px;border-bottom:1px solid #e5e5e5;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <span style="font-size:17px;font-weight:700;color:#1d1d1f;letter-spacing:-0.3px;">Деловой Парк</span>
                </td>
                <td align="right">
                  <span style="font-size:12px;color:#86868b;">Селятино, МО</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Content -->
        <tr>
          <td style="padding:32px;">
            ${content}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e5e5;background:#fafafa;">
            <p style="margin:0;font-size:12px;color:#aeaeb2;line-height:1.6;">
              Бизнес-парк «Деловой», Селятино, Московская область<br>
              <a href="${appUrl}" style="color:${accent};text-decoration:none;">${appUrl.replace("https://", "")}</a>
              &nbsp;·&nbsp;
              <a href="tel:+74996774888" style="color:${accent};text-decoration:none;">+7 (499) 677-48-88</a>
            </p>
            <p style="margin:8px 0 0;font-size:11px;color:#c7c7cc;">
              Вы получили это письмо, так как совершили действие на платформе Деловой Парк.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Helper: button ────────────────────────────────────────────────────────────

function primaryButton(text: string, href: string, accent: string): string {
  return `<a href="${href}" style="display:inline-block;background:${accent};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:20px;margin-top:20px;">${text}</a>`;
}

// ─── Helper: info row ─────────────────────────────────────────────────────────

function infoRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:#86868b;width:110px;">${label}</td>
    <td style="padding:6px 0;font-size:13px;color:#1d1d1f;font-weight:500;">${value}</td>
  </tr>`;
}

// ─── Booking: Created ─────────────────────────────────────────────────────────

export function bookingCreatedHtml(data: TemplateData): string {
  const accent = moduleAccent(String(data.moduleSlug || ""));
  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1d1d1f;letter-spacing:-0.4px;">
      Заявка принята!
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#86868b;line-height:1.6;">
      Ваша заявка на бронирование получена. Мы подтвердим её в ближайшее время.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f5f5f7;border-radius:12px;padding:16px 20px;">
      <tbody>
        ${infoRow("Объект", String(data.resourceName || ""))}
        ${infoRow("Дата", String(data.date || ""))}
        ${infoRow("Время", `${data.startTime} — ${data.endTime}`)}
      </tbody>
    </table>
    <p style="margin:20px 0 0;font-size:13px;color:#86868b;line-height:1.6;">
      Ожидайте подтверждения — мы пришлём письмо, как только менеджер обработает заявку.
    </p>
  `;
  return emailLayout(content, { accentColor: accent, title: "Заявка на бронирование" });
}

export function bookingCreatedText(data: TemplateData): string {
  return `Заявка принята!\n\n${data.resourceName}\nДата: ${data.date}\nВремя: ${data.startTime} — ${data.endTime}\n\nОжидайте подтверждения.`;
}

// ─── Booking: Confirmed ───────────────────────────────────────────────────────

export function bookingConfirmationHtml(data: TemplateData): string {
  const accent = moduleAccent(String(data.moduleSlug || ""));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://delovoy-park.ru";
  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1d1d1f;letter-spacing:-0.4px;">
      Бронирование подтверждено!
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#86868b;line-height:1.6;">
      Ваше место забронировано. Ждём вас!
    </p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f5f5f7;border-radius:12px;padding:16px 20px;">
      <tbody>
        ${infoRow("Объект", String(data.resourceName || ""))}
        ${infoRow("Дата", String(data.date || ""))}
        ${infoRow("Время", `${data.startTime} — ${data.endTime}`)}
      </tbody>
    </table>
    ${primaryButton("Посмотреть бронирование", `${appUrl}/profile`, accent)}
    <p style="margin:20px 0 0;font-size:13px;color:#86868b;line-height:1.6;">
      Если у вас возникнут вопросы, позвоните нам: <a href="tel:+74996774888" style="color:${accent};">+7 (499) 677-48-88</a>
    </p>
  `;
  return emailLayout(content, { accentColor: accent, title: "Бронирование подтверждено" });
}

export function bookingConfirmationText(data: TemplateData): string {
  return `Бронирование подтверждено!\n\n${data.resourceName}\nДата: ${data.date}\nВремя: ${data.startTime} — ${data.endTime}`;
}

// ─── Booking: Cancelled ───────────────────────────────────────────────────────

export function bookingCancellationHtml(data: TemplateData): string {
  const accent = moduleAccent(String(data.moduleSlug || ""));
  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1d1d1f;letter-spacing:-0.4px;">
      Бронирование отменено
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#86868b;line-height:1.6;">
      Ваше бронирование было отменено.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f5f5f7;border-radius:12px;padding:16px 20px;">
      <tbody>
        ${infoRow("Объект", String(data.resourceName || ""))}
        ${infoRow("Дата", String(data.date || ""))}
        ${infoRow("Время", `${data.startTime} — ${data.endTime}`)}
        ${data.cancelReason ? infoRow("Причина", String(data.cancelReason)) : ""}
      </tbody>
    </table>
    <p style="margin:20px 0 0;font-size:13px;color:#86868b;line-height:1.6;">
      Хотите забронировать другое время? Позвоните нам: <a href="tel:+74996774888" style="color:${accent};">+7 (499) 677-48-88</a>
    </p>
  `;
  return emailLayout(content, { accentColor: accent, title: "Бронирование отменено" });
}

export function bookingCancellationText(data: TemplateData): string {
  return `Бронирование отменено.\n\n${data.resourceName}\nДата: ${data.date}\nВремя: ${data.startTime} — ${data.endTime}${data.cancelReason ? `\nПричина: ${data.cancelReason}` : ""}`;
}

// ─── Booking: Reminder ────────────────────────────────────────────────────────

export function bookingReminderHtml(data: TemplateData): string {
  const accent = moduleAccent(String(data.moduleSlug || ""));
  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1d1d1f;letter-spacing:-0.4px;">
      Напоминание о бронировании
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#86868b;line-height:1.6;">
      Через 1 час начинается ваше бронирование. Не забудьте!
    </p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f5f5f7;border-radius:12px;padding:16px 20px;">
      <tbody>
        ${infoRow("Объект", String(data.resourceName || ""))}
        ${infoRow("Время", String(data.startTime || ""))}
      </tbody>
    </table>
    <p style="margin:20px 0 0;font-size:13px;color:#86868b;line-height:1.6;">
      Адрес: Московская область, Наро-Фоминский район, п. Селятино, ул. Центральная, д. 4
    </p>
  `;
  return emailLayout(content, { accentColor: accent, title: "Напоминание о бронировании" });
}

export function bookingReminderText(data: TemplateData): string {
  return `Напоминание: через 1 час начинается ваше бронирование.\n\n${data.resourceName}\nВремя: ${data.startTime}`;
}

// ─── Order: Placed ────────────────────────────────────────────────────────────

export function orderConfirmationHtml(data: TemplateData): string {
  const accent = "#F59E0B";
  const items = Array.isArray(data.items) ? data.items : [];
  const itemsHtml = items
    .map(
      (item: { name?: string; quantity?: number; price?: number }) =>
        `<tr>
          <td style="padding:4px 0;font-size:13px;color:#1d1d1f;">${item.name || "Позиция"}</td>
          <td style="padding:4px 0;font-size:13px;color:#86868b;text-align:center;">${item.quantity || 1}</td>
          <td style="padding:4px 0;font-size:13px;color:#1d1d1f;text-align:right;">${item.price || "—"} ₽</td>
        </tr>`
    )
    .join("");

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1d1d1f;letter-spacing:-0.4px;">
      Заказ #${data.orderNumber} принят!
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#86868b;line-height:1.6;">
      ${data.deliveryTo ? `Доставим в офис ${data.deliveryTo}.` : "Заберите заказ на стойке кафе."}
    </p>

    ${
      items.length > 0
        ? `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;font-size:11px;color:#86868b;font-weight:600;padding-bottom:8px;border-bottom:1px solid #e5e5e5;">БЛЮДО</th>
            <th style="text-align:center;font-size:11px;color:#86868b;font-weight:600;padding-bottom:8px;border-bottom:1px solid #e5e5e5;">КОЛ-ВО</th>
            <th style="text-align:right;font-size:11px;color:#86868b;font-weight:600;padding-bottom:8px;border-bottom:1px solid #e5e5e5;">ЦЕНА</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="padding-top:12px;font-size:14px;font-weight:700;color:#1d1d1f;border-top:1px solid #e5e5e5;">Итого</td>
            <td style="padding-top:12px;font-size:14px;font-weight:700;color:#1d1d1f;text-align:right;border-top:1px solid #e5e5e5;">${data.totalAmount} ₽</td>
          </tr>
        </tfoot>
      </table>`
        : `<p style="font-size:14px;color:#1d1d1f;font-weight:600;">Сумма: ${data.totalAmount} ₽</p>`
    }

    <p style="margin:20px 0 0;font-size:13px;color:#86868b;line-height:1.6;">
      Следите за статусом заказа — мы пришлём уведомление, когда он будет готов.
    </p>
  `;
  return emailLayout(content, { accentColor: accent, title: `Заказ #${data.orderNumber}` });
}

export function orderConfirmationText(data: TemplateData): string {
  return `Заказ #${data.orderNumber} принят!\n\nСумма: ${data.totalAmount} руб.${data.deliveryTo ? `\nДоставка в офис: ${data.deliveryTo}` : ""}`;
}

// ─── Order: Status Update ─────────────────────────────────────────────────────

const ORDER_STATUS_LABELS: Record<string, string> = {
  PREPARING: "готовится",
  READY: "готов — заберите его!",
  DELIVERED: "доставлен. Приятного аппетита!",
  CANCELLED: "отменён",
};

export function orderStatusHtml(data: TemplateData): string {
  const status = String(data.status || "");
  const label = ORDER_STATUS_LABELS[status] || status.toLowerCase();
  const accent = status === "CANCELLED" ? "#ef4444" : "#F59E0B";

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1d1d1f;letter-spacing:-0.4px;">
      Заказ #${data.orderNumber} ${label}
    </h2>
    ${
      status === "READY" && data.deliveryTo
        ? `<p style="margin:0;font-size:14px;color:#86868b;line-height:1.6;">Доставляем в офис ${data.deliveryTo}.</p>`
        : ""
    }
    ${
      status === "READY" && !data.deliveryTo
        ? `<p style="margin:0;font-size:14px;color:#86868b;line-height:1.6;">Заберите заказ на стойке кафе.</p>`
        : ""
    }
  `;
  return emailLayout(content, { accentColor: accent, title: `Заказ #${data.orderNumber}` });
}

export function orderStatusText(data: TemplateData): string {
  const status = String(data.status || "");
  const label = ORDER_STATUS_LABELS[status] || status.toLowerCase();
  return `Заказ #${data.orderNumber} ${label}.`;
}

// ─── Magic Link ───────────────────────────────────────────────────────────────

export function magicLinkHtml(data: TemplateData): string {
  const accent = "#0071e3";
  const url = String(data.url || "#");
  const expires = String(data.expires || "15 минут");

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1d1d1f;letter-spacing:-0.4px;">
      Войти в аккаунт
    </h2>
    <p style="margin:0 0 24px;font-size:14px;color:#86868b;line-height:1.6;">
      Нажмите кнопку ниже для входа в личный кабинет Деловой Парк. Ссылка действительна ${expires}.
    </p>
    ${primaryButton("Войти в аккаунт", url, accent)}
    <p style="margin:20px 0 0;font-size:12px;color:#aeaeb2;line-height:1.6;">
      Если кнопка не работает, скопируйте ссылку:<br>
      <a href="${url}" style="color:${accent};word-break:break-all;">${url}</a>
    </p>
    <p style="margin:12px 0 0;font-size:12px;color:#aeaeb2;">
      Если вы не запрашивали вход — проигнорируйте это письмо.
    </p>
  `;
  return emailLayout(content, { accentColor: accent, title: "Вход в Деловой Парк" });
}

export function magicLinkText(data: TemplateData): string {
  return `Войти в аккаунт Деловой Парк:\n${data.url}\n\nСсылка действительна ${data.expires || "15 минут"}.`;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

function moduleAccent(moduleSlug: string): string {
  const accents: Record<string, string> = {
    gazebos: "#16A34A",
    "ps-park": "#7C3AED",
    cafe: "#F59E0B",
    auth: "#0071e3",
  };
  return accents[moduleSlug] || "#0071e3";
}

/**
 * Render an HTML email template for a given module + event.
 * Returns null if no template is registered for this combination.
 */
export function renderEmailTemplate(
  moduleSlug: string,
  eventType: string,
  data: TemplateData
): EmailTemplate | null {
  const d = { ...data, moduleSlug };

  switch (eventType) {
    case "booking.created":
      return {
        subject: `Заявка на бронирование принята — ${data.resourceName || "Деловой Парк"}`,
        html: bookingCreatedHtml(d),
        text: bookingCreatedText(d),
      };

    case "booking.confirmed":
      return {
        subject: `Бронирование подтверждено — ${data.resourceName || "Деловой Парк"}`,
        html: bookingConfirmationHtml(d),
        text: bookingConfirmationText(d),
      };

    case "booking.cancelled":
      return {
        subject: `Бронирование отменено — ${data.resourceName || "Деловой Парк"}`,
        html: bookingCancellationHtml(d),
        text: bookingCancellationText(d),
      };

    case "booking.reminder":
      return {
        subject: `Напоминание: ${data.resourceName || "Деловой Парк"} через 1 час`,
        html: bookingReminderHtml(d),
        text: bookingReminderText(d),
      };

    case "order.placed":
      return {
        subject: `Заказ #${data.orderNumber} принят — Кафе Деловой Парк`,
        html: orderConfirmationHtml(d),
        text: orderConfirmationText(d),
      };

    case "order.ready":
    case "order.preparing":
    case "order.delivered":
    case "order.cancelled":
      return {
        subject: `Заказ #${data.orderNumber} — обновление статуса`,
        html: orderStatusHtml(d),
        text: orderStatusText(d),
      };

    default:
      return null;
  }
}
