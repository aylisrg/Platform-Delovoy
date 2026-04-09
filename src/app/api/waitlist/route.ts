import { NextRequest } from "next/server";
import { z } from "zod";
import { apiResponse, apiValidationError, apiServerError } from "@/lib/api-response";
import { prisma } from "@/lib/db";

const schema = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().min(7).max(20),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiValidationError("Некорректный запрос");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError("Проверьте введённые данные");
  }

  const { name, phone } = parsed.data;

  try {
    await prisma.systemEvent.create({
      data: {
        level: "INFO",
        source: "waitlist",
        message: `Новая заявка в лист ожидания: ${name}, ${phone}`,
        metadata: { name, phone, module: "rental" },
      },
    });

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

    if (botToken && chatId) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🔔 <b>Лист ожидания — новая заявка</b>\n\n👤 ${name}\n📞 ${phone}`,
          parse_mode: "HTML",
        }),
      });
    }

    return apiResponse({ queued: true });
  } catch {
    return apiServerError();
  }
}
