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
  // Подтверждение для сидированного суперадмина при понижении/исключении (AC-A1.7).
  confirmSeeded: z.boolean().optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** Path param `[id]` / `[userId]` of the users and permissions routes. */
export const userIdParamSchema = z.string().min(1).max(64);

/** POST /api/users/[id]/exclude (ADR 2026-10-25 §6.2). */
export const excludeUserSchema = z
  .object({ confirmSeeded: z.boolean().optional() })
  .strict();

export type ExcludeUserInput = z.infer<typeof excludeUserSchema>;

/** PUT /api/admin/permissions/[userId] (ADR 2026-10-25 §6.2). */
export const permissionsUpdateSchema = z.object({
  sections: z.array(z.string().max(50)).max(50),
});

export type PermissionsUpdateInput = z.infer<typeof permissionsUpdateSchema>;

export const listUsersSchema = z.object({
  search: z.string().max(200).optional(),
  role: z.enum(["team"]).optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ListUsersInput = z.infer<typeof listUsersSchema>;
