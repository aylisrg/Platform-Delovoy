import type { NextRequest } from "next/server";
import { apiError, apiResponse, apiServerError, apiUnauthorized, apiValidationError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { ReceiptVatCodeError } from "@/lib/yookassa/receipts";
import { setOnlineBookingEnabled } from "@/modules/ps-park/online-settings";
import { onlineBookingSettingsSchema } from "@/modules/ps-park/validation";

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiError("FORBIDDEN", "Недостаточно прав", 403);

  const parsed = onlineBookingSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiValidationError("Проверьте параметры и обновите страницу");

  try {
    const input = parsed.data;
    return apiResponse(await setOnlineBookingEnabled(session.user.id, input.enabled, input.enabled ? input.offerHash : undefined));
  } catch (error) {
    if (error instanceof ReceiptVatCodeError) {
      return apiError(error.code, "Перед включением проверьте настройку НДС для чеков ЮKassa", 409);
    }
    if (error instanceof Error) {
      switch (error.message) {
        case "SUPERADMIN_REQUIRED":
          return apiError("FORBIDDEN", "Недостаточно прав", 403);
        case "PS_PARK_NOT_FOUND":
          return apiError("NOT_FOUND", "Модуль не найден", 404);
        case "PAYMENTS_NOT_CONFIGURED":
          return apiError(error.message, "Перед включением активируйте модуль и настройте ЮKassa", 409);
        case "PUBLISHED_OFFER_MISMATCH":
          return apiError(error.message, "Проверьте действующую оферту и обновите страницу", 409);
      }
    }
    return apiServerError();
  }
}
