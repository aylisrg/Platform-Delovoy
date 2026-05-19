import { z } from "zod";

export const chatKindSchema = z.enum([
  "SUPPORT",
  "DIRECT",
  "GROUP",
  "TOPIC_BOOKINGS",
  "TOPIC_CONTRACTS",
]);

export const messageBodySchema = z.string().trim().min(1).max(4000);

export const createChatSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("SUPPORT"),
  }),
  z.object({
    kind: z.literal("TOPIC_BOOKINGS"),
  }),
  z.object({
    kind: z.literal("TOPIC_CONTRACTS"),
  }),
  z.object({
    kind: z.literal("DIRECT"),
    otherUserId: z.string().cuid(),
  }),
  z.object({
    kind: z.literal("GROUP"),
    title: z.string().trim().min(1).max(120),
    participantUserIds: z.array(z.string().cuid()).min(1).max(49),
  }),
]);

export const sendMessageSchema = z.object({
  body: messageBodySchema,
  clientId: z.string().max(64).optional(),
});

export const editMessageSchema = z.object({
  body: messageBodySchema,
});

export const markReadSchema = z.object({
  upToMessageId: z.string().cuid(),
});

export const addParticipantSchema = z.object({
  userId: z.string().cuid(),
  role: z.enum(["MEMBER", "ADMIN"]).optional().default("MEMBER"),
});

export const listChatsQuerySchema = z.object({
  cursor: z.string().optional(),
  search: z.string().trim().max(100).optional(),
  kind: chatKindSchema.optional(),
  hasUnread: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export const listAdminChatsQuerySchema = z.object({
  cursor: z.string().optional(),
  search: z.string().trim().max(100).optional(),
  kind: chatKindSchema.optional(),
  hasUnread: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  userId: z.string().cuid().optional(),
});

export const listMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const eligibilitySchema = z.object({
  otherUserId: z.string().cuid(),
});

export const userSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});
