import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { SubscriptionsList } from "@/components/admin/subscriptions/subscriptions-list";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");
  if (!hasRole(session.user, "MANAGER")) redirect("/admin/forbidden");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Абонементы</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Предоплаченные пакеты часов на гостя. F6 (MVP — только PS Park).
        </p>
      </div>
      <SubscriptionsList />
    </div>
  );
}
