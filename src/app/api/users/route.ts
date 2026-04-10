import { auth } from "@/lib/auth";
import { apiResponse, apiError, apiForbidden, apiUnauthorized, apiValidationError } from "@/lib/api-response";
import { createUserSchema } from "@/modules/users/validation";
import { createUser, listUsers } from "@/modules/users/service";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || undefined;
    const users = await listUsers(search);
    return apiResponse(users);
  } catch {
    return apiError("INTERNAL_ERROR", "Ошибка загрузки пользователей", 500);
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  try {
    const body = await request.json();
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join(", ");
      return apiValidationError(message);
    }

    const user = await createUser(parsed.data);
    return apiResponse(user, undefined, 201);
  } catch (error) {
    if (error instanceof Error && error.message === "USER_EXISTS") {
      return apiError("USER_EXISTS", "Пользователь с таким email уже существует", 409);
    }
    return apiError("INTERNAL_ERROR", "Ошибка создания пользователя", 500);
  }
}
