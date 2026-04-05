import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(6, "Пароль должен быть не менее 6 символов"),
  name: z.string().min(1, "Имя обязательно"),
  role: z.enum(["SUPERADMIN", "MANAGER", "USER"]),
  phone: z.string().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
