// Green API (green-api.com) — WhatsApp messaging service

const GREENAPI_URL = process.env.GREENAPI_URL || "https://api.green-api.com";
const GREENAPI_ID = process.env.GREENAPI_INSTANCE_ID || "";
const GREENAPI_TOKEN = process.env.GREENAPI_TOKEN || "";

export function isGreenApiConfigured(): boolean {
  return !!GREENAPI_ID && !!GREENAPI_TOKEN;
}

/**
 * Normalize phone to WhatsApp chatId format: 79991234567@c.us
 */
function toChatId(phone: string): string {
  // Strip everything except digits
  const digits = phone.replace(/\D/g, "");
  // Handle 8-prefix Russian numbers → convert to 7
  const normalized = digits.startsWith("8") && digits.length === 11
    ? "7" + digits.slice(1)
    : digits;
  return `${normalized}@c.us`;
}

/**
 * Send a text message via Green API WhatsApp
 */
export async function sendWhatsAppMessage(
  phone: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isGreenApiConfigured()) {
    return { success: false, error: "Green API not configured" };
  }

  const url = `${GREENAPI_URL}/waInstance${GREENAPI_ID}/sendMessage/${GREENAPI_TOKEN}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: toChatId(phone),
        message,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Green API error: ${res.status} ${text}` };
    }

    const data = await res.json();
    return { success: true, messageId: data.idMessage };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
