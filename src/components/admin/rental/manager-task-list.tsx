"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: "OPEN" | "RESOLVED" | "DEFERRED";
  type: string;
  paymentId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  resolutionNote: string | null;
  contract: {
    contractNumber: string | null;
    tenant: { companyName: string; contactName: string | null; phone: string | null; email: string | null };
    office: { number: string; building: number; floor: number };
  } | null;
  payment: {
    dueDate: string;
    amount: string;
    paidAt: string | null;
  } | null;
};

const STATUS_LABEL: Record<Task["status"], string> = {
  OPEN: "Открыта",
  RESOLVED: "Закрыта",
  DEFERRED: "Отложена",
};

const STATUS_VARIANT: Record<Task["status"], "warning" | "success" | "default"> = {
  OPEN: "warning",
  RESOLVED: "success",
  DEFERRED: "default",
};

export function ManagerTaskList({ tasks }: { tasks: Task[] }) {
  const [filter, setFilter] = useState<"ALL" | "OPEN" | "RESOLVED" | "DEFERRED">("OPEN");
  const filtered = tasks.filter((t) => (filter === "ALL" ? true : t.status === filter));

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["OPEN", "DEFERRED", "RESOLVED", "ALL"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-sm ${
              filter === f ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"
            }`}
          >
            {f === "ALL" ? "Все" : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((t) => (
          <TaskCard key={t.id} task={t} />
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-zinc-400 text-center py-8">Нет задач</p>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showResolve, setShowResolve] = useState(false);
  const [resolution, setResolution] = useState<
    "PAYMENT_RECEIVED" | "TENANT_DEFERRED" | "OTHER"
  >("PAYMENT_RECEIVED");
  const [note, setNote] = useState("");
  const [deferUntil, setDeferUntil] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submitResolve(markPaid: boolean) {
    setError(null);
    try {
      const res = await fetch(`/api/rental/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "RESOLVED",
          resolution,
          resolutionNote: note || undefined,
          markPaymentPaid: markPaid,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? "Ошибка");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось");
    }
  }

  async function submitDefer() {
    setError(null);
    if (!deferUntil) {
      setError("Выберите дату отсрочки");
      return;
    }
    try {
      const res = await fetch(`/api/rental/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "DEFERRED",
          deferUntil: new Date(deferUntil).toISOString(),
          resolutionNote: note || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message ?? "Ошибка");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось");
    }
  }

  const tenant = task.contract?.tenant;
  const office = task.contract?.office;

  return (
    <div className="rounded-lg border border-zinc-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[task.status]}>{STATUS_LABEL[task.status]}</Badge>
            <span className="text-xs text-zinc-500">
              {new Date(task.createdAt).toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <h3 className="font-medium text-zinc-900 mt-1">{task.title}</h3>
          {tenant && (
            <div className="text-sm text-zinc-600 mt-2 space-y-0.5">
              {tenant.contactName && (
                <p>Контакт: <span className="font-medium">{tenant.contactName}</span></p>
              )}
              {tenant.phone && (
                <p>
                  Телефон:{" "}
                  <a href={`tel:${tenant.phone}`} className="text-blue-600 hover:underline">
                    {tenant.phone}
                  </a>
                </p>
              )}
              {office && (
                <p>
                  Офис: К{office.building}·{office.number} (эт. {office.floor})
                </p>
              )}
              {task.payment && (
                <p>
                  Сумма: <b>{Number(task.payment.amount).toLocaleString("ru-RU")} ₽</b>, срок{" "}
                  {new Date(task.payment.dueDate).toLocaleDateString("ru-RU")}
                </p>
              )}
            </div>
          )}
        </div>
        {task.status === "OPEN" && !showResolve && (
          <div className="flex flex-col gap-2">
            <Button size="sm" onClick={() => setShowResolve(true)} disabled={pending}>
              Закрыть
            </Button>
          </div>
        )}
      </div>

      {task.status === "OPEN" && showResolve && (
        <div className="mt-4 border-t border-zinc-100 pt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-zinc-600">Решение</span>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as typeof resolution)}
                className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
              >
                <option value="PAYMENT_RECEIVED">Оплата получена</option>
                <option value="TENANT_DEFERRED">Договорились на другую дату</option>
                <option value="OTHER">Другое</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-zinc-600">Отсрочка до</span>
              <input
                type="datetime-local"
                value={deferUntil}
                onChange={(e) => setDeferUntil(e.target.value)}
                className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Комментарий (необязательно)"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowResolve(false)}
              disabled={pending}
            >
              Отмена
            </Button>
            <Button size="sm" variant="secondary" onClick={submitDefer} disabled={pending}>
              Отложить
            </Button>
            <Button
              size="sm"
              onClick={() => submitResolve(resolution === "PAYMENT_RECEIVED")}
              disabled={pending}
            >
              {resolution === "PAYMENT_RECEIVED"
                ? "Закрыть + отметить оплату"
                : "Закрыть"}
            </Button>
          </div>
        </div>
      )}

      {task.status !== "OPEN" && task.resolutionNote && (
        <p className="mt-3 text-sm text-zinc-500 italic">{task.resolutionNote}</p>
      )}
    </div>
  );
}
