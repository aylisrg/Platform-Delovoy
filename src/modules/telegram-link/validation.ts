import { z } from "zod";

export const linkRequestSchema = z.object({
  type: z.enum(["email", "phone"]),
  value: z.string().min(1).max(255),
});

export const linkConfirmSchema = z.object({
  code: z
    .string()
    .length(6)
    .regex(/^\d{6}$/, "Код должен состоять из 6 цифр"),
});

export const deepLinkSchema = z.object({
  token: z.string().min(20).max(100),
  telegramId: z.string().min(1).max(20),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  username: z.string().optional(),
});

export const linkSkipSchema = z.object({}).strict();

export type LinkRequestInput = z.infer<typeof linkRequestSchema>;
export type LinkConfirmInput = z.infer<typeof linkConfirmSchema>;
export type DeepLinkInput = z.infer<typeof deepLinkSchema>;
