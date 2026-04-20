import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(6, "Пароль должен быть не менее 6 символов"),
  name: z.string().min(1, "Имя обязательно"),
  role: z.enum(["SUPERADMIN", "ADMIN", "MANAGER", "USER"]),
  phone: z.string().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const resetPasswordSchema = z.object({
  password: z.string().min(6, "Пароль должен быть не менее 6 символов"),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const updateUserSchema = z.object({
  role: z.enum(["SUPERADMIN", "ADMIN", "MANAGER", "USER"]).optional(),
  name: z.string().min(1, "Имя не может быть пустым").optional(),
  phone: z.string().optional(),
  telegramId: z.string().nullable().optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const listUsersSchema = z.object({
  search: z.string().max(200).optional(),
  role: z.enum(["team"]).optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ListUsersInput = z.infer<typeof listUsersSchema>;
