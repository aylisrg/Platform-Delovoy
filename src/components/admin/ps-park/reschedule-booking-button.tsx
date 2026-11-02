"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

export function RescheduleBookingButton({ bookingId, onChanged }: { bookingId: string; onChanged?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [expectedStartTime, setExpectedStartTime] = useState("");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function show() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/ps-park/bookings/${bookingId}`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error?.message ?? "Не удалось загрузить бронь");
      setExpectedStartTime(body.data.startTime);
      setDate(body.data.date.slice(0, 10)); setTime(formatTime(body.data.startTime));
      setDuration(Math.round((new Date(body.data.endTime).getTime() - new Date(body.data.startTime).getTime()) / 60_000));
      setOpen(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Ошибка загрузки"); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || busy) return;
    submitting.current = true;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/ps-park/bookings/${bookingId}/reschedule`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, startTime: time, expectedStartTime }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error?.message ?? "Перенос не выполнен");
      setOpen(false); router.refresh(); onChanged?.();
    } catch (error) { setError(error instanceof Error ? error.message : "Перенос не выполнен"); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <div>
    <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={show}>Перенести</Button>
    {open && <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2 rounded border p-3 bg-white">
      <p className="basis-full text-sm">Оплаченные {duration} мин и тариф сохраняются. Доплата не требуется. Согласуйте новое время с гостем.</p>
      <label className="text-sm">Новая дата<input aria-label="Новая дата" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="block border rounded p-1" /></label>
      <label className="text-sm">Новое время<input aria-label="Новое время" type="time" required value={time} onChange={(e) => setTime(e.target.value)} className="block border rounded p-1" /></label>
      <Button type="submit" size="sm" disabled={busy}>Подтвердить перенос</Button>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Закрыть</Button>
    </form>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </div>;
}
