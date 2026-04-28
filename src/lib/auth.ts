import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import VK from "next-auth/providers/vk";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "./db";
import { authConfig } from "./auth.config";
import { ADMIN_SECTION_SLUGS } from "./permissions";
import { authorizeMagicLinkNonce } from "@/modules/auth/magic-link-authorize";

// Telegram login data verification (used by legacy Login Widget Credentials
// provider — kept as 30-day fallback per ADR §10. New deep-link flow lives
// in src/modules/auth/telegram-deep-link.* and is delivered in Wave 2.)
function verifyTelegramAuth(data: Record<string, string>): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  const { hash, ...rest } = data;
  if (!hash) return false;

  // Check auth_date is not too old (1 hour)
  const authDate = parseInt(rest.auth_date || "0", 10);
  if (Date.now() / 1000 - authDate > 3600) return false;

  const checkString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");

  const secretKey = crypto
    .createHash("sha256")
    .update(botToken)
    .digest();

  const hmac = crypto
    .createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  return hmac === hash;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma) as never,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      // NOTE: Yandex/Google OAuth providers were removed in Wave 1 of the
      // auth refactor (ADR 2026-04-27, §8). New flows (Telegram deep-link,
      // VK ID) come in Waves 2-3. Pre-existing Account rows with provider
      // = "yandex"/"google" are intentionally NOT deleted — those users
      // will simply re-login via Telegram/email and auto-merge will pick
      // them up.
      if (authConfig.callbacks?.signIn) {
        return (authConfig.callbacks.signIn as (args: unknown) => Promise<boolean | string>)({ user, account, profile });
      }
      return true;
    },
    async jwt({ token, user, trigger }) {
      // Call the base jwt callback first
      const result = authConfig.callbacks?.jwt
        ? await authConfig.callbacks.jwt({ token, user, trigger } as never)
        : token;

      if (!result) return token;

      // On login or session update, fetch admin sections from DB
      if ((user || trigger === "update") && result.id) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: result.id as string },
            select: { role: true },
          });

          if (dbUser && dbUser.role === "SUPERADMIN") {
            result.adminSections = [...ADMIN_SECTION_SLUGS];
          } else if (dbUser && (dbUser.role === "ADMIN" || dbUser.role === "MANAGER")) {
            const permissions = await prisma.adminPermission.findMany({
              where: { userId: result.id as string },
              select: { section: true },
            });
            result.adminSections = permissions.map((p) => p.section);
          } else {
            result.adminSections = [];
          }
        } catch (err) {
          // DB error must not block login — return token with empty sections,
          // user will be redirected to /admin/forbidden and can retry
          console.error("[Auth] JWT callback DB error:", err);
          result.adminSections = result.adminSections ?? [];
        }
      }

      return result;
    },
  },
  providers: [
    // Email + Password
    Credentials({
      id: "credentials",
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const normalizedEmail = (credentials.email as string).toLowerCase().trim();

        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (!user || !user.passwordHash) return null;

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!isValid) return null;

        return user;
      },
    }),

    // Telegram Login Widget — DEPRECATED, scheduled for removal 30 days
    // after the new Telegram bot deep-link flow ships (Wave 2). Kept here
    // so existing front-ends / cached HTML keep working during the
    // transition. Do NOT add new entry points to this provider.
    // See: docs/adr/2026-04-27-auth-refactor-and-crm-v1.md §10
    Credentials({
      id: "telegram",
      name: "Telegram",
      credentials: {
        id: { type: "text" },
        first_name: { type: "text" },
        last_name: { type: "text" },
        username: { type: "text" },
        photo_url: { type: "text" },
        auth_date: { type: "text" },
        hash: { type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.id || !credentials?.hash) return null;

        const data: Record<string, string> = {};
        for (const [key, value] of Object.entries(credentials)) {
          if (value) data[key] = value as string;
        }

        if (!verifyTelegramAuth(data)) return null;

        const telegramId = credentials.id as string;
        const firstName = (credentials.first_name as string) || "";
        const lastName = (credentials.last_name as string) || "";
        const name = [firstName, lastName].filter(Boolean).join(" ") || (credentials.username as string) || "Telegram User";
        const image = (credentials.photo_url as string) || undefined;

        // Find or create user by telegramId
        let user = await prisma.user.findUnique({
          where: { telegramId },
        });

        if (!user) {
          user = await prisma.user.create({
            data: {
              telegramId,
              name,
              image: image || null,
              role: "USER",
            },
          });
        } else if (user.name !== name || (image && user.image !== image)) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              name,
              ...(image ? { image } : {}),
            },
          });
        }

        return user;
      },
    }),

    // Magic Link Email — sign in via one-time nonce stored in Redis by
    // /api/auth/verify-email. The nonce is the only proof that the user
    // actually clicked the email link; bare userId is no longer accepted.
    Credentials({
      id: "magic-link",
      name: "Magic Link",
      credentials: {
        nonce: { type: "text" },
      },
      authorize: authorizeMagicLinkNonce,
    }),

    // VK (Max) OAuth — Wave 3 will replace with custom VK ID v2 provider
    // (ADR §2). For now, keep the stock provider so any pre-existing VK
    // sessions keep working.
    VK({
      clientId: process.env.VK_CLIENT_ID,
      clientSecret: process.env.VK_CLIENT_SECRET,
    }),
  ],
});
