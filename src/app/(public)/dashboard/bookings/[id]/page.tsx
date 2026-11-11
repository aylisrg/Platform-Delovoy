import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPublicContact } from "@/lib/public-contacts";
import { DashboardShell } from "@/components/public/dashboard/shell";
import { DashboardTracking } from "@/components/public/dashboard/tracking";
import { ManageBooking } from "@/components/public/manage-booking";
import { PSBooking } from "@/components/public/dashboard/ps-booking";
import { getOwnBooking } from "@/modules/profile/booking-service";
import { BookingManageError } from "@/modules/booking/manage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Моё бронирование",
  robots: { index: false, follow: false },
};
const labels = {
  PENDING: "Ожидает подтверждения",
  CONFIRMED: "Подтверждено",
  CHECKED_IN: "Идёт сеанс",
  COMPLETED: "Завершено",
  CANCELLED: "Отменено",
  NO_SHOW: "Визит не состоялся",
};

export default async function OwnBookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id)
    redirect(
      `/auth/signin?callbackUrl=${encodeURIComponent(`/dashboard/bookings/${id}`)}`,
    );
  const identity = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true },
  });
  let data;
  try {
    data = await getOwnBooking(session.user.id, id);
  } catch (error) {
    if (error instanceof BookingManageError && error.status === 404) notFound();
    throw error;
  }
  const { view, payment } = data;
  const contact = getPublicContact(data.moduleSlug);
  return (
    <DashboardShell
      name={identity?.name ?? null}
      role={session.user.role}
      section="bookings"
    >
      <DashboardTracking section="bookings" detail />
      <Link
        href="/dashboard?section=bookings"
        className="mb-6 inline-block py-2 text-sm font-medium text-blue-700"
      >
        ← Мои бронирования
      </Link>
      <div className="max-w-2xl space-y-6">
        {data.moduleSlug === "gazebos" ? (
          <ManageBooking
            initial={view}
            endpoint={`/api/profile/bookings/${id}`}
            canCancel={data.canCancel}
            allowPaymentRetry={data.canPay}
          />
        ) : (
          <PSBooking
            id={id}
            date={view.date}
            start={view.startTime}
            end={view.endTime}
            resource={view.resourceName}
            status={labels[view.status]}
            total={payment.totalDue}
            paid={payment.paid}
            canCancel={data.canCancel}
            paymentUrl={view.paymentUrl}
          />
        )}
        <aside className="rounded-2xl bg-zinc-100 p-5">
          <h2 className="font-semibold">Помощь с бронированием</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600">
            {data.moduleSlug === "ps-park"
              ? "Для переноса оплаченного времени и вопросов по оплате свяжитесь с администратором Плей Парка."
              : "Если нужна помощь с оплатой или переносом, позвоните нам."}
          </p>
          <a
            href={`tel:${contact.phone}`}
            className="mt-2 inline-block min-h-11 py-3 text-sm font-medium text-blue-700"
          >
            {contact.displayPhone}
          </a>
        </aside>
      </div>
    </DashboardShell>
  );
}
