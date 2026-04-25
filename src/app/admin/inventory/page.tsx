import Link from "next/link";
import { prisma } from "@/lib/db";
import { AdminHeader } from "@/components/admin/header";
import { SkuMergeDialog } from "@/components/admin/inventory/sku-merge-dialog";

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

function stockLevel(qty: number, threshold: number): "ok" | "low" | "out" {
  if (qty === 0) return "out";
  if (qty <= threshold) return "low";
  return "ok";
}

const stockColors = {
  ok: "text-green-700 bg-green-50",
  low: "text-amber-700 bg-amber-50",
  out: "text-red-700 bg-red-50",
};

const stockLabels = {
  ok: "В наличии",
  low: "Мало",
  out: "Нет",
};

export default async function InventoryPage() {
  // Source of truth for stock = SUM(StockBatch.remainingQty) per SKU.
  // The denormalized InventorySku.stockQuantity has been observed to drift
  // (manual DB ops, half-applied transactions); reading from batches removes
  // the drift class entirely. Cost is one extra groupBy per page load.
  const [skusRaw, batchSums] = await Promise.all([
    prisma.inventorySku.findMany({
      orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }],
    }),
    prisma.stockBatch.groupBy({
      by: ["skuId"],
      _sum: { remainingQty: true },
      where: { isExhausted: false },
    }),
  ]);
  const stockBySku = new Map(batchSums.map((b) => [b.skuId, b._sum.remainingQty ?? 0]));
  const skus = skusRaw.map((s) => ({ ...s, stockQuantity: stockBySku.get(s.id) ?? 0 }));

  const activeSkus = skus.filter((s) => s.isActive);
  const lowStockCount = activeSkus.filter(
    (s) => s.stockQuantity <= s.lowStockThreshold
  ).length;
  const outOfStockCount = activeSkus.filter((s) => s.stockQuantity === 0).length;
  const totalStockValue = activeSkus.reduce(
    (sum, s) => sum + Number(s.price) * s.stockQuantity,
    0
  );

  const categories = [...new Set(skus.map((s) => s.category))].sort();

  // Detect duplicate SKU names among active SKUs (case-insensitive, whitespace-normalized)
  const nameGroups = new Map<string, typeof skus>();
  for (const sku of activeSkus) {
    const key = sku.name.toLowerCase().trim().replace(/\s+/g, " ");
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key)!.push(sku);
  }
  const duplicateGroups = [...nameGroups.values()].filter((g) => g.length > 1);

  return (
    <>
      <AdminHeader
        title="Склад"
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
        {/* Tab navigation */}
        <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 pb-0">
          {NAV_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="whitespace-nowrap px-4 py-2.5 text-sm font-medium text-zinc-500 border-b-2 border-transparent hover:text-zinc-900 hover:border-zinc-300 transition-colors -mb-px data-[active]:text-blue-600 data-[active]:border-blue-600"
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        <div>
          <p className="text-sm text-zinc-500">
            Товары в наличии, история приходов, запись новых поступлений.
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Позиций</p>
            <p className="mt-1 text-2xl font-bold text-zinc-900">{activeSkus.length}</p>
            {skus.length > activeSkus.length && (
              <p className="text-xs text-zinc-400 mt-0.5">
                + {skus.length - activeSkus.length} архивных
              </p>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">На складе</p>
            <p className="mt-1 text-2xl font-bold text-zinc-900">
              {activeSkus.reduce((s, sku) => s + sku.stockQuantity, 0)} шт
            </p>
          </div>

          <div
            className={`rounded-xl border p-4 shadow-sm ${
              lowStockCount > 0 ? "border-amber-200 bg-amber-50" : "border-zinc-200 bg-white"
            }`}
          >
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Мало / нет</p>
            <p
              className={`mt-1 text-2xl font-bold ${
                lowStockCount > 0 ? "text-amber-700" : "text-zinc-900"
              }`}
            >
              {lowStockCount}
            </p>
            {outOfStockCount > 0 && (
              <p className="text-xs text-red-600 mt-0.5">{outOfStockCount} без остатка</p>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Стоимость</p>
            <p className="mt-1 text-2xl font-bold text-zinc-900">
              {totalStockValue.toLocaleString("ru-RU")} ₽
            </p>
          </div>
        </div>

        {/* Duplicate SKU warning */}
        {duplicateGroups.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-amber-600 text-base">⚠</span>
              <h3 className="text-sm font-semibold text-amber-800">
                Обнаружены дубли — {duplicateGroups.length}{" "}
                {duplicateGroups.length === 1 ? "группа" : "группы"}
              </h3>
            </div>
            <div className="space-y-2">
              {duplicateGroups.map((group) => (
                <div
                  key={group.map((s) => s.id).join("-")}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                >
                  <span className="font-medium text-amber-900">{group[0].name}</span>
                  <span className="text-amber-600 text-xs">
                    {group.map((s) => `${s.stockQuantity} ${s.unit}`).join(" + ")}
                  </span>
                  <SkuMergeDialog
                    group={group.map((s) => ({
                      id: s.id,
                      name: s.name,
                      category: s.category,
                      unit: s.unit,
                      stockQuantity: s.stockQuantity,
                    }))}
                    onMerged={() => { window.location.reload(); }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stock catalog */}
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
            <h2 className="text-lg font-semibold text-zinc-900">Текущие остатки</h2>
            <span className="text-sm text-zinc-400">{skus.length} позиций</span>
          </div>

          {skus.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-zinc-400">Товаров пока нет.</p>
              <p className="text-xs text-zinc-300 mt-1">
                Запишите первый приход — товар появится здесь автоматически.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50">
                    <th className="px-4 py-3 text-left font-medium text-zinc-500">Название</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-500">Категория</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-500">Ед. изм.</th>
                    <th className="px-4 py-3 text-right font-medium text-zinc-500">Цена</th>
                    <th className="px-4 py-3 text-right font-medium text-zinc-500">Остаток</th>
                    <th className="px-4 py-3 text-right font-medium text-zinc-500">Порог</th>
                    <th className="px-4 py-3 text-center font-medium text-zinc-500">Статус</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {categories.map((category) => {
                    const categorySkus = skus.filter((s) => s.category === category);
                    return (
                      <>
                        <tr key={`cat-${category}`} className="bg-zinc-50/60">
                          <td
                            colSpan={7}
                            className="px-4 py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wide"
                          >
                            {category}
                          </td>
                        </tr>

                        {categorySkus.map((sku) => {
                          const level = stockLevel(sku.stockQuantity, sku.lowStockThreshold);
                          const rowBg = !sku.isActive
                            ? "opacity-50"
                            : level === "out"
                            ? "bg-red-50/40"
                            : level === "low"
                            ? "bg-amber-50/40"
                            : "";

                          return (
                            <tr
                              key={sku.id}
                              className={`hover:bg-zinc-50 transition-colors ${rowBg}`}
                            >
                              <td className="px-4 py-3 font-medium text-zinc-900">{sku.name}</td>
                              <td className="px-4 py-3 text-zinc-500">{sku.category}</td>
                              <td className="px-4 py-3 text-zinc-500">{sku.unit}</td>
                              <td className="px-4 py-3 text-right text-zinc-700 tabular-nums">
                                {Number(sku.price) > 0
                                  ? `${Number(sku.price).toLocaleString("ru-RU")} ₽`
                                  : "—"}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <span
                                  className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${stockColors[level]}`}
                                >
                                  {sku.stockQuantity} {sku.unit}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right text-zinc-400 tabular-nums text-xs">
                                ≥ {sku.lowStockThreshold}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {sku.isActive ? (
                                  <span
                                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${stockColors[level]}`}
                                  >
                                    {stockLabels[level]}
                                  </span>
                                ) : (
                                  <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium text-zinc-400 bg-zinc-100">
                                    Архив
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
