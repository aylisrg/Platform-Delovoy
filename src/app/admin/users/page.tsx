import { Suspense } from "react";
import { AdminHeader } from "@/components/admin/header";
import { UnifiedUsersPage } from "@/components/admin/users/unified-users-page";

export const dynamic = "force-dynamic";

export default function UsersPage() {
  return (
    <>
      <AdminHeader title="Пользователи" />
      <div className="p-8">
        <Suspense fallback={<div className="text-sm text-zinc-400">Загрузка...</div>}>
          <UnifiedUsersPage />
        </Suspense>
      </div>
    </>
  );
}
