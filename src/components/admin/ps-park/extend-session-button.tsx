"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "@/components/ui/toast";

type Props = {
  bookingId: string;
  onExtended: () => void;
};

export function ExtendSessionButton({ bookingId, onExtended }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
    visible: boolean;
  }>({ message: "", type: "success", visible: false });

  async function handleExtend() {
    setLoading(true);
    try {
      const res = await fetch(`/api/ps-park/bookings/${bookingId}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (data.success) {
        setToast({ message: "Сессия продлена на 1 час", type: "success", visible: true });
        onExtended();
        router.refresh();
      } else {
        setToast({
          message: data.error?.message ?? "Не удалось продлить",
          type: "error",
          visible: true,
        });
      }
    } catch {
      setToast({ message: "Ошибка при продлении", type: "error", visible: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.visible}
        onClose={() => setToast((t) => ({ ...t, visible: false }))}
      />
      <button
        onClick={handleExtend}
        disabled={loading}
        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
      >
        {loading ? "..." : "+1 ч."}
      </button>
    </>
  );
}
