import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Navbar } from "@landing/components/navbar";
import { Footer } from "@landing/components/footer";
import { buildBookingView, findBookingByToken } from "@/modules/booking/manage";
import { ManageBooking } from "@/components/public/manage-booking";

export const dynamic = "force-dynamic";

/**
 * Страница управления бронью по ссылке из письма.
 *
 * `noindex`: ссылка персональная, в поиске ей делать нечего.
 */
export const metadata: Metadata = {
  title: "Ваше бронирование",
  robots: { index: false, follow: false },
};

export default async function ManageBookingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const booking = await findBookingByToken(token);
  if (!booking) notFound();

  const view = await buildBookingView(booking);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Navbar />
      <main className="pt-20">
        <div className="mx-auto max-w-[640px] px-6 py-12">
          <ManageBooking token={token} initial={view} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
