import { describe, it, expect } from "vitest";
import { CAFE_MENU, CAFE_BOARD_CATEGORIES } from "../cafe-menu";

describe("CAFE_MENU (настенный прайс)", () => {
  it("названия уникальны — по ним синк находит строки в БД", () => {
    const names = CAFE_MENU.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("кофе идёт первым разделом: его позиции имеют минимальный sortOrder", () => {
    const minSortOrder = (category: string) =>
      Math.min(...CAFE_MENU.filter((i) => i.category === category).map((i) => i.sortOrder));

    const ranked = [...CAFE_BOARD_CATEGORIES].sort(
      (a, b) => minSortOrder(a) - minSortOrder(b),
    );

    expect(ranked[0]).toBe("Кофе");
    expect(ranked).toEqual([...CAFE_BOARD_CATEGORIES]);
  });

  it("блоки sortOrder категорий не пересекаются", () => {
    const ranges = CAFE_BOARD_CATEGORIES.map((category) => {
      const orders = CAFE_MENU.filter((i) => i.category === category).map((i) => i.sortOrder);
      return { category, min: Math.min(...orders), max: Math.max(...orders) };
    }).sort((a, b) => a.min - b.min);

    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i].min).toBeGreaterThan(ranges[i - 1].max);
    }
  });

  it("sortOrder уникален — порядок витрины детерминирован", () => {
    const orders = CAFE_MENU.map((i) => i.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("все позиции с положительной ценой и известной категорией", () => {
    for (const item of CAFE_MENU) {
      expect(item.price).toBeGreaterThan(0);
      expect(Number.isInteger(item.price)).toBe(true);
      expect(CAFE_BOARD_CATEGORIES).toContain(item.category);
    }
  });

  it("содержит все позиции с лайтбоксов: 3 кофе, 8 пицц, 19 напитков", () => {
    const count = (category: string) =>
      CAFE_MENU.filter((i) => i.category === category).length;

    expect(count("Кофе")).toBe(3);
    expect(count("Пицца")).toBe(8);
    expect(count("Охлаждённые напитки")).toBe(19);
    expect(CAFE_MENU.length).toBe(30);
  });

  it("цены кофейной станции совпадают с ценником", () => {
    const priceOf = (name: string) => CAFE_MENU.find((i) => i.name === name)?.price;

    expect(priceOf("Эспрессо")).toBe(130);
    expect(priceOf("Капучино")).toBe(200);
    expect(priceOf("Латте")).toBe(200);
  });
});
