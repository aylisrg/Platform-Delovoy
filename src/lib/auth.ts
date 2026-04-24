import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import VK from "next-auth/providers/vk";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "./db";
import { authConfig } from "./auth.config";
import { ADMIN_SECTION_SLUGS } from "./permissions";

/** Full shape of the Yandex Passport API response (login.yandex.ru/info) */
export type YandexProfile = {
  id: string;
  login?: string;
  display_name?: string;
  real_name?: string;
  first_name?: string;
  last_name?: string;
  sex?: "male" | "female";
  birthday?: string;           // "YYYY-MM-DD" or "0000-DD-MM" when year unknown
  default_email?: string;
  default_avatar_id?: string;
  is_avatar_empty?: boolean;
  default_phone?: {
    id: number;
    number: string;            // E.164 format, e.g. "+79001234567"
  };
};

// Custom Yandex OAuth provider
function YandexProvider() {
  return {
    id: "yandex",
    name: "Yandex",
    type: "oauth" as const,
    authorization: {
      url: "https://oauth.yandex.ru/authorize",
      // login:info covers: name, sex, birthday, avatar, default_phone
      // login:email covers: email addresses
      params: { scope: "login:email login:info login:avatar" },
    },
    token: "https://oauth.yandex.ru/token",
    userinfo: "https://login.yandex.ru/info?format=json",
    checks: ["state"],
    profile(profile: YandexProfile) {
      return {
        id: profile.id,
        email: profile.default_email,
        name: profile.real_name || profile.display_name,
        image: profile.is_avatar_empty
          ? undefined
          : `https://avatars.yandex.net/get-yapic/${profile.default_avatar_id}/islands-200`,
      };
    },
    clientId: process.env.YANDEX_CLIENT_ID,
    clientSecret: process.env.YANDEX_CLIENT_SECRET,
  };
}

// Telegram login data verification
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
      // ── Yandex OAuth: account linking + save extra profile fields ──────────
      if (account?.provider === "yandex" && user.email) {
        const yandexProfile = profile as YandexProfile | undefined;

        // Build update payload from Yandex profile fields
        const extra: {
          phone?: string;
          birthday?: Date;
          gender?: string;
        } = {};

        // Phone — only set if field is empty (don't overwrite manually entered phone)
        const rawPhone = yandexProfile?.default_phone?.number;
        if (rawPhone) extra.phone = rawPhone;

        // Birthday — Yandex sends "YYYY-MM-DD"; skip if year is "0000" (unknown year)
        const rawBirthday = yandexProfile?.birthday;
        if (rawBirthday && !rawBirthday.startsWith("0000")) {
          const parsed = new Date(rawBirthday);
          if (!isNaN(parsed.getTime())) extra.birthday = parsed;
        }

        // Gender — "male" | "female"
        if (yandexProfile?.sex) extra.gender = yandexProfile.sex;

        // Upsert extra fields — don't overwrite phone if user already has one
        if (Object.keys(extra).length > 0) {
          try {
            // Find user (may not exist yet on first sign-in — adapter creates it after signIn returns)
            const existing = await prisma.user.findUnique({
              where: { email: user.email },
              select: { id: true, phone: true },
            });

            if (existing) {
              // User already exists — update, but don't overwrite an existing phone
              await prisma.user.update({
                where: { id: existing.id },
                data: {
                  ...(extra.phone && !existing.phone ? { phone: extra.phone } : {}),
                  ...(extra.birthday ? { birthday: extra.birthday } : {}),
                  ...(extra.gender ? { gender: extra.gender } : {}),
                },
              });
            } else {
              // New user — PrismaAdapter will create them after signIn returns true.
              // We'll update on the next jwt callback when the id is available.
              // Store in user object so jwt callback can pick it up.
              (user as unknown as Record<string, unknown>)._yandexExtra = extra;
            }
          } catch (err) {
            // Never block sign-in due to profile enrichment failure
            console.error("[Auth] Yandex profile enrichment failed:", err);
          }
        }
      }

      // Call base signIn callback if defined, otherwise allow
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

      // On first login: save Yandex extra fields for new users
      // (signIn callback couldn't update because the user didn't exist yet)
      if (user && result.id) {
        const yandexExtra = (user as unknown as Record<string, unknown>)._yandexExtra as
          | { phone?: string; birthday?: Date; gender?: string }
          | undefined;

        if (yandexExtra && Object.keys(yandexExtra).length > 0) {
          try {
            const dbUser = await prisma.user.findUnique({
              where: { id: result.id as string },
              select: { phone: true },
            });
            await prisma.user.update({
              where: { id: result.id as string },
              data: {
                ...(yandexExtra.phone && !dbUser?.phone ? { phone: yandexExtra.phone } : {}),
                ...(yandexExtra.birthday ? { birthday: yandexExtra.birthday } : {}),
                ...(yandexExtra.gender ? { gender: yandexExtra.gender } : {}),
              },
            });
          } catch (err) {
            console.error("[Auth] Yandex extra fields save failed (new user):", err);
          }
        }
      }

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

    // Telegram Login Widget
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

    // Magic Link Email (token verified via GET /api/auth/verify-email, then signed in here)
    Credentials({
      id: "magic-link",
      name: "Magic Link",
      credentials: {
        userId: { type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.userId) return null;

        const user = await prisma.user.findUnique({
          where: { id: credentials.userId as string },
        });

        return user;
      },
    }),

    // Google OAuth
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),

    // Yandex OAuth
    YandexProvider() as never,

    // VK (Max) OAuth
    VK({
      clientId: process.env.VK_CLIENT_ID,
      clientSecret: process.env.VK_CLIENT_SECRET,
    }),
  ],
});
