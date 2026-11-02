// Browser QA fixture only. Production components, synthetic availability/API.
import { createRoot } from "react-dom/client";
import Link from "next/link";
import { DarkAvailabilityGrid } from "../../src/components/public/ps-park/dark-availability-grid";
import PaymentWaitPage from "../../src/app/payments/[id]/page";
import type { DayAvailability } from "../../src/modules/ps-park/types";
import { RescheduleBookingButton } from "../../src/components/admin/ps-park/reschedule-booking-button";

const availability: DayAvailability[] = [{
  date: "2030-01-10",
  resource: { id: "qa-table", name: "QA стол", capacity: 4, pricePerHour: null, description: null, isActive: true, metadata: null },
  slots: [{ startTime: "10:00", endTime: "11:00", isAvailable: true }],
}];

createRoot(document.getElementById("root")!).render(
  location.pathname === "/qa-manager" ? <RescheduleBookingButton bookingId="qa-booking" /> :
  location.pathname.startsWith("/payments/") ? <PaymentWaitPage /> :
  location.pathname === "/qa-provider" ? <main>
    <h1>Тестовая форма провайдера</h1>
    <Link href="/payments/qa-payment">Вернуться на сайт</Link>
  </main> : <DarkAvailabilityGrid
    initialAvailability={availability} initialDate="2030-01-10"
    offer={location.search.includes("disabled") ? null : { slug: "qa-fixture-only" }}
  />
);
