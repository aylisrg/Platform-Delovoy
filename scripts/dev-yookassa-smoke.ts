/**
 * Ручной смоук-тест клиента ЮKassa (тестовый магазин или боевой на 10 ₽).
 * Проверяет: создание платежа, идемпотентность, чек 54-ФЗ, статус, полный возврат.
 * Запуск:
 *   YOOKASSA_SHOP_ID=... YOOKASSA_SECRET_KEY=... YOOKASSA_RECEIPTS_ENABLED=true \
 *     npx tsx scripts/dev-yookassa-smoke.ts create
 *   ... check <paymentId>  — статус платежа
 *   ... refund <paymentId> — полный возврат + контрольный статус
 * Не входит в оркестрацию seed/CI — только ручная диагностика.
 */
import {
  createPayment,
  getPayment,
  createRefund,
  newIdempotenceKey,
  toAmountValue,
} from "../src/lib/yookassa/client";
import { buildReceipt } from "../src/lib/yookassa/receipts";

const [, , command, arg] = process.argv;

async function main() {
  if (command === "create") {
    const idempotenceKey = newIdempotenceKey();
    const receipt = buildReceipt(
      { email: process.env.SMOKE_EMAIL ?? "test@delovoy-park.ru" },
      [{ description: "Смоук-тест: аренда беседки", amount: 10, paymentMode: "full_prepayment" }]
    );
    const payment = await createPayment(
      {
        amount: { value: toAmountValue(10), currency: "RUB" },
        capture: true,
        confirmation: { type: "redirect", return_url: "https://delovoy-park.ru/payments/smoke-test" },
        description: "Смоук-тест интеграции (тестовый магазин)",
        metadata: { smoke: "true" },
        ...(receipt && { receipt }),
      },
      idempotenceKey
    );
    console.log("=== ПЛАТЁЖ СОЗДАН ===");
    console.log("id:", payment.id);
    console.log("status:", payment.status, "| test:", payment.test);
    console.log("confirmation_url:", payment.confirmation?.confirmation_url);

    // Идемпотентность: повтор с тем же ключом обязан вернуть ТОТ ЖЕ платёж
    const repeat = await createPayment(
      {
        amount: { value: toAmountValue(10), currency: "RUB" },
        capture: true,
        confirmation: { type: "redirect", return_url: "https://delovoy-park.ru/payments/smoke-test" },
        description: "Смоук-тест интеграции (тестовый магазин)",
        metadata: { smoke: "true" },
        ...(receipt && { receipt }),
      },
      idempotenceKey
    );
    console.log("идемпотентность:", repeat.id === payment.id ? "OK (тот же id)" : `ПРОВАЛ (${repeat.id})`);
  } else if (command === "check" && arg) {
    const payment = await getPayment(arg);
    console.log(JSON.stringify(payment, null, 2));
  } else if (command === "refund" && arg) {
    const payment = await getPayment(arg);
    const receipt = buildReceipt(
      { email: process.env.SMOKE_EMAIL ?? "test@delovoy-park.ru" },
      [{ description: "Смоук-тест: аренда беседки", amount: Number(payment.amount.value) }]
    );
    const refund = await createRefund(
      {
        payment_id: arg,
        amount: payment.amount,
        description: "Смоук-тест: полный возврат",
        ...(receipt && { receipt }),
      },
      newIdempotenceKey()
    );
    console.log("=== ВОЗВРАТ ===");
    console.log("refund id:", refund.id, "| status:", refund.status, "| amount:", refund.amount.value);
    const after = await getPayment(arg);
    console.log("платёж после возврата: status =", after.status, "| refunded_amount =", after.refunded_amount?.value);
  } else {
    console.log("usage: create | check <id> | refund <id>");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("СМОУК-ТЕСТ УПАЛ:", err);
  process.exit(1);
});
