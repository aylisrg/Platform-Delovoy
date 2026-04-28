/**
 * Минимальный in-memory эмулятор подмножества PrismaClient API,
 * необходимого для тестов сидеров. Покрывает:
 *
 *   - findUnique по уникальным полям
 *   - findFirst по where
 *   - upsert (create or update по where)
 *   - update по id
 *   - create
 *
 * Эмуляция уважает unique-constraints: повторный create с тем же ключом
 * бросает ошибку (имитирует Prisma P2002), что и нужно тестам идемпотентности.
 *
 * Используется только в тестах. Реальные сидеры работают с настоящим PrismaClient.
 */
import type { PrismaClient } from "@prisma/client";

type Row = Record<string, unknown> & { id: string };

let cuidCounter = 0;
function cuid(): string {
  cuidCounter += 1;
  return `c_${cuidCounter.toString().padStart(8, "0")}`;
}

type WhereCondition = Record<string, unknown>;

function matches(row: Row, where: WhereCondition): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === "deletedAt" && v === null) {
      if (row.deletedAt !== null && row.deletedAt !== undefined) return false;
      continue;
    }
    // Composite-key shortcut: { building_floor_number: { ... } }
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const composite = v as Record<string, unknown>;
      const allMatch = Object.entries(composite).every(
        ([ck, cv]) => row[ck] === cv,
      );
      if (allMatch) continue;
      return false;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

interface ModelStore {
  rows: Row[];
  uniqueKeys: string[][]; // each entry — unique constraint (single or composite)
}

function violatesUnique(store: ModelStore, candidate: Row, ignoreId?: string) {
  for (const keyset of store.uniqueKeys) {
    // Skip if any key in this constraint is null/undefined in candidate
    const candidateValues = keyset.map((k) => candidate[k]);
    if (candidateValues.some((v) => v === null || v === undefined)) continue;
    const conflict = store.rows.find((r) => {
      if (ignoreId && r.id === ignoreId) return false;
      return keyset.every((k) => r[k] === candidate[k]);
    });
    if (conflict) return true;
  }
  return false;
}

interface ModelDelegate {
  findUnique: (args: { where: WhereCondition }) => Promise<Row | null>;
  findFirst: (args: { where: WhereCondition }) => Promise<Row | null>;
  create: (args: { data: Record<string, unknown> }) => Promise<Row>;
  update: (args: {
    where: WhereCondition;
    data: Record<string, unknown>;
  }) => Promise<Row>;
  upsert: (args: {
    where: WhereCondition;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<Row>;
  count: () => Promise<number>;
  __store: ModelStore;
}

function makeDelegate(uniqueKeys: string[][]): ModelDelegate {
  const store: ModelStore = { rows: [], uniqueKeys };

  const flattenWhere = (where: WhereCondition): WhereCondition => {
    // Normalize composite where like { building_floor_number: {...} } → flat keys.
    const out: WhereCondition = {};
    for (const [k, v] of Object.entries(where)) {
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) {
          out[ck] = cv;
        }
      } else {
        out[k] = v;
      }
    }
    return out;
  };

  return {
    __store: store,
    async findUnique({ where }) {
      const flat = flattenWhere(where);
      return store.rows.find((r) => matches(r, flat)) ?? null;
    },
    async findFirst({ where }) {
      return store.rows.find((r) => matches(r, where)) ?? null;
    },
    async create({ data }) {
      const row: Row = {
        id: (data.id as string | undefined) ?? cuid(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      if (violatesUnique(store, row)) {
        throw new Error(
          `Unique constraint violation in create on keys ${JSON.stringify(store.uniqueKeys)}`,
        );
      }
      store.rows.push(row);
      return row;
    },
    async update({ where, data }) {
      const flat = flattenWhere(where);
      const idx = store.rows.findIndex((r) => matches(r, flat));
      if (idx === -1) throw new Error("Record not found for update");
      const merged: Row = {
        ...store.rows[idx],
        ...data,
        id: store.rows[idx].id,
        updatedAt: new Date(),
      };
      if (violatesUnique(store, merged, store.rows[idx].id)) {
        throw new Error("Unique constraint violation in update");
      }
      store.rows[idx] = merged;
      return merged;
    },
    async upsert({ where, create, update }) {
      const flat = flattenWhere(where);
      const existing = store.rows.find((r) => matches(r, flat));
      if (existing) {
        return this.update({ where: flat, data: update });
      }
      return this.create({ data: { ...flat, ...create } });
    },
    async count() {
      return store.rows.length;
    },
  };
}

export interface FakePrisma {
  user: ModelDelegate;
  module: ModelDelegate;
  resource: ModelDelegate;
  menuItem: ModelDelegate;
  office: ModelDelegate;
  recurringExpense: ModelDelegate;
  taskBoard: ModelDelegate;
  taskColumn: ModelDelegate;
  taskCategory: ModelDelegate;
}

export function createFakePrisma(): FakePrisma {
  return {
    user: makeDelegate([["telegramId"], ["email"]]),
    module: makeDelegate([["slug"]]),
    resource: makeDelegate([]), // no DB-level unique
    menuItem: makeDelegate([]),
    office: makeDelegate([["building", "floor", "number"]]),
    recurringExpense: makeDelegate([]),
    taskBoard: makeDelegate([["slug"]]),
    taskColumn: makeDelegate([["boardId", "sortOrder"]]),
    taskCategory: makeDelegate([["slug"]]),
  };
}

/** Cast helper — fake-prisma exposes only the subset used by seeders. */
export function asPrisma(fake: FakePrisma): PrismaClient {
  return fake as unknown as PrismaClient;
}
