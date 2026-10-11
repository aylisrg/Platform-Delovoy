import { describe, it, expect } from "vitest";
import {
  renderClientMessage,
  renderAdminMessage,
  clientTemplates,
  adminTemplates,
} from "../templates";

describe("renderClientMessage", () => {
  const slot = {
    resourceName: "Беседка №1",
    date: "2026-10-10",
    startTime: "16:00",
    endTime: "22:00",
  };

  it("renders gazebos booking.confirmed с человеческой датой", () => {
    const msg = renderClientMessage("gazebos", "booking.confirmed", slot);
    expect(msg).toContain("Бронь подтверждена");
    expect(msg).toContain("Беседка №1");
    expect(msg).toContain("сб, 10 октября · 16:00–22:00");
    expect(msg).not.toContain("2026-10-10");
  });

  describe("booking.created: что ждёт клиента, зависит от paymentFlow", () => {
    it("online — просим оплатить, подтверждение придёт само", () => {
      const msg = renderClientMessage("gazebos", "booking.created", { ...slot, paymentFlow: "online" });
      expect(msg).toContain("осталось оплатить");
      expect(msg).toContain("подтвердится автоматически");
      expect(msg).not.toContain("Ожидайте подтверждения");
    });

    it("link — бронь из бота: оплата по ссылке", () => {
      const msg = renderClientMessage("gazebos", "booking.created", { ...slot, paymentFlow: "link" });
      expect(msg).toContain("ещё не оплачена");
      expect(msg).toContain("по ссылке");
    });

    it("manual (и ps-park по умолчанию) — подтвердит администратор", () => {
      const msg = renderClientMessage("ps-park", "booking.created", slot);
      expect(msg).toContain("Заявка на бронь принята");
      expect(msg).toContain("Администратор");
    });
  });

  it.each([
    ["gazebos", "BOOKING", "оформите бронь заново"],
    ["cafe", "ORDER", "оформите заказ заново"],
    ["ps-park", "SUBSCRIPTION", "оформите заново"],
  ])(
    "payment.canceled (%s, %s) — предмет отменён, оформить заново, а не «оплатить ещё раз»",
    (moduleSlug, subjectType, expected) => {
      const msg = renderClientMessage(moduleSlug, "payment.canceled", {
        amount: "4 000,00",
        description: "Оплата",
        subjectType,
      })!;
      expect(msg).toContain("Деньги не списаны");
      expect(msg).toContain(expected);
      expect(msg).not.toContain("ещё раз");
    }
  );

  it("payment.canceled по счёту брони PS Park — счёт можно оплатить ещё раз", () => {
    const msg = renderClientMessage("ps-park", "payment.canceled", {
      amount: "1 500,00",
      description: "Сессия",
      subjectType: "BOOKING",
    })!;
    expect(msg).toContain("Счёт можно оплатить ещё раз");
  });

  it("дата в описании платежа показывается по-человечески", () => {
    const msg = renderClientMessage("gazebos", "payment.succeeded", {
      amount: "4 000,00",
      description: "Беседка: Беседка №1, 2026-10-10 16:00–22:00",
    })!;
    expect(msg).toContain("Беседка №1, сб, 10 октября 16:00–22:00");
    expect(msg).not.toContain("2026-10-10");
  });

  it("booking.cancelled за неоплату объясняет причину", () => {
    const msg = renderClientMessage("gazebos", "booking.cancelled", {
      ...slot,
      cancelledBecause: "unpaid",
    });
    expect(msg).toContain("оплата не поступила");
    expect(msg).toContain("снова свободно");
  });

  it("booking.rescheduled показывает было/стало", () => {
    const msg = renderClientMessage("gazebos", "booking.rescheduled", {
      ...slot,
      oldDate: "2026-10-09",
      oldStartTime: "12:00",
      oldEndTime: "18:00",
    });
    expect(msg).toContain("Было: пт, 9 октября · 12:00–18:00");
    expect(msg).toContain("Стало: сб, 10 октября · 16:00–22:00");
  });

  it("booking.reminder понимает дату из планировщика (DD.MM.YYYY)", () => {
    const msg = renderClientMessage("gazebos", "booking.reminder", {
      ...slot,
      date: "10.10.2026",
    });
    expect(msg).toContain("Через час");
    expect(msg).toContain("сб, 10 октября");
  });

  it("cafe order.ready с доставкой не просит «заберите»", () => {
    const msg = renderClientMessage("cafe", "order.ready", {
      orderNumber: "ABC123",
      deliveryTo: "301",
    });
    expect(msg).toContain("ABC123");
    expect(msg).toContain("готов");
    expect(msg).toContain("301");
    expect(msg).not.toContain("Заберите");
  });

  it("cafe order.ready без доставки — забрать на стойке", () => {
    const msg = renderClientMessage("cafe", "order.ready", { orderNumber: "ABC123" });
    expect(msg).toContain("заберите его на стойке");
  });

  it("returns null for unknown module", () => {
    expect(renderClientMessage("unknown", "booking.confirmed", {})).toBeNull();
  });

  it("returns null for unknown event", () => {
    expect(renderClientMessage("gazebos", "unknown.event", {})).toBeNull();
  });
});

