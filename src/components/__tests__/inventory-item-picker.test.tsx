// @vitest-environment jsdom
//
// Требование #9.4 ТЗ и п. 2.2 Приложения № 3 оферты: дополнительные услуги не
// могут быть выбраны по умолчанию (п. 3.1 ст. 16 ЗоЗПП — автоматические отметки
// о согласии на доп. услуги запрещены, деньги за них клиент вправе истребовать
// назад). Поведение сейчас корректное — тест фиксирует его от регресса.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { InventoryItemPicker } from "../inventory-item-picker";

const SKUS = [
  { id: "sku-1", name: "Уголь", category: "Мангал", unit: "уп", price: 400, stockQuantity: 50, lowStockThreshold: 5 },
  { id: "sku-2", name: "Розжиг", category: "Мангал", unit: "шт", price: 200, stockQuantity: 30, lowStockThreshold: 5 },
  { id: "sku-3", name: "Караоке", category: "Развлечения", unit: "час", price: 750, stockQuantity: 10, lowStockThreshold: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ success: true, data: SKUS }),
  }) as unknown as typeof fetch;
});

afterEach(cleanup);

describe("InventoryItemPicker — доп. услуги не предвыбраны", () => {
  it("при монтировании не выбрано ничего", async () => {
    const onChange = vi.fn();
    render(<InventoryItemPicker value={[]} onChange={onChange} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/inventory");
    });

    // Ни одного вызова onChange: компонент не проставляет позиции сам.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("не сообщает наверх ни одной позиции, пока пользователь не выбрал", async () => {
    const onResolvedChange = vi.fn();
    render(
      <InventoryItemPicker value={[]} onChange={vi.fn()} onResolvedChange={onResolvedChange} />
    );

    await waitFor(() => {
      expect(onResolvedChange).toHaveBeenCalled();
    });
    for (const call of onResolvedChange.mock.calls) {
      expect(call[0]).toEqual([]);
    }
  });

  it("все количества стартуют с нуля", async () => {
    render(<InventoryItemPicker value={[]} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/inventory");
    });

    // Ни одна позиция не показывает ненулевое количество.
    expect(screen.queryByText(/^[1-9]\d* поз\./)).toBeNull();
  });

  it("отдаёт наверх название и цену выбранной позиции — для сводки перед оплатой", async () => {
    const onResolvedChange = vi.fn();
    render(
      <InventoryItemPicker
        value={[{ skuId: "sku-1", quantity: 2 }]}
        onChange={vi.fn()}
        onResolvedChange={onResolvedChange}
      />
    );

    await waitFor(() => {
      expect(onResolvedChange).toHaveBeenCalledWith([
        { skuId: "sku-1", name: "Уголь", unit: "уп", price: 400, quantity: 2 },
      ]);
    });
  });
});
