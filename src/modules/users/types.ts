import type { Role } from "@prisma/client";

export interface UserListItem {
  id: string;
  email: string | null;
  name: string | null;
  role: Role;
  phone: string | null;
  createdAt: Date;
}