describe("renderAdminMessage", () => {
  const booking = {
    resourceName: "Беседка №3",
    date: "2026-10-10",
    startTime: "16:00",
    endTime: "22:00",
    clientName: "Иван Петров",
    clientPhone: "+79991234567",
    bookingId: "b1",
  };

  describe("gazebos booking.created", () => {
    it("manual — заголовок «нужно подтвердить», клиент, телефон и ссылка", () => {
      const msg = renderAdminMessage("gazebos", "booking.created", booking)!;
      expect(msg).toContain("Новая бронь — нужно подтвердить");
      expect(msg).toContain("👤 Иван Петров · +79991234567");
      expect(msg).toContain("📅 сб, 10 октября · 16:00–22:00");
      expect(msg).toContain("/admin/gazebos/bookings/b1");
      expect(msg).not.toContain("Требуется подтверждение");
    });

    it("link — ждёт оплаты, подтверждать вручную только при оплате на месте", () => {
      const msg = renderAdminMessage("gazebos", "booking.created", { ...booking, paymentFlow: "link" })!;
      expect(msg).toContain("ждёт оплаты");
      expect(msg).toContain("подтвердится сама");
    });

    it("paid — оплаченная бронь с сайта для лично подписавшихся: «ничего делать не нужно»", () => {
      const msg = renderAdminMessage("gazebos", "booking.created", {
        ...booking,
        paymentFlow: "online",
        paid: true,
      })!;
      expect(msg).toContain("Новая бронь — оплачена онлайн");
      expect(msg).toContain("ничего делать не нужно");
    });

    it("без клиента не печатает пустое «Клиент:»", () => {
      const msg = renderAdminMessage("gazebos", "booking.created", {
        ...booking,
        clientName: undefined,
        clientPhone: undefined,
      })!;
      expect(msg).not.toContain("👤");
      expect(msg).not.toContain("Клиент:");
    });
  });

  it("ps-park booking.created ведёт на страницу сессии", () => {
    const msg = renderAdminMessage("ps-park", "booking.created", { ...booking, resourceName: "Стол 2" })!;
    expect(msg).toContain("нужно подтвердить");
    expect(msg).toContain("/admin/ps-park/sessions/b1");
  });

  it.each([
    [{ cancelledBecause: "unpaid" }, "Оплата не поступила"],
    [{ cancelledBy: "client" }, "Отменил клиент"],
    [{ cancelledBy: "admin" }, "Отменена администратором"],
  ])("booking.cancelled объясняет, кто/почему отменил (%o)", (extra, expected) => {
    const msg = renderAdminMessage("gazebos", "booking.cancelled", { ...booking, ...extra })!;
    expect(msg).toContain("Бронь отменена");
    expect(msg).toContain(expected);
  });

  it("payment.succeeded по брони беседки — полноценное «бронь оплачена»", () => {
    const msg = renderAdminMessage("gazebos", "payment.succeeded", {
      ...booking,
      amount: "12 000,00",
      description: "Беседка: Беседка №3, 2026-10-10 16:00–22:00",
      subjectType: "BOOKING",
    })!;
    expect(msg).toContain("Бронь оплачена онлайн: 12 000,00 ₽");
    expect(msg).toContain("Иван Петров");
    expect(msg).toContain("ничего делать не нужно");
    expect(msg).toContain("/admin/gazebos/bookings/b1");
  });

  it("payment.succeeded по уже отменённой брони — просит восстановить или вернуть деньги", () => {
    const msg = renderAdminMessage("gazebos", "payment.succeeded", {
      ...booking,
      amount: "12 000,00",
      subjectType: "BOOKING",
      bookingStatus: "CANCELLED",
    })!;
    expect(msg).toContain("Оплата по отменённой брони");
    expect(msg).toContain("возврат");
    expect(msg).not.toContain("ничего делать не нужно");
  });

  it("payment.succeeded без брони (заказ кафе) — сумма и описание", () => {
    const msg = renderAdminMessage("cafe", "payment.succeeded", {
      amount: "850,00",
      description: "Заказ кафе",
      subjectType: "ORDER",
    })!;
    expect(msg).toContain("Онлайн-оплата: 850,00 ₽");
    expect(msg).toContain("Заказ кафе");
  });

  it("renders cafe order.placed", () => {
    const msg = renderAdminMessage("cafe", "order.placed", {
      orderNumber: "XYZ789",
      clientName: "Мария",
      totalAmount: "1500",
      itemCount: 3,
    })!;
    expect(msg).toContain("Новый заказ #XYZ789");
    expect(msg).toContain("Мария");
    expect(msg).toContain("1\u00a0500 ₽");
    expect(msg).toContain("Самовывоз");
  });

  it("renders rental contract.expiring с правильным склонением", () => {
    const msg = renderAdminMessage("rental", "contract.expiring", {
      tenantName: "ООО Тест",
      officeNumber: "A-12",
      endDate: "10.05.2026",
      daysLeft: 22,
    })!;
    expect(msg).toContain("заканчивается через 22 дня");
    expect(msg).toContain("ООО Тест");
    expect(msg).toContain("10 мая 2026");
  });

  it("rental contract.expiring без числа дней не печатает «NaN»", () => {
    const msg = renderAdminMessage("rental", "contract.expiring", {
      tenantName: "ООО Тест",
      officeNumber: "A-12",
      endDate: "10.05.2026",
    })!;
    expect(msg).toContain("Договор аренды заканчивается");
    expect(msg).not.toContain("NaN");
  });

  it("rental inquiry.created не печатает пустые поля-заглушки", () => {
    const msg = renderAdminMessage("rental-inquiry", "inquiry.created", {
      name: "Иван",
      phone: "+7900",
      email: "—",
      companyName: "—",
      officeNumber: "Общий запрос",
      message: "—",
    })!;
    expect(msg).toContain("Иван · +7900");
    expect(msg).not.toContain("Email:");
    expect(msg).not.toContain("Компания:");
    expect(msg).not.toContain("Сообщение:");
  });
});

