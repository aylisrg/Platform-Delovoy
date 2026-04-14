import Link from "next/link";
import { prisma } from "@/lib/db";
import { AdminHeader } from "@/components/admin/header";
import { SuppliersList } from "@/components/admin/inventory/suppliers-list";
import type { SupplierSummary } from "@/modules/inventory/types";

export const dynamic = "force-dynamic";

const NAV_TABS = [
  { href: "/admin/inventory", label: "Остатки" },
  { href: "/admin/inventory/suppliers", label: "Поставщики" },
  { href: "/admin/inventory/receipts", label: "Приходы" },
  { href: "/admin/inventory/write-offs", label: "Списания" },
  { href: "/admin/inventory/expiring", label: "Истечение" },
  { href: "/admin/inventory/audits", label: "Инвентаризация" },
  { href: "/admin/inventory/movements", label: "Движения" },
  { href: "/admin/inventory/prices", label: "Цены" },
];

export default async function SuppliersPage() {
  const raw = await prisma.supplier.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  const suppliers: SupplierSummary[] = raw.map((s) => ({
    id: s.id,
    name: s.name,
    contactName: s.contactName,
    phone: s.phone,
    email: s.email,
    isActive: s.isActive,
    createdAt: s.createdAt,
  }));

  return (
    <>
      <AdminHeader
        title="Склад — Поставщики"
        actions={
          <Link
            href="/admin/inventory/receipts"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            + Приход товара
          </Link>
        }
      />

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 pb-0">
          {NAV_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab.href === "/admin/inventory/suppliers"
                  ? "text-blue-600 border-blue-600"
                  : "text-zinc-500 border-transparent hover:text-zinc-900 hover:border-zinc-300"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        <SuppliersList initialSuppliers={suppliers} />
      </div>
    </>
  );
}
