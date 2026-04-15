import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PSParkBookingHistoryTable } from "@/components/admin/ps-park/ps-park-booking-history-table";

export const dynamic = "force-dynamic";

export default function PSParkBookingsPage() {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-zinc-900">История бронирований</h2>
        <p className="text-xs text-zinc-400 mt-1">
          Все бронирования с фильтрами по статусу и дате
        </p>
      </CardHeader>
      <CardContent>
        <PSParkBookingHistoryTable />
      </CardContent>
    </Card>
  );
}
