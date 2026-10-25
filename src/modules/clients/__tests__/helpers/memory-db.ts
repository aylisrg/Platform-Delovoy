/**
 * In-memory Prisma stand-in for the account-merge engine tests
 * (ADR 2026-10-25-team-access-notifications §10: `vi.mock("@/lib/db")`, no real DB).
 *
 * Tables are plain arrays; each model supports exactly the Prisma calls the
 * merge engine, the request queue and the legacy wrappers make. Unlike a bag of
 * `vi.fn()`s it ENFORCES the unique constraints the real schema has
 * (incl. the partial ones), so ordering bugs surface as `P2002`, and
 * `$transaction` rolls every table back when the callback throws (AC-E2.7).
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

type Where = Record<string, unknown>;

type Relation = { table: string; local: string; foreign: string; many?: boolean };

/** Relation fields used in `select` / nested `where` by the code under test. */
const RELATIONS: Record<string, Record<string, Relation>> = {
  moduleAssignment: { module: { table: "module", local: "moduleId", foreign: "id" } },
  moduleNotificationRecipient: { module: { table: "module", local: "moduleSlug", foreign: "slug" } },
  userNotificationChannel: {
    webPushSubscription: { table: "webPushSubscription", local: "id", foreign: "userNotificationChannelId" },
  },
  mergeCandidate: {
    primary: { table: "user", local: "primaryUserId", foreign: "id" },
    candidate: { table: "user", local: "candidateUserId", foreign: "id" },
  },
};

type UniqueRule = { fields: string[]; when?: (row: Row) => boolean };

/** Unique constraints of `prisma/schema.prisma` + raw partial indexes in migrations. */
const UNIQUES: Record<string, UniqueRule[]> = {
  user: [
    { fields: ["email"] },
    { fields: ["phone"] },
    { fields: ["telegramId"] },
    { fields: ["vkId"] },
    { fields: ["emailNormalized"], when: (r) => r.mergedIntoUserId == null },
    { fields: ["phoneNormalized"], when: (r) => r.mergedIntoUserId == null },
  ],
  account: [{ fields: ["provider", "providerAccountId"] }],
  adminPermission: [{ fields: ["userId", "section"] }],
  moduleAssignment: [{ fields: ["userId", "moduleId"] }],
  moduleNotificationRecipient: [{ fields: ["moduleSlug", "userId"] }],
  notificationPreference: [{ fields: ["userId"] }],
  notificationGlobalPreference: [{ fields: ["userId"] }],
  notificationEventPreference: [{ fields: ["userId", "eventType"] }],
  userNotificationChannel: [{ fields: ["userId", "kind", "address"] }],
  webPushSubscription: [{ fields: ["endpoint"] }, { fields: ["userNotificationChannelId"] }],
  taskAssignee: [{ fields: ["taskId", "userId"] }],
  taskSubscription: [{ fields: ["userId", "scope", "taskId", "boardId", "categoryId"] }],
  chatParticipant: [{ fields: ["chatId", "userId"] }],
  chatMessageReceipt: [{ fields: ["messageId", "userId"] }],
  mergeCandidate: [{ fields: ["primaryUserId", "candidateUserId"] }],
  telegramBotContact: [{ fields: ["telegramId"] }],
  subscription: [{ fields: ["userId"], when: (r) => r.status === "ACTIVE" }],
};

