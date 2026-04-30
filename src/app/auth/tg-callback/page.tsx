/**
 * GET /auth/tg-callback?token=<token>
 *
 * Server component that lands the user from the Telegram bot's
 * "🌐 Open site" button into an active NextAuth session (ADR
 * 2026-04-30 §3.2).
 *
 * Behaviour matrix:
 *   - missing/invalid/expired token → render error UI with CTA back to bot
 *   - already CONSUMED token        → render error UI ("link already used")
 *   - PENDING + no current session  → consume + mint JWT + auto signIn (client)
 *   - PENDING + same userId session → consume + redirect to /profile
 *   - PENDING + different userId    → render confirm UI ("you're already X,
 *                                       sign in as Y?") — no silent re-login
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { logAuthEvent } from "@/lib/audit";
import {
  consumeBotLoginToken,
  mintOneTimeJwt,
  readBotLoginToken,
} from "@/modules/auth/telegram-deep-link";
import { CallbackClient } from "./CallbackClient";

type SearchParams = Promise<{ token?: string | string[] }>;

const TOKEN_MAX_LEN = 64;

function ErrorCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-neutral-950 text-neutral-100">
      <div className="max-w-md w-full rounded-2xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl">
        <h1 className="text-xl font-semibold mb-3">{title}</h1>
        <p className="text-neutral-400 text-sm leading-relaxed mb-6">
          {description}
        </p>
        <div className="flex flex-col gap-3">
          <Link
            href="/auth/signin"
            className="block text-center rounded-xl bg-neutral-100 text-neutral-900 px-4 py-2.5 text-sm font-medium hover:bg-white transition"
          >
            Войти заново
          </Link>
          <p className="text-center text-xs text-neutral-500">
            Или вернитесь в Telegram-бот и нажмите кнопку ещё раз
          </p>
        </div>
      </div>
    </main>
  );
}

export default async function TgCallbackPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const rawToken = params.token;
  const token =
    typeof rawToken === "string" && rawToken.length > 0 && rawToken.length <= TOKEN_MAX_LEN
      ? rawToken
      : null;

  if (!token) {
    return (
      <ErrorCard
        title="Некорректная ссылка"
        description="Ссылка для входа повреждена или неполная. Откройте Telegram-бот и нажмите «🌐 Открыть сайт» ещё раз."
      />
    );
  }

  // First, peek at the token without consuming. We need its userId to
  // detect a session conflict before we burn the one-time entry.
  const entry = await readBotLoginToken(token);
  if (!entry) {
    return (
      <ErrorCard
        title="Срок ссылки истёк"
        description="Эта ссылка для входа больше недействительна. Откройте Telegram-бот и нажмите «🌐 Открыть сайт» ещё раз — мы выдадим новую."
      />
    );
  }
  if (entry.status !== "PENDING") {
    return (
      <ErrorCard
        title="Ссылка уже использована"
        description="Этот одноразовый код уже сработал. Если вы не входили — откройте бот и нажмите «🌐 Открыть сайт» ещё раз."
      />
    );
  }

  const session = await auth();
  const currentUserId =
    typeof session?.user?.id === "string" ? session.user.id : null;

  // Session conflict — DO NOT consume here. Hand control to the
  // confirmation UI; the user explicitly chooses to switch (which
  // signs out + signs in via the same token) or to keep the current
  // session (which consumes the token and redirects without re-login).
  if (currentUserId && currentUserId !== entry.userId) {
    return (
      <CallbackClient
        mode="conflict"
        token={token}
        currentDisplayName={
          session?.user?.name ?? session?.user?.email ?? "текущий аккаунт"
        }
      />
    );
  }

  // Same user already signed in — just consume the token (one-shot
  // contract) and redirect. No need to mint a JWT or re-signIn.
  if (currentUserId && currentUserId === entry.userId) {
    const result = await consumeBotLoginToken(token);
    if (result.ok) {
      await logAuthEvent("auth.signin.success", entry.userId, {
        provider: "telegram-token",
        method: "bot-deeplink",
        reason: "already_signed_in",
      });
    }
    redirect("/profile");
  }

  // Anonymous → consume + mint JWT + hand to client for signIn.
  const consume = await consumeBotLoginToken(token);
  if (!consume.ok) {
    return (
      <ErrorCard
        title="Ссылка уже использована"
        description="Этот одноразовый код только что сработал в другой вкладке. Если вы не входили — откройте бот и нажмите «🌐 Открыть сайт» ещё раз."
      />
    );
  }

  const jwt = await mintOneTimeJwt(consume.userId);
  if (!jwt) {
    // NEXTAUTH_SECRET missing — surface as error, the consumed entry
    // will time out naturally (CONSUMED_TTL=60s).
    return (
      <ErrorCard
        title="Сервер не настроен"
        description="Не удалось завершить вход. Попробуйте позже или сообщите администратору."
      />
    );
  }

  return <CallbackClient mode="signin" token={token} oneTimeCode={jwt} />;
}
