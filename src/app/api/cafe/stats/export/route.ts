import { NextRequest, NextResponse } from "next/server";
import {
  apiUnauthorized,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getCafeStats } from "@/modules/cafe/service";
import { statsQuerySchema } from "@/modules/cafe/validation";

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * GET /api/cafe/stats/export?dateFrom=…&dateTo=… — CSV-отчёт по продажам кафе.
 * BOM + ; как разделитель — чтобы Excel с русской локалью открывал без импорта.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "cafe");
    if (denied) return denied;

    const parsed = statsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const stats = await getCafeStats(parsed.data);

    const lines: string[] = [];
    lines.push(`Отчёт кафе;${parsed.data.dateFrom} — ${parsed.data.dateTo}`);
    lines.push("");
    lines.push("Итоги");
    lines.push(`Заказов;${stats.ordersCount}`);
    lines.push(`Выручка, ₽;${stats.revenue.toFixed(2)}`);
    lines.push(`Средний чек, ₽;${stats.avgCheck.toFixed(2)}`);
    lines.push(`Оплачено онлайн;${stats.onlineCount}`);
    lines.push(`Выручка онлайн, ₽;${stats.onlineRevenue.toFixed(2)}`);
    lines.push("");
    lines.push("По дням");
    lines.push("Дата;Заказов;Выручка, ₽");
    for (const day of stats.byDay) {
      lines.push(`${day.date};${day.orders};${day.revenue.toFixed(2)}`);
    }
    lines.push("");
    lines.push("По позициям");
    lines.push("Позиция;Категория;Кол-во;Выручка, ₽");
    for (const item of stats.topItems) {
      lines.push(
        `${csvEscape(item.name)};${csvEscape(item.category)};${item.quantity};${item.revenue.toFixed(2)}`
      );
    }
    lines.push("");
    lines.push("По категориям");
    lines.push("Категория;Кол-во;Выручка, ₽");
    for (const cat of stats.byCategory) {
      lines.push(`${csvEscape(cat.category)};${cat.quantity};${cat.revenue.toFixed(2)}`);
    }
    if (stats.byPaymentMethod.length > 0) {
      lines.push("");
      lines.push("Способы онлайн-оплаты");
      lines.push("Способ;Платежей");
      for (const m of stats.byPaymentMethod) {
        lines.push(`${csvEscape(m.method)};${m.count}`);
      }
    }

    const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cafe-stats-${parsed.data.dateFrom}-${parsed.data.dateTo}.csv"`,
      },
    });
  } catch {
    return apiServerError();
  }
}
