/**
 * Меню кафе «Деловой Парк» — расшифровка настенных лайтбоксов (август 2026).
 *
 * Единственный источник правды для двух потребителей:
 *   - `scripts/seeds/core.ts` — наполняет пустую БД (create-only, цены не трогает);
 *   - `scripts/update-cafe-menu.ts` — разово синхронизирует прод с этим прайсом.
 *
 * Порядок категорий на витрине задаётся блоками `sortOrder` (шаг 100), а не
 * алфавитом: кофе — блок 0, поэтому раздел идёт первым. См. `categoryRank()`
 * в `src/modules/cafe/service.ts`.
 *
 * Имена уникальны в пределах меню — по ним синк находит существующие строки.
 * Поэтому три разных Coca-Cola различаются объёмом прямо в названии: в корзине
 * и в снапшоте OrderItem видно только `name`, без описания.
 */

export type CafeBoardItem = {
  category: string;
  name: string;
  /** Объём / страна с ценника — показывается под названием. */
  description?: string;
  price: number;
};

/** Шаг блока sortOrder между категориями. */
const CATEGORY_BLOCK = 100;

const CATEGORY_KOFE = "Кофе";
const CATEGORY_PIZZA = "Пицца";
const CATEGORY_DRINKS = "Охлаждённые напитки";

/** Категории в порядке вывода на витрине. */
export const CAFE_BOARD_CATEGORIES = [
  CATEGORY_KOFE,
  CATEGORY_PIZZA,
  CATEGORY_DRINKS,
] as const;

const BOARD: CafeBoardItem[] = [
  // === Кофе (кофейная станция, оплата наличкой или по QR) ===
  { category: CATEGORY_KOFE, name: "Эспрессо", description: "30 мл", price: 130 },
  { category: CATEGORY_KOFE, name: "Капучино", description: "300 мл", price: 200 },
  { category: CATEGORY_KOFE, name: "Латте", description: "300 мл", price: 200 },

  // === Пицца ===
  { category: CATEGORY_PIZZA, name: "4 сыра", price: 650 },
  { category: CATEGORY_PIZZA, name: "Супер мясная", price: 740 },
  { category: CATEGORY_PIZZA, name: "Пепперони", price: 590 },
  { category: CATEGORY_PIZZA, name: "Баварская", price: 730 },
  { category: CATEGORY_PIZZA, name: "Цыплёнок песто", price: 790 },
  { category: CATEGORY_PIZZA, name: "Чиз карбонара", price: 700 },
  { category: CATEGORY_PIZZA, name: "Ветчина / грибы", price: 720 },
  { category: CATEGORY_PIZZA, name: "Чоризо", price: 560 },

  // === Охлаждённые напитки (холодильник Плей Парка) ===
  { category: CATEGORY_DRINKS, name: "Pepsi", description: "0,15 л · Ирак", price: 100 },
  {
    category: CATEGORY_DRINKS,
    name: "Coca-Cola 0,33 л (USA)",
    description: "0,33 л · USA",
    price: 250,
  },
  { category: CATEGORY_DRINKS, name: "Adrenalin Rush", description: "0,5 л", price: 180 },
  { category: CATEGORY_DRINKS, name: "Fanta", description: "0,33 л · стекло", price: 160 },
  { category: CATEGORY_DRINKS, name: "Burn", description: "0,5 л", price: 170 },
  { category: CATEGORY_DRINKS, name: "LIT Energy", description: "0,5 л", price: 150 },
  { category: CATEGORY_DRINKS, name: "Red Bull", description: "0,25 л", price: 200 },
  { category: CATEGORY_DRINKS, name: "Rich", description: "чай · 0,5 л", price: 120 },
  { category: CATEGORY_DRINKS, name: "Tornado", description: "0,5 л", price: 150 },
  { category: CATEGORY_DRINKS, name: "Bogdan", description: "компот · 1,0 л", price: 430 },
  { category: CATEGORY_DRINKS, name: "SanPellegrino", description: "тоник · 0,33 л", price: 230 },
  { category: CATEGORY_DRINKS, name: "Байкал", description: "вода · 0,5 л", price: 100 },
  { category: CATEGORY_DRINKS, name: "Dr.Pepper", description: "0,33 л · Польша", price: 160 },
  {
    category: CATEGORY_DRINKS,
    name: "Coca-Cola 0,33 л (Ирак)",
    description: "0,33 л · Ирак",
    price: 110,
  },
  { category: CATEGORY_DRINKS, name: "Добрый сок", description: "1 л · ассорти", price: 170 },
  { category: CATEGORY_DRINKS, name: "Добрый морс", description: "1 л", price: 200 },
  { category: CATEGORY_DRINKS, name: "Mountain Dew", description: "0,33 л · USA", price: 280 },
  { category: CATEGORY_DRINKS, name: "Св. Источник", description: "0,5 л", price: 80 },
  { category: CATEGORY_DRINKS, name: "Coca-Cola 2 л", description: "2 л", price: 350 },
];

export type CafeMenuSeedItem = CafeBoardItem & { sortOrder: number };

/**
 * Меню с проставленным `sortOrder`: категория получает блок по своему индексу
 * в `CAFE_BOARD_CATEGORIES`, позиция внутри блока — порядок с ценника.
 */
export const CAFE_MENU: CafeMenuSeedItem[] = CAFE_BOARD_CATEGORIES.flatMap(
  (category, categoryIndex) =>
    BOARD.filter((item) => item.category === category).map((item, itemIndex) => ({
      ...item,
      sortOrder: categoryIndex * CATEGORY_BLOCK + itemIndex,
    })),
);
