import { z } from "zod";

export const sendMagicLinkSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(6, "Пароль минимум 6 символов").optional(),
});

export const verifyMagicLinkSchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
});

export type SendMagicLinkInput = z.infer<typeof sendMagicLinkSchema>;
export type VerifyMagicLinkInput = z.infer<typeof verifyMagicLinkSchema>;