describe("HTML escaping (#471)", () => {
  // Самый серьёзный найденный вектор: заявка на офис доступна анонимно через
  // POST /api/rental/inquiries и /api/nedelovoy/inquiries без ограничения
  // символов в message (до 2000), и уходит в parse_mode:"HTML" админ-чат.
  it("экранирует поля заявки на аренду в adminTemplates.rental['inquiry.created']", () => {
    const msg = renderAdminMessage("rental", "inquiry.created", {
      name: "<b>Хакер</b>",
      phone: "<i>+7900</i>",
      email: "a@b.com<script>alert(1)</script>",
      companyName: "<u>ООО Зло</u>",
      officeNumber: "A-1",
      message: "<a href=\"evil\">click</a> & <b>bold</b>",
    });

    expect(msg).toContain("&lt;b&gt;Хакер&lt;/b&gt;");
    expect(msg).toContain("&lt;i&gt;+7900&lt;/i&gt;");
    expect(msg).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(msg).toContain("&lt;u&gt;ООО Зло&lt;/u&gt;");
    expect(msg).toContain("&lt;a href=\"evil\"&gt;click&lt;/a&gt; &amp; &lt;b&gt;bold&lt;/b&gt;");
    expect(msg).not.toContain("<script>");
    expect(msg).not.toContain('<a href="evil">');
  });

  it("экранирует поля заявки на офис в adminTemplates['rental-inquiry']['inquiry.created']", () => {
    const msg = renderAdminMessage("rental-inquiry", "inquiry.created", {
      name: "<b>Хакер</b>",
      phone: "+7900",
      email: "a@b.com",
      companyName: "ООО Ромашка",
      officeNumber: "A-2",
      message: "<img src=x onerror=alert(1)>",
    });

    expect(msg).toContain("&lt;b&gt;Хакер&lt;/b&gt;");
    expect(msg).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(msg).not.toContain("<img src=");
  });

  it("экранирует имя клиента в adminTemplates.gazebos['booking.created'] (гостевое бронирование)", () => {
    const msg = renderAdminMessage("gazebos", "booking.created", {
      resourceName: "Беседка №1",
      date: "2026-04-15",
      startTime: "10:00",
      endTime: "12:00",
      clientName: "<b>Гость</b>",
    });
    expect(msg).toContain("&lt;b&gt;Гость&lt;/b&gt;");
    expect(msg).not.toContain("<b>Гость</b>");
  });

  it("экранирует description в paymentAdminTemplates['payment.succeeded']", () => {
    const msg = renderAdminMessage("gazebos", "payment.succeeded", {
      amount: "1000",
      description: "<script>alert(1)</script>",
    });
    expect(msg).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(msg).not.toContain("<script>");
  });
});

describe("template coverage", () => {
  it("all client templates produce non-empty strings", () => {
    for (const [module, events] of Object.entries(clientTemplates)) {
      for (const [event, fn] of Object.entries(events)) {
        const result = fn({
          resourceName: "Test",
          date: "2026-01-01",
          startTime: "10:00",
          endTime: "11:00",
          orderNumber: "T123",
          deliveryTo: "100",
        });
        expect(result, `${module}.${event} should produce non-empty string`).toBeTruthy();
      }
    }
  });

  it("all admin templates produce non-empty strings", () => {
    for (const [module, events] of Object.entries(adminTemplates)) {
      for (const [event, fn] of Object.entries(events)) {
        const result = fn({
          resourceName: "Test",
          date: "2026-01-01",
          startTime: "10:00",
          endTime: "11:00",
          userName: "User",
          orderNumber: "T123",
          totalAmount: "100",
          itemCount: 1,
          tenantName: "Company",
          officeNumber: "A-1",
          monthlyRate: "50000",
          daysLeft: 10,
          endDate: "2026-02-01",
          startDate: "2026-01-01",
        });
        expect(result, `${module}.${event} admin should produce non-empty string`).toBeTruthy();
      }
    }
  });
});
