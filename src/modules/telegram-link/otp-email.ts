/**
 * Emails of the Telegram self-link (PRD 2026-10-25 US-E3, ADR §5.3/§Q9).
 * Pure templates: no I/O, the code is never logged by anyone.
 */

export type LinkEmail = { subject: string; html: string; text: string };

const SIGNATURE = "Деловой Парк";

function layout(paragraphs: string[]): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join("");
  return `<!doctype html><html lang="ru"><body style="font-family:Arial,sans-serif;font-size:15px;color:#18181b">${body}<p style="margin:16px 0 0;color:#71717a">${SIGNATURE}</p></body></html>`;
}

/** One-time code email (AC-E3.1): the code, «действует 10 минут», «если это были не вы». */
export function buildLinkOtpEmail(code: string): LinkEmail {
  if (!/^\d{6}$/.test(code)) throw new Error("OTP code must be 6 digits");
  return {
    subject: "Код для привязки Telegram — Деловой",
    html: layout([
      "Вы запросили привязку Telegram к своему аккаунту на платформе «Деловой».",
      `Ваш код: <b style="font-size:22px;letter-spacing:4px">${code}</b>`,
      "Код действует 10 минут. Никому его не сообщайте.",
      "Если это были не вы — проигнорируйте письмо.",
    ]),
    text: [
      "Вы запросили привязку Telegram к своему аккаунту на платформе «Деловой».",
      `Ваш код: ${code}`,
      "Код действует 10 минут. Никому его не сообщайте.",
      "Если это были не вы — проигнорируйте письмо.",
      SIGNATURE,
    ].join("\n\n"),
  };
}

/**
 * Info email instead of a code for a SUPERADMIN account (ADR §Q9, AC-E3.7):
 * the requester gets the generic answer, the owner of the address learns how
 * linking works for this account.
 */
export function buildSuperadminLinkInfoEmail(): LinkEmail {
  const lines = [
    "Кто-то запросил привязку Telegram к вашему аккаунту через Mini App «Деловой».",
    "Для этого аккаунта привязку выполняет суперадмин, поэтому код по почте не отправляется.",
    "Привязку Telegram к этому аккаунту выполняет суперадмин: войдите на сайт и используйте «Привязать Telegram» в профиле.",
    "Если это были не вы — проигнорируйте письмо.",
  ];
  return {
    subject: "Привязка Telegram к аккаунту",
    html: layout(lines),
    text: [...lines, SIGNATURE].join("\n\n"),
  };
}
