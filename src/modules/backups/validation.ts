import { z } from "zod";

/**
 * Safe SQL identifier — letters, digits, underscore; starts with a letter or underscore.
 * We **never** interpolate user input into raw SQL; this is a defense-in-depth check
 * so that if a future code path ever does, it's still not injection-vulnerable.
 */
const sqlIdentifier = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Некорректное имя таблицы");

const primaryKeyValue = z.union([z.string().min(1), z.number(), z.boolean()]);

export const listBackupsQuerySchema = z.object({
  type: z
    .enum(["DAILY", "WEEKLY", "MONTHLY", "PRE_MIGRATION", "MANUAL", "RESTORE"])
    .optional(),
  status: z.enum(["IN_PROGRESS", "SUCCESS", "FAILED", "PARTIAL"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListBackupsQuery = z.infer<typeof listBackupsQuerySchema>;

export const restoreFullSchema = z.object({
  scope: z.literal("full"),
});

export const restoreTableSchema = z.object({
  scope: z.literal("table"),
  table: sqlIdentifier,
  truncateBefore: z.boolean().optional().default(false),
});

export const restoreRecordSchema = z.object({
  scope: z.literal("record"),
  table: sqlIdentifier,
  primaryKey: z.record(z.string().min(1), primaryKeyValue).refine(
    (o) => Object.keys(o).length > 0,
    "primaryKey обязателен"
  ),
  upsert: z.boolean().optional().default(true),
});

export const restoreTargetSchema = z.discriminatedUnion("scope", [
  restoreFullSchema,
  restoreTableSchema,
  restoreRecordSchema,
]);

export const restoreRequestSchema = z
  .object({
    backupId: z.string().min(1),
    scope: z.enum(["full", "table", "record"]),
    target: restoreTargetSchema.optional(),
    dryRun: z.boolean().optional().default(true),
    confirmToken: z
      .string()
      .min(8, "confirmToken слишком короткий")
      .max(128),
  })
  .refine(
    (r) => {
      if (r.scope === "full") return true;
      // For table/record we require a matching target block
      return r.target !== undefined && r.target.scope === r.scope;
    },
    { message: "target обязателен для scope=table|record и должен совпадать по scope" }
  );

export type RestoreRequestInput = z.infer<typeof restoreRequestSchema>;

export const deployStagingSchema = z.object({
  sha: z
    .string()
    .regex(/^[a-f0-9]{7,40}$/i, "Некорректный commit SHA")
    .optional(),
  ref: z.string().min(1).max(100).optional(),
  wipeDatabase: z.boolean().optional().default(false),
  notifyOnComplete: z.boolean().optional().default(true),
});

export type DeployStagingInput = z.infer<typeof deployStagingSchema>;
