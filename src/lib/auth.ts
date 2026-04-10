import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import VK from "next-auth/providers/vk";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "./db";
import { authConfig } from "./auth.config";

// Custom Yandex OAuth provider
function YandexProvider() {
  return {
    id: "yandex",
    name: "Yandex",
    type: "oauth" as const,
    authorization: {
      url: "https://oauth.yandex.ru/authorize",
      params: { scope: "login:email login:info login:avatar" },
    },
    token: "https://oauth.yandex.ru/token",
    userinfo: "https://login.yandex.ru/info?format=json",
    profile(profile: {
      id: string;
      default_email?: string;
      display_name?: string;
      real_name?: string;
      default_avatar_id?: string;
      is_avatar_empty?: boolean;
    }) {
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
    async jwt({ token, user, trigger }) {
      // Call the base jwt callback first
      const result = authConfig.callbacks?.jwt
        ? await authConfig.callbacks.jwt({ token, user, trigger } as never)
        : token;

      if (!result) return token;

      // On login or session update, fetch admin sections from DB
      if ((user || trigger === "update") && result.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: result.id as string },
          select: { role: true },
        });

        if (dbUser && dbUser.role === "SUPERADMIN") {
          result.adminSections = [
            "dashboard", "gazebos", "ps-park", "cafe",
            "rental", "modules", "users", "clients", "telegram", "monitoring", "architect",
          ];
        } else if (dbUser && dbUser.role === "MANAGER") {
          const permissions = await prisma.adminPermission.findMany({
            where: { userId: result.id as string },
            select: { section: true },
          });
          result.adminSections = permissions.map((p) => p.section);
        } else {
          result.adminSections = [];
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

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
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

    // WhatsApp OTP (verified via /api/auth/whatsapp/verify, then signed in here)
    Credentials({
      id: "whatsapp",
      name: "WhatsApp",
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
      allowDangerousEmailAccountLinking: true,
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