export class UniqueViolation extends Error {
  readonly code = "P2002";
  constructor(table: string, fields: string[]) {
    super(`Unique constraint failed on ${table}(${fields.join(", ")})`);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !(v instanceof Date) && !Array.isArray(v);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

export type MemoryDb = ReturnType<typeof createMemoryDb>;

export function createMemoryDb(tables: Tables = {}) {
  const t = (name: string): Row[] => {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  };
  let seq = 0;

  function related(table: string, row: Row, relName: string): Row | Row[] | null {
    const rel = RELATIONS[table]?.[relName];
    if (!rel) return null;
    const rows = t(rel.table).filter((r) => r[rel.foreign] === row[rel.local] && row[rel.local] != null);
    return rel.many ? rows : rows[0] ?? null;
  }

  function matchField(table: string, row: Row, key: string, cond: unknown): boolean {
    if (key === "OR") return (cond as Where[]).some((w) => matches(table, row, w));
    if (key === "AND") return (cond as Where[]).every((w) => matches(table, row, w));
    if (key === "NOT") return !matches(table, row, cond as Where);
    if (RELATIONS[table]?.[key]) {
      const rel = related(table, row, key);
      if (!rel || Array.isArray(rel)) return false;
      return matches(RELATIONS[table][key].table, rel, cond as Where);
    }
    const value = row[key];
    if (isPlainObject(cond)) {
      for (const [op, arg] of Object.entries(cond)) {
        switch (op) {
          case "in":
            if (!(arg as unknown[]).some((a) => sameValue(a, value))) return false;
            break;
          case "notIn":
            if ((arg as unknown[]).some((a) => sameValue(a, value))) return false;
            break;
          case "has":
            if (!Array.isArray(value) || !value.includes(arg)) return false;
            break;
          case "not":
            if (sameValue(value, arg)) return false;
            break;
          case "equals":
            if (cond.mode === "insensitive" && typeof value === "string" && typeof arg === "string") {
              if (value.toLowerCase() !== arg.toLowerCase()) return false;
            } else if (!sameValue(value, arg)) return false;
            break;
          case "contains": {
            if (typeof value !== "string") return false;
            const hay = cond.mode === "insensitive" ? value.toLowerCase() : value;
            const needle = cond.mode === "insensitive" ? String(arg).toLowerCase() : String(arg);
            if (!hay.includes(needle)) return false;
            break;
          }
          case "lt":
            if (!(value instanceof Date && arg instanceof Date && value < arg)) return false;
            break;
          case "mode":
            break;
          default:
            throw new Error(`memory-db: unsupported operator ${op} on ${table}.${key}`);
        }
      }
      return true;
    }
    if (cond === null) return value === null || value === undefined;
    return sameValue(value, cond);
  }

  function matches(table: string, row: Row, where: Where = {}): boolean {
    return Object.entries(where).every(([k, v]) => matchField(table, row, k, v));
  }

  function project(table: string, row: Row, select?: Record<string, unknown>): Row {
    if (!select) return clone(row);
    const out: Row = {};
    for (const [key, spec] of Object.entries(select)) {
      if (key === "_count") continue;
      if (RELATIONS[table]?.[key]) {
        const rel = related(table, row, key);
        const nested = isPlainObject(spec) && isPlainObject(spec.select) ? (spec.select as Record<string, unknown>) : undefined;
        const relTable = RELATIONS[table][key].table;
        out[key] = Array.isArray(rel)
          ? rel.map((r) => project(relTable, r, nested))
          : rel
            ? project(relTable, rel, nested)
            : null;
      } else if (spec) {
        out[key] = clone(row[key]);
      }
    }
    return out;
  }

  function assertUnique(table: string, candidate: Row, self?: Row) {
    for (const rule of UNIQUES[table] ?? []) {
      // Postgres: NULLs never collide in a unique index.
      if (rule.fields.some((f) => candidate[f] === null || candidate[f] === undefined)) continue;
      if (rule.when && !rule.when(candidate)) continue;
      const clash = t(table).find(
        (other) =>
          other !== self &&
          (!rule.when || rule.when(other)) &&
          rule.fields.every((f) => sameValue(other[f] ?? null, candidate[f] ?? null)),
      );
      if (clash) throw new UniqueViolation(table, rule.fields);
    }
  }

  function applyData(row: Row, data: Row): Row {
    const next: Row = { ...row };
    for (const [k, v] of Object.entries(data)) {
      if (isPlainObject(v) && "increment" in v) next[k] = Number(next[k] ?? 0) + Number(v.increment);
      else next[k] = v;
    }
    return next;
  }

  function model(name: string) {
    return {
      findMany: async (args: { where?: Where; select?: Record<string, unknown>; take?: number } = {}) => {
        const rows = t(name).filter((r) => matches(name, r, args.where));
        return (args.take ? rows.slice(0, args.take) : rows).map((r) => project(name, r, args.select));
      },
      findFirst: async (args: { where?: Where; select?: Record<string, unknown> } = {}) => {
        const row = t(name).find((r) => matches(name, r, args.where));
        return row ? project(name, row, args.select) : null;
      },
      findUnique: async (args: { where: Where; select?: Record<string, unknown> }) => {
        const row = t(name).find((r) => matches(name, r, args.where));
        return row ? project(name, row, args.select) : null;
      },
      findUniqueOrThrow: async (args: { where: Where; select?: Record<string, unknown> }) => {
        const row = t(name).find((r) => matches(name, r, args.where));
        if (!row) throw new Error(`memory-db: ${name} not found`);
        return project(name, row, args.select);
      },
      count: async (args: { where?: Where } = {}) => t(name).filter((r) => matches(name, r, args.where)).length,
      groupBy: async (args: { by: string[]; where?: Where }) => {
        const groups = new Map<string, { row: Row; count: number }>();
        for (const r of t(name).filter((x) => matches(name, x, args.where))) {
          const key = args.by.map((f) => String(r[f])).join("|");
          const g = groups.get(key) ?? { row: Object.fromEntries(args.by.map((f) => [f, r[f]])), count: 0 };
          g.count++;
          groups.set(key, g);
        }
        return [...groups.values()].map((g) => ({ ...g.row, _count: { _all: g.count } }));
      },
      create: async (args: { data: Row; select?: Record<string, unknown> }) => {
        const row: Row = { id: `${name}-${++seq}`, ...clone(args.data) };
        assertUnique(name, row);
        t(name).push(row);
        return project(name, row, args.select);
      },
      createMany: async (args: { data: Row[]; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const data of args.data) {
          const row: Row = { id: `${name}-${++seq}`, ...clone(data) };
          try {
            assertUnique(name, row);
          } catch (err) {
            if (args.skipDuplicates && err instanceof UniqueViolation) continue;
            throw err;
          }
          t(name).push(row);
          count++;
        }
        return { count };
      },
      update: async (args: { where: Where; data: Row; select?: Record<string, unknown> }) => {
        const row = t(name).find((r) => matches(name, r, args.where));
        if (!row) throw Object.assign(new Error(`memory-db: ${name} update target missing`), { code: "P2025" });
        const next = applyData(row, args.data);
        assertUnique(name, next, row);
        Object.assign(row, next);
        return project(name, row, args.select);
      },
      updateMany: async (args: { where?: Where; data: Row }) => {
        const targets = t(name).filter((r) => matches(name, r, args.where));
        for (const row of targets) {
          const next = applyData(row, args.data);
          assertUnique(name, next, row);
          Object.assign(row, next);
        }
        return { count: targets.length };
      },
      upsert: async (args: { where: Where; create: Row; update: Row; select?: Record<string, unknown> }) => {
        const row = t(name).find((r) => matches(name, r, args.where));
        if (row) {
          const next = applyData(row, args.update);
          assertUnique(name, next, row);
          Object.assign(row, next);
          return project(name, row, args.select);
        }
        const created: Row = { id: `${name}-${++seq}`, ...clone(args.create) };
        assertUnique(name, created);
        t(name).push(created);
        return project(name, created, args.select);
      },
      delete: async (args: { where: Where }) => {
        const arr = t(name);
        const idx = arr.findIndex((r) => matches(name, r, args.where));
        if (idx === -1) throw Object.assign(new Error(`memory-db: ${name} delete target missing`), { code: "P2025" });
        return arr.splice(idx, 1)[0];
      },
      deleteMany: async (args: { where?: Where } = {}) => {
        const arr = t(name);
        let count = 0;
        for (let i = arr.length - 1; i >= 0; i--) {
          if (matches(name, arr[i], args.where)) {
            arr.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
    };
  }

  /**
   * `$queryRaw` of the merge lock: the pair (by the bound ids) plus every
   * active SUPERADMIN except `system`, ordered by id.
   */
  async function queryRaw(_strings: TemplateStringsArray, ...values: unknown[]) {
    const ids = values.filter((v): v is string => typeof v === "string");
    return t("user")
      .filter(
        (u) =>
          ids.includes(String(u.id)) ||
          (u.role === "SUPERADMIN" && u.mergedIntoUserId == null && u.id !== "system"),
      )
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((u) => ({ id: u.id, role: u.role, mergedIntoUserId: u.mergedIntoUserId ?? null }));
  }

  const models = new Map<string, ReturnType<typeof model>>();
  const client: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "$queryRaw") return queryRaw;
        if (prop === "$executeRaw") return async () => 0;
        if (prop === "$transaction") return transaction;
        if (prop === "then") return undefined;
        if (!models.has(prop)) models.set(prop, model(prop));
        return models.get(prop);
      },
    },
  );

  const transactionCalls: Array<unknown> = [];

  async function transaction<T>(cb: (tx: unknown) => Promise<T>, options?: unknown): Promise<T> {
    transactionCalls.push(options);
    const snapshot = clone(tables);
    try {
      return await cb(client);
    } catch (err) {
      for (const key of Object.keys(tables)) delete tables[key];
      Object.assign(tables, snapshot);
      throw err;
    }
  }

  return { client, tables, transactionCalls, transaction, table: t };
}

export function makeUser(overrides: Row = {}): Row {
  return {
    id: "u-x",
    role: "USER",
    name: null,
    email: null,
    phone: null,
    image: null,
    telegramId: null,
    vkId: null,
    phoneNormalized: null,
    emailNormalized: null,
    emailVerified: null,
    passwordHash: null,
    mergedIntoUserId: null,
    mergedAt: null,
    sessionVersion: 0,
    source: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}
