import { describe, it, expect } from "vitest";
import {
  buildReceiptCreatedMessage,
  buildReceiptConfirmedMessage,
  buildReceiptProblemMessage,
  buildReceiptCorrectedMessage,
  buildNoAdminWarningMessage,
} from "../notifications";

// #471 (QA round 2): эти билдеры собирают текст для telegramAdapter.send(),
// который всегда шлёт parse_mode:"HTML" — managerName/adminName приходят из
// User.name (не ограничен на входе), problemNote — свободный текст до 2000
// символов от любого MANAGER (POST /api/inventory/receipts-v2/[id]/problem).
describe("inventory notification message builders — HTML escaping (#471)", () => {
  it("экранирует managerName/итоги в buildReceiptCreatedMessage", () => {
    const msg = buildReceiptCreatedMessage({
      managerName: "<b>Хакер</b>",
      itemCount: 5,
      totalAmount: "<script>alert(1)</script>",
      receivedAt: "2026-08-14",
      receiptId: "r1",
    });
    expect(msg).toContain("&lt;b&gt;Хакер&lt;/b&gt;");
    expect(msg).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(msg).not.toContain("<b>Хакер</b>");
    expect(msg).not.toContain("<script>alert(1)</script>");
    // структурные теги шаблона остаются нетронутыми
    expect(msg).toContain("<b>Новый приход на склад</b>");
  });

  it("экранирует adminName в buildReceiptConfirmedMessage", () => {
    const msg = buildReceiptConfirmedMessage({
      adminName: "<i>Admin</i>",
      receivedAt: "2026-08-14",
    });
    expect(msg).toContain("&lt;i&gt;Admin&lt;/i&gt;");
    expect(msg).not.toContain("<i>Admin</i>");
    expect(msg).toContain("<b>Приход подтверждён</b>");
  });

  it("экранирует problemNote (свободный текст от MANAGER) в buildReceiptProblemMessage", () => {
    const msg = buildReceiptProblemMessage({
      managerName: "Менеджер",
      receivedAt: "2026-08-14",
      problemNote: "<img src=x onerror=alert(1)> недостача & пересорт",
    });
    expect(msg).toContain("&lt;img src=x onerror=alert(1)&gt; недостача &amp; пересорт");
    expect(msg).not.toContain("<img src=");
  });

  it("экранирует adminName в buildReceiptCorrectedMessage", () => {
    const msg = buildReceiptCorrectedMessage({
      adminName: "<b>Admin</b>",
      receivedAt: "2026-08-14",
    });
    expect(msg).toContain("&lt;b&gt;Admin&lt;/b&gt;");
    expect(msg).not.toContain("ADMIN <b>Admin</b>");
  });

  it("экранирует известный moduleSlug в buildNoAdminWarningMessage без изменений отображаемого имени", () => {
    const msg = buildNoAdminWarningMessage("cafe");
    expect(msg).toContain("Кафе");
  });

  it("экранирует произвольный moduleSlug в buildNoAdminWarningMessage", () => {
    const msg = buildNoAdminWarningMessage("<b>evil</b>");
    expect(msg).toContain("&lt;b&gt;evil&lt;/b&gt;");
    expect(msg).not.toContain('"<b>evil</b>"');
  });
});
