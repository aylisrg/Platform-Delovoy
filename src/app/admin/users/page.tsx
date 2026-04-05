import { AdminHeader } from "@/components/admin/header";
import { UsersList } from "@/components/admin/users/users-list";

export const dynamic = "force-dynamic";

export default function UsersPage() {
  return (
    <>
      <AdminHeader title="Пользователи" />
      <div className="p-8">
        <UsersList />
      </div>
    </>
  );
}
